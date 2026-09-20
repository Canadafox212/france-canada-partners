-- Phase 9 — Mise en relation commerciale entre entreprises
--
-- MATCH -> FICHE ENTREPRISE -> DEMANDE DE MISE EN RELATION -> ACCEPTATION/
-- REFUS -> NOTIFICATIONS -> SUIVI. Voir docs/PARTNERSHIP_REQUESTS.md (à
-- créer après validation de cette migration) pour l'explication en langage
-- clair.
--
-- Mécanisme dédié, distinct d'opportunity_responses/company_offers/
-- company_needs (§1 de la demande) : une demande de mise en relation
-- représente une intention humaine explicite entre deux entreprises,
-- qu'une opportunité publiée existe ou non.
--
-- Toute écriture passe EXCLUSIVEMENT par des fonctions SECURITY DEFINER —
-- même principe que company_claims (0018) : aucune politique RLS
-- d'insertion/mise à jour pour authenticated, donc structurellement
-- impossible de fabriquer une demande en changeant requester_company_id
-- côté client (§7 de la demande). Chaque fonction RECALCULE elle-même les
-- permissions à partir de auth.uid() et de l'appartenance réelle en base
-- (has_company_role) — jamais une confiance accordée à un rôle/statut
-- envoyé par le client.
--
-- IMPORTANT (retour de revue, voir échange) : cette version NE modifie
-- PLUS submit_company_claim/review_company_claim (0018) — voir §5 "Visibilité
-- après revendication" plus bas pour l'alternative découplée retenue
-- (déclencheur sur companies.claimed_at), qui laisse ces deux fonctions
-- strictement intactes.

create table public.partnership_requests (
  id uuid primary key default gen_random_uuid(),
  requester_company_id uuid not null references public.companies (id) on delete cascade,
  target_company_id uuid not null references public.companies (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'pending_unclaimed', 'accepted', 'declined', 'withdrawn', 'expired')),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 2000),
  -- Provenance de la demande — jamais un recalcul ni une copie du score :
  -- seule une RÉFÉRENCE vers l'artefact déjà persisté (§5 de la demande).
  -- L'intégrité de cette référence (le match/l'opportunité concerne bien
  -- CES deux entreprises) est vérifiée dans create_partnership_request,
  -- pas seulement supposée depuis les paramètres reçus du client.
  source_type text not null default 'OTHER'
    check (source_type in ('DIRECTORY', 'MATCH', 'OPPORTUNITY', 'OTHER')),
  source_match_id uuid references public.matches (id) on delete set null,
  source_opportunity_id uuid references public.opportunities (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references public.profiles (id) on delete set null,
  withdrawn_at timestamptz,
  -- Jamais une entreprise vers elle-même (§2 : "Un utilisateur ne peut
  -- jamais envoyer une demande à sa propre entreprise") — garanti en base,
  -- pas seulement dans la fonction de création.
  check (requester_company_id <> target_company_id),
  -- Une référence de provenance ne peut être renseignée que pour le
  -- source_type correspondant (même principe XOR que
  -- import_duplicate_candidates, 0020, et company_industries.classification_source, 0021).
  check (
    (source_type = 'MATCH' and source_opportunity_id is null)
    or (source_type != 'MATCH' and source_match_id is null)
  ),
  check (
    (source_type = 'OPPORTUNITY' and source_match_id is null)
    or (source_type != 'OPPORTUNITY' and source_opportunity_id is null)
  )
);

comment on table public.partnership_requests is
  'Demande de mise en relation ENTREPRISE -> ENTREPRISE (jamais utilisateur '
  '-> entreprise). Distincte d''opportunity_responses : peut exister sans '
  'aucune opportunité publiée. Voir docs/PARTNERSHIP_REQUESTS.md.';

comment on column public.partnership_requests.status is
  'pending : en attente de réponse de l''entreprise cible (déjà revendiquée). '
  'pending_unclaimed : entreprise cible pas encore revendiquée — aucun '
  'membre à notifier ; repasse automatiquement à pending dès qu''un '
  'représentant revendique la fiche (voir le déclencheur sur '
  'companies.claimed_at ci-dessous). accepted/declined : réponse de la '
  'cible. withdrawn : retirée par le demandeur. expired : réservé à un '
  'usage futur (non produit par cette phase).';

create index partnership_requests_requester_idx on public.partnership_requests (requester_company_id);
create index partnership_requests_target_idx on public.partnership_requests (target_company_id);
create index partnership_requests_status_idx on public.partnership_requests (status);

-- Une seule demande ACTIVE par couple (demandeur, cible) — §8 de la
-- demande. "Active" = pas encore résolue (pending/pending_unclaimed) :
-- une nouvelle demande redevient possible après refus, retrait ou
-- expiration, sans règle anti-spam plus complexe pour cette phase.
create unique index partnership_requests_one_active_per_pair
  on public.partnership_requests (requester_company_id, target_company_id)
  where status in ('pending', 'pending_unclaimed');

create trigger set_partnership_requests_updated_at
  before update on public.partnership_requests
  for each row execute function public.set_updated_at();

alter table public.partnership_requests enable row level security;

-- Lecture : membre (tout rôle, y compris viewer — un viewer peut CONSULTER
-- mais jamais AGIR, voir les fonctions plus bas) de l'entreprise
-- demandeuse OU de l'entreprise cible, ou administrateur plateforme (§7).
-- Tant que la cible n'est pas revendiquée, personne ne "représente"
-- encore cette entreprise : seul le demandeur (et l'admin plateforme) la
-- voit, ce qui découle naturellement de has_company_role() sans logique
-- spéciale.
create policy "partnership_requests_select_involved_parties" on public.partnership_requests
  for select
  using (
    public.has_company_role(requester_company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.has_company_role(target_company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

-- Aucune politique insert/update pour authenticated/anon : toute écriture
-- passe par les fonctions ci-dessous.

-- 1) Création -----------------------------------------------------------------
--
-- SECURITY DEFINER, search_path figé, EXECUTE explicitement retiré à
-- PUBLIC et anon, accordé seulement à authenticated (voir le tableau des
-- GRANT/REVOKE dans la revue). auth.uid() contrôlé en premier. Les DEUX
-- entreprises doivent être 'active' — ni draft, ni archived, ni suspended
-- (voir commentaire dédié plus bas pour le cas de l'entreprise demandeuse).
create or replace function public.create_partnership_request(
  p_requester_company_id uuid,
  p_target_company_id uuid,
  p_subject text,
  p_message text,
  p_source_type text default 'OTHER',
  p_source_match_id uuid default null,
  p_source_opportunity_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_requester_status text;
  v_target_status text;
  v_target_claimed_at timestamptz;
  v_status text;
  v_request_id uuid;
  v_member_user_id uuid;
  v_match_need_company_id uuid;
  v_match_offer_company_id uuid;
  v_opportunity_company_id uuid;
begin
  if v_user_id is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  if p_requester_company_id = p_target_company_id then
    raise exception 'Une entreprise ne peut pas s''envoyer une demande à elle-même.';
  end if;

  -- Permission recalculée depuis auth.uid() + l'appartenance réelle en
  -- base — jamais depuis une supposition sur qui appelle (§7 de la demande).
  if not public.has_company_role(p_requester_company_id, array['owner', 'admin', 'member']) then
    raise exception 'Vous devez être autorisé à agir au nom de cette entreprise.' using errcode = '42501';
  end if;

  -- Entreprise demandeuse : doit être 'active'. Une entreprise fraîchement
  -- créée par son propriétaire démarre 'draft' (comportement inchangé
  -- depuis la Phase 3, `create_company()`) et n'a aujourd'hui AUCUNE voie
  -- en libre-service pour devenir 'active' — seule une action
  -- administrative (ex. publication d'un import, Phase 8) le fait. Cette
  -- phase ne construit PAS ce parcours "mon entreprise devient active" :
  -- il est traité séparément, comme décision produit à part entière. En
  -- attendant, une entreprise 'draft' ne peut donc pas encore envoyer de
  -- demande — cas volontairement bloquant, pas un oubli.
  select status into v_requester_status from public.companies where id = p_requester_company_id;
  if v_requester_status is null then
    raise exception 'Entreprise demandeuse introuvable.';
  end if;
  if v_requester_status != 'active' then
    raise exception 'Votre entreprise doit être active pour envoyer une demande de mise en relation.';
  end if;

  select status, claimed_at into v_target_status, v_target_claimed_at
  from public.companies where id = p_target_company_id;

  if v_target_status is null then
    raise exception 'Entreprise cible introuvable.';
  end if;
  if v_target_status != 'active' then
    raise exception 'Cette entreprise n''est pas disponible pour une mise en relation.';
  end if;

  if p_subject is null or char_length(trim(p_subject)) = 0 then
    raise exception 'Le sujet est obligatoire.';
  end if;
  if p_message is null or char_length(trim(p_message)) = 0 then
    raise exception 'Le message est obligatoire.';
  end if;

  -- Intégrité de la provenance MATCH : le match référencé doit concerner
  -- RÉELLEMENT ces deux entreprises précises, dans un sens ou l'autre —
  -- jamais un match arbitraire d'une autre paire (revue §2). Vérifié via
  -- l'offre et le besoin réellement référencés par le match, pas via les
  -- colonnes dénormalisées matches.company_id/candidate_company_id seules.
  if coalesce(p_source_type, 'OTHER') = 'MATCH' and p_source_match_id is not null then
    select cn.company_id, co.company_id
    into v_match_need_company_id, v_match_offer_company_id
    from public.matches m
    join public.company_needs cn on cn.id = m.need_id
    join public.company_offers co on co.id = m.offer_id
    where m.id = p_source_match_id;

    if v_match_need_company_id is null then
      raise exception 'Match introuvable.';
    end if;
    if not (
      (v_match_need_company_id = p_requester_company_id and v_match_offer_company_id = p_target_company_id)
      or (v_match_need_company_id = p_target_company_id and v_match_offer_company_id = p_requester_company_id)
    ) then
      raise exception 'Ce match ne concerne pas ces deux entreprises.';
    end if;
  end if;

  -- Intégrité de la provenance OPPORTUNITY : pour cette première version,
  -- une demande "issue d'une opportunité" s'adresse TOUJOURS à l'entreprise
  -- qui a publié cette opportunité (revue §3 — pas encore le cas d'une
  -- entreprise candidate suggérée par opportunity_matches, volontairement
  -- laissé pour un futur modèle explicite, non mélangé ici).
  if coalesce(p_source_type, 'OTHER') = 'OPPORTUNITY' and p_source_opportunity_id is not null then
    select company_id into v_opportunity_company_id
    from public.opportunities where id = p_source_opportunity_id;

    if v_opportunity_company_id is null then
      raise exception 'Opportunité introuvable.';
    end if;
    if v_opportunity_company_id != p_target_company_id then
      raise exception 'Cette opportunité n''appartient pas à l''entreprise cible.';
    end if;
  end if;

  if exists (
    select 1 from public.partnership_requests
    where requester_company_id = p_requester_company_id
      and target_company_id = p_target_company_id
      and status in ('pending', 'pending_unclaimed')
  ) then
    raise exception 'Une demande est déjà en cours entre ces deux entreprises.';
  end if;

  v_status := case when v_target_claimed_at is null then 'pending_unclaimed' else 'pending' end;

  insert into public.partnership_requests (
    requester_company_id, target_company_id, created_by, status, subject, message,
    source_type, source_match_id, source_opportunity_id
  )
  values (
    p_requester_company_id, p_target_company_id, v_user_id, v_status, trim(p_subject), trim(p_message),
    coalesce(p_source_type, 'OTHER'), p_source_match_id, p_source_opportunity_id
  )
  returning id into v_request_id;

  -- Notifications envoyées seulement à owner/admin (choix explicite de
  -- cette première version, voir revue §6) : un member peut agir sur la
  -- demande (accepter/refuser/retirer selon le camp) mais ne reçoit pas
  -- automatiquement la notification — décision à ne pas changer sans
  -- validation séparée.
  if v_status = 'pending' then
    for v_member_user_id in
      select user_id from public.company_members
      where company_id = p_target_company_id and role in ('owner', 'admin') and status = 'active'
    loop
      perform public.create_notification(
        v_member_user_id,
        'partnership_request_received',
        jsonb_build_object('request_id', v_request_id, 'requester_company_id', p_requester_company_id)
      );
    end loop;
  end if;
  -- pending_unclaimed : aucune notification, aucune sollicitation
  -- automatique d'une adresse récupérée par import (§3/§14 de la demande).

  perform public.log_audit_event(
    'partnership_request_created', 'partnership_request', v_request_id,
    null,
    jsonb_build_object(
      'requester_company_id', p_requester_company_id,
      'target_company_id', p_target_company_id,
      'status', v_status,
      'source_type', coalesce(p_source_type, 'OTHER')
    )
  );

  return json_build_object('id', v_request_id, 'status', v_status);
end;
$$;

comment on function public.create_partnership_request is
  'Point d''entrée UNIQUE pour créer une demande de mise en relation — '
  'voir docs/PARTNERSHIP_REQUESTS.md. Ne journalise jamais subject/message '
  '(§17 de la demande).';

revoke all on function public.create_partnership_request from public;
revoke execute on function public.create_partnership_request from anon;
grant execute on function public.create_partnership_request to authenticated;

-- 2) Acceptation (entreprise cible uniquement, owner/admin/member — jamais viewer) --
create or replace function public.accept_partnership_request(p_request_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_member_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  select * into v_request from public.partnership_requests where id = p_request_id for update;
  if v_request is null then
    raise exception 'Demande introuvable.';
  end if;
  if not public.has_company_role(v_request.target_company_id, array['owner', 'admin', 'member']) then
    raise exception 'Seule l''entreprise destinataire peut répondre à cette demande.' using errcode = '42501';
  end if;
  if v_request.status != 'pending' then
    raise exception 'Cette demande ne peut plus être acceptée.';
  end if;

  update public.partnership_requests
  set status = 'accepted', responded_at = now(), responded_by = auth.uid()
  where id = p_request_id;

  -- Confirme uniquement que la demande est acceptée — aucune coordonnée
  -- personnelle n'est révélée ici (§13 de la demande, décision différée).
  for v_member_user_id in
    select user_id from public.company_members
    where company_id = v_request.requester_company_id and role in ('owner', 'admin') and status = 'active'
  loop
    perform public.create_notification(
      v_member_user_id,
      'partnership_request_accepted',
      jsonb_build_object('request_id', p_request_id, 'target_company_id', v_request.target_company_id)
    );
  end loop;

  perform public.log_audit_event(
    'partnership_request_accepted', 'partnership_request', p_request_id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'accepted')
  );

  return json_build_object('id', p_request_id, 'status', 'accepted');
end;
$$;

revoke all on function public.accept_partnership_request from public;
revoke execute on function public.accept_partnership_request from anon;
grant execute on function public.accept_partnership_request to authenticated;

-- 3) Refus (entreprise cible uniquement, owner/admin/member — jamais viewer) -------
create or replace function public.decline_partnership_request(p_request_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_member_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  select * into v_request from public.partnership_requests where id = p_request_id for update;
  if v_request is null then
    raise exception 'Demande introuvable.';
  end if;
  if not public.has_company_role(v_request.target_company_id, array['owner', 'admin', 'member']) then
    raise exception 'Seule l''entreprise destinataire peut répondre à cette demande.' using errcode = '42501';
  end if;
  if v_request.status != 'pending' then
    raise exception 'Cette demande ne peut plus être refusée.';
  end if;

  update public.partnership_requests
  set status = 'declined', responded_at = now(), responded_by = auth.uid()
  where id = p_request_id;

  for v_member_user_id in
    select user_id from public.company_members
    where company_id = v_request.requester_company_id and role in ('owner', 'admin') and status = 'active'
  loop
    perform public.create_notification(
      v_member_user_id,
      'partnership_request_declined',
      jsonb_build_object('request_id', p_request_id, 'target_company_id', v_request.target_company_id)
    );
  end loop;

  perform public.log_audit_event(
    'partnership_request_declined', 'partnership_request', p_request_id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'declined')
  );

  return json_build_object('id', p_request_id, 'status', 'declined');
end;
$$;

revoke all on function public.decline_partnership_request from public;
revoke execute on function public.decline_partnership_request from anon;
grant execute on function public.decline_partnership_request to authenticated;

-- 4) Retrait (entreprise demandeuse uniquement, owner/admin/member — jamais viewer) --
create or replace function public.withdraw_partnership_request(p_request_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  select * into v_request from public.partnership_requests where id = p_request_id for update;
  if v_request is null then
    raise exception 'Demande introuvable.';
  end if;
  if not public.has_company_role(v_request.requester_company_id, array['owner', 'admin', 'member']) then
    raise exception 'Seule l''entreprise demandeuse peut retirer cette demande.' using errcode = '42501';
  end if;
  if v_request.status not in ('pending', 'pending_unclaimed') then
    raise exception 'Cette demande ne peut plus être retirée.';
  end if;

  update public.partnership_requests
  set status = 'withdrawn', withdrawn_at = now()
  where id = p_request_id;

  -- Pas de notification au retrait (§14 de la demande ne le prévoit pas) :
  -- pour pending_unclaimed, il n'y a de toute façon aucun membre cible à
  -- notifier ; pour pending, la cible n'a pas encore agi.
  perform public.log_audit_event(
    'partnership_request_withdrawn', 'partnership_request', p_request_id,
    jsonb_build_object('status', v_request.status), jsonb_build_object('status', 'withdrawn')
  );

  return json_build_object('id', p_request_id, 'status', 'withdrawn');
end;
$$;

revoke all on function public.withdraw_partnership_request from public;
revoke execute on function public.withdraw_partnership_request from anon;
grant execute on function public.withdraw_partnership_request to authenticated;

-- 5) Visibilité après revendication — alternative DÉCOUPLÉE retenue ------------
--
-- Plutôt que de re-déclarer intégralement submit_company_claim/
-- review_company_claim (0018, ~90 lignes chacune) pour y ajouter un seul
-- appel — ce qui obligerait à comparer minutieusement chaque ligne
-- reproduite pour prouver qu'aucun comportement historique n'a changé —
-- cette version utilise un DÉCLENCHEUR sur companies.claimed_at : les deux
-- fonctions de revendication mutent déjà cette colonne par un simple
-- "update public.companies set claimed_at = ..." (0018, inchangé). Un
-- déclencheur AFTER UPDATE OF claimed_at, qui ne se déclenche QUE lors de
-- la transition NULL -> non NULL, capture les deux chemins (auto-
-- approbation ET approbation manuelle) sans toucher un seul caractère de
-- submit_company_claim/review_company_claim. Plus sûr (zéro risque de
-- régression sur une zone sensible déjà testée), plus court, et
-- fonctionne aussi pour toute FUTURE voie qui revendiquerait une
-- entreprise en touchant directement cette colonne.
create or replace function public.promote_unclaimed_partnership_requests(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_member_user_id uuid;
begin
  for v_request_id in
    update public.partnership_requests
    set status = 'pending'
    where target_company_id = p_company_id and status = 'pending_unclaimed'
    returning id
  loop
    for v_member_user_id in
      select user_id from public.company_members
      where company_id = p_company_id and role in ('owner', 'admin') and status = 'active'
    loop
      perform public.create_notification(
        v_member_user_id,
        'partnership_request_received',
        jsonb_build_object('request_id', v_request_id, 'newly_visible', true)
      );
    end loop;
  end loop;
end;
$$;

comment on function public.promote_unclaimed_partnership_requests is
  'Appelée uniquement par le déclencheur companies_claimed_at_promote_requests '
  'ci-dessous (transition claimed_at NULL -> non NULL) — jamais exposée à '
  'un client, jamais appelée directement par submit_company_claim/'
  'review_company_claim (0018, non modifiées).';

revoke all on function public.promote_unclaimed_partnership_requests from public, anon, authenticated;

create or replace function public.trigger_promote_unclaimed_partnership_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.promote_unclaimed_partnership_requests(new.id);
  return new;
end;
$$;

revoke all on function public.trigger_promote_unclaimed_partnership_requests from public, anon, authenticated;

create trigger companies_claimed_at_promote_requests
  after update of claimed_at on public.companies
  for each row
  when (old.claimed_at is null and new.claimed_at is not null)
  execute function public.trigger_promote_unclaimed_partnership_requests();
