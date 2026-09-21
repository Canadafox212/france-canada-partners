-- Phase 10C, LOT 10C-4 — Publication / activation sécurisée.
--
-- Faille corrigée (audit indépendant Cowork) : companies_update_owner_admin
-- (0002) n'a pas de WITH CHECK — un owner/admin autorisé à modifier SA
-- fiche pouvait, en un seul UPDATE, écrire n'importe quelle valeur de
-- companies.status, y compris 'active', sans passer par aucune validation.
-- Symptôme observé côté interface : le libellé "Activée — visible dans le
-- matching" (Company.activatedLabel) était calculé par
-- computeCompanyActivation() — une fonction de PRÉPARATION DE PROFIL
-- (description/secteur/localisation/offre-besoin), totalement indépendante
-- de companies.status — si bien qu'une entreprise 'draft' au profil complet
-- affichait "Activée" alors qu'elle n'était ni publique, ni réellement
-- visible du moteur de matching (qui filtre déjà correctement
-- companies.status = 'active', voir src/lib/matching/candidateGeneration.ts).
--
-- Modèle retenu, deux notions jamais fusionnées :
--   - PRÉPARATION AU MATCHING : calcul applicatif pur (déjà existant,
--     computeCompanyActivation()), renommé dans l'interface, jamais dans
--     ce fichier.
--   - PUBLICATION : companies.status = 'active', décision de plateforme
--     exclusivement via review_company_publication_request() ci-dessous.
--
-- Séquence : draft -> (profil prêt) -> request_company_publication()
-- -> company_publication_requests.status = 'pending' -> admin approuve ou
-- refuse via review_company_publication_request() -> 'active' ou 'draft'
-- (avec motif). Aucune voie de libre-service directe vers 'active'.
--
-- Ne touche à AUCUNE des migrations 0001-0025. 0024 et 0025 restent
-- immuables : create_partnership_request et
-- protect_companies_platform_fields sont redéfinies ici (create or
-- replace), les fichiers d'origine ne changent pas.

-- =====================================================================
-- A — Table company_publication_requests
-- =====================================================================
create table public.company_publication_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_note text
);

comment on table public.company_publication_requests is
  'Demande de publication (draft -> active) déposée par owner/admin de '
  'l''entreprise. requested_by/reviewed_by en ON DELETE SET NULL (même '
  'convention que audit_logs.actor_user_id, 0008) : la suppression d''un '
  'compte utilisateur ne doit jamais être bloquée par une ancienne demande, '
  'ni entraîner sa suppression. Écriture exclusivement via '
  'request_company_publication() et review_company_publication_request() '
  '(SECURITY DEFINER) : aucune politique RLS INSERT/UPDATE/DELETE n''est '
  'créée pour authenticated/anon, ce qui rend une écriture directe '
  'structurellement impossible — même principe que company_claims (0018).';

create index company_publication_requests_company_idx
  on public.company_publication_requests (company_id);

-- Empêche deux demandes 'pending' simultanées pour la même entreprise,
-- y compris sous appels concurrents réels : un simple contrôle applicatif
-- ("SELECT puis INSERT si absent") laisserait une fenêtre de course. Cet
-- index unique PARTIEL (portant uniquement sur status = 'pending') rejette
-- le second INSERT concurrent avec une violation de contrainte, que
-- request_company_publication() capture et traduit en
-- PUBLICATION_ALREADY_PENDING. Ne porte pas sur 'rejected'/'approved' :
-- une nouvelle demande reste possible après un refus, une fois le profil
-- corrigé.
create unique index company_publication_requests_one_pending_per_company
  on public.company_publication_requests (company_id)
  where status = 'pending';

alter table public.company_publication_requests enable row level security;

create policy "company_publication_requests_select_member_or_admin" on public.company_publication_requests
  for select
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

-- Aucune politique INSERT/UPDATE/DELETE pour authenticated/anon (voir
-- commentaire de table ci-dessus).

-- =====================================================================
-- B — Critères de préparation, centralisés dans une seule fonction
-- =====================================================================
-- Appelée à l'identique par request_company_publication() (au moment de
-- la demande) ET review_company_publication_request() (au moment de
-- l'approbation) : une seule définition, jamais deux calculs qui
-- pourraient diverger. Colonnes vérifiées depuis le schéma réel — aucune
-- colonne "industry_id"/"description" directement sur companies :
-- description vit dans company_translations, secteur dans
-- company_industries (table de jonction), localisation dans
-- company_locations, offre/besoin actif dans company_offers/company_needs
-- (status = 'active', 0013).
--
-- Fonction interne, jamais destinée à être appelée directement par un
-- rôle HTTP : REVOKE ALL FROM PUBLIC ci-dessous, aucun GRANT ni à anon ni
-- à authenticated — seules les deux fonctions SECURITY DEFINER qui
-- suivent, exécutées avec les privilèges du propriétaire, peuvent
-- l'appeler. Même convention que has_company_role()/is_platform_admin()
-- (0001/0002), qui n'ont elles non plus jamais de GRANT explicite.
create or replace function public.is_company_ready_for_publication(p_company_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select
    exists (
      select 1 from public.company_members
      where company_id = p_company_id and role in ('owner', 'admin') and status = 'active'
    )
    and exists (
      select 1 from public.company_translations
      where company_id = p_company_id
        and description is not null and length(trim(description)) > 0
    )
    and exists (
      select 1 from public.company_industries where company_id = p_company_id
    )
    and exists (
      select 1 from public.company_locations where company_id = p_company_id
    )
    and (
      exists (select 1 from public.company_offers where company_id = p_company_id and status = 'active')
      or exists (select 1 from public.company_needs where company_id = p_company_id and status = 'active')
    );
$$;

revoke all on function public.is_company_ready_for_publication from public;

-- Enveloppe en LECTURE SEULE, réservée au platform admin, pour que
-- /admin/publications puisse afficher "profil prêt : oui/non" SANS
-- dupliquer les 5 critères en TypeScript (ce que la conception initiale
-- faisait à tort). is_company_ready_for_publication() reste strictement
-- interne (REVOKE ALL FROM PUBLIC ci-dessus, jamais de GRANT à
-- authenticated) ; cette enveloppe est le SEUL chemin par lequel un rôle
-- HTTP peut en lire le résultat, et uniquement s'il est admin plateforme.
create or replace function public.admin_is_company_ready_for_publication(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return public.is_company_ready_for_publication(p_company_id);
end;
$$;

comment on function public.admin_is_company_ready_for_publication is
  'Seul point d''accès HTTP à is_company_ready_for_publication() (qui reste '
  'interne) — réservé au platform admin, utilisé par /admin/publications '
  'pour éviter de dupliquer les critères en TypeScript.';

revoke all on function public.admin_is_company_ready_for_publication from public;
revoke execute on function public.admin_is_company_ready_for_publication from anon;
grant execute on function public.admin_is_company_ready_for_publication to authenticated;

-- =====================================================================
-- C — request_company_publication()
-- =====================================================================
create or replace function public.request_company_publication(p_company_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_request_id uuid;
begin
  if v_user_id is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;

  -- Permission recalculée depuis auth.uid() + l'appartenance réelle en
  -- base, jamais depuis une supposition côté client.
  if not public.has_company_role(p_company_id, array['owner', 'admin']) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select status into v_status from public.companies where id = p_company_id;
  if v_status is null then
    raise exception 'Entreprise introuvable.';
  end if;
  if v_status = 'active' then
    raise exception 'ALREADY_PUBLISHED';
  end if;
  if v_status = 'suspended' then
    raise exception 'COMPANY_SUSPENDED';
  end if;
  if v_status = 'archived' then
    raise exception 'COMPANY_ARCHIVED';
  end if;
  -- Seul 'draft' continue au-delà de ce point.

  -- Critères recalculés côté serveur — jamais un booléen envoyé par le
  -- client (§6 de la demande).
  if not public.is_company_ready_for_publication(p_company_id) then
    raise exception 'PUBLICATION_PROFILE_INCOMPLETE';
  end if;

  begin
    insert into public.company_publication_requests (company_id, requested_by)
    values (p_company_id, v_user_id)
    returning id into v_request_id;
  exception
    when unique_violation then
      -- Course concurrente : un autre appel a déjà créé la demande
      -- 'pending' pour cette entreprise entre notre vérification et notre
      -- INSERT — couvert par company_publication_requests_one_pending_per_company,
      -- jamais exposé comme une erreur SQL brute.
      raise exception 'PUBLICATION_ALREADY_PENDING';
  end;

  perform public.log_audit_event(
    'company_publication_requested', 'company', p_company_id,
    null, jsonb_build_object('request_id', v_request_id)
  );

  return json_build_object('id', v_request_id, 'status', 'pending');
end;
$$;

comment on function public.request_company_publication is
  'Réservée owner/admin de l''entreprise. Recalcule '
  'is_company_ready_for_publication() côté serveur. La course concurrente '
  '(deux appels simultanés) est couverte par l''index unique partiel, pas '
  'par un contrôle applicatif SELECT-puis-INSERT.';

revoke all on function public.request_company_publication from public;
revoke execute on function public.request_company_publication from anon;
grant execute on function public.request_company_publication to authenticated;

-- =====================================================================
-- D — review_company_publication_request()
-- =====================================================================
create or replace function public.review_company_publication_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request record;
  v_company_status text;
  v_member_user_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Décision invalide.';
  end if;

  -- Verrou de ligne AVANT toute lecture de son statut — même patron que
  -- review_company_claim() (0018) : si deux admins traitent la même
  -- demande en même temps, le second attend le commit du premier, relit
  -- alors un statut déjà changé et sort proprement en
  -- PUBLICATION_REQUEST_ALREADY_REVIEWED — jamais une double décision
  -- (impossible d'avoir "admin A = approve" et "admin B = reject" sur la
  -- même demande).
  select * into v_request
  from public.company_publication_requests
  where id = p_request_id
  for update;

  if v_request is null then
    raise exception 'Demande introuvable.';
  end if;
  if v_request.status != 'pending' then
    raise exception 'PUBLICATION_REQUEST_ALREADY_REVIEWED';
  end if;

  if p_decision = 'rejected' then
    -- REJECT reste une décision humaine explicite : jamais déclenché
    -- automatiquement par une revalidation de profil (voir cas APPROVE
    -- ci-dessous, qui NE rejette JAMAIS automatiquement).
    update public.company_publication_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), review_note = p_note
    where id = p_request_id;

    perform public.log_audit_event(
      'company_publication_rejected', 'company', v_request.company_id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected')
    );

    -- Notifie les owner/admin ACTUELS de l'entreprise, pas seulement
    -- requested_by : ce dernier peut être devenu NULL (compte supprimé)
    -- ou n'être plus owner/admin — la notification appartient à
    -- l'entreprise, pas uniquement à la personne ayant soumis la demande.
    for v_member_user_id in
      select user_id from public.company_members
      where company_id = v_request.company_id and role in ('owner', 'admin') and status = 'active'
    loop
      perform public.create_notification(
        v_member_user_id, 'company_publication_rejected',
        jsonb_build_object('request_id', p_request_id, 'company_id', v_request.company_id)
      );
    end loop;

    return json_build_object('id', p_request_id, 'status', 'rejected');
  end if;

  -- APPROVE : verrouille aussi la ligne companies. Ordre FIXE dans TOUTE
  -- la migration (company_publication_requests d'abord, companies
  -- ensuite) — aucune autre fonction de ce lot ne verrouille ces deux
  -- tables dans l'ordre inverse, ce qui exclut tout deadlock par
  -- verrouillage croisé entre ces deux RPC.
  select status into v_company_status from public.companies where id = v_request.company_id for update;

  if v_company_status != 'draft' then
    if v_company_status = 'active' then
      raise exception 'ALREADY_PUBLISHED';
    elsif v_company_status = 'suspended' then
      raise exception 'COMPANY_SUSPENDED';
    else
      raise exception 'COMPANY_ARCHIVED';
    end if;
  end if;

  -- Revalidation OBLIGATOIRE au moment de l'approbation, pas seulement au
  -- moment de la demande (correction explicite du porteur du projet) :
  -- si le profil n'est plus prêt (ex. l'offre/besoin qui le rendait
  -- complet a été désactivé entre la demande et l'approbation), l'admin
  -- ne peut PAS approuver — mais ce n'est PAS un refus automatique.
  -- La demande RESTE 'pending' (aucun reviewed_at/reviewed_by écrit,
  -- aucun review_note généré) : l'entreprise peut corriger son profil et
  -- l'admin pourra réessayer APPROVE sur cette même demande plus tard.
  -- REJECT reste une décision humaine explicite, jamais automatique.
  if not public.is_company_ready_for_publication(v_request.company_id) then
    raise exception 'PUBLICATION_PROFILE_INCOMPLETE';
  end if;

  update public.companies set status = 'active' where id = v_request.company_id;

  update public.company_publication_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id;

  perform public.log_audit_event(
    'company_publication_approved', 'company', v_request.company_id,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'active')
  );

  for v_member_user_id in
    select user_id from public.company_members
    where company_id = v_request.company_id and role in ('owner', 'admin') and status = 'active'
  loop
    perform public.create_notification(
      v_member_user_id, 'company_publication_approved',
      jsonb_build_object('request_id', p_request_id, 'company_id', v_request.company_id)
    );
  end loop;

  return json_build_object('id', p_request_id, 'status', 'approved');
end;
$$;

comment on function public.review_company_publication_request is
  'Réservé aux administrateurs de la plateforme. Revalide '
  'is_company_ready_for_publication() au moment de l''approbation : un '
  'profil redevenu incomplet entre la demande et l''approbation NE '
  'déclenche PAS un rejet automatique — la demande reste pending et peut '
  'être réessayée après correction. review_note jamais copié dans '
  'audit_logs.';

revoke all on function public.review_company_publication_request from public;
revoke execute on function public.review_company_publication_request from anon;
grant execute on function public.review_company_publication_request to authenticated;

-- =====================================================================
-- E — Protection de companies.status (redéfinition de 0009, jamais modifiée)
-- =====================================================================
-- companies_update_owner_admin (0002) n'a pas de WITH CHECK : un
-- owner/admin autorisé à modifier SA fiche pouvait, sans cette
-- protection, écrire n'importe quelle valeur de status — y compris
-- 'active' — en un seul UPDATE, contournant entièrement le workflow de
-- publication ci-dessus. status rejoint ici la liste déjà protégée par
-- ce trigger (subscription_level, verification_status depuis 0009), sans
-- toucher au fichier 0009 ni recréer le trigger lui-même (seule la
-- fonction qu'il exécute est redéfinie — même patron que la redéfinition
-- de create_company()/submit_company_claim() en 0025).
--
-- Compromis explicitement validé par le porteur du projet (LOT 10C-4) :
-- un administrateur de la plateforme PEUT modifier companies.status par
-- un UPDATE direct (mécanisme de secours), mais JAMAIS silencieusement —
-- log_audit_event() s'exécute dans tous les cas où le champ change, y
-- compris pour un admin, exactement comme c'était déjà le cas pour
-- subscription_level/verification_status. Le chemin normal reste
-- request_company_publication()/review_company_publication_request()
-- ci-dessus ; ce trigger ne fait qu'empêcher un contournement SILENCIEUX,
-- pas un contournement tracé et volontaire par un admin.
--
-- CONVENTION INCHANGÉE DEPUIS 0009 (status ne fait qu'y rejoindre les deux
-- champs déjà couverts, aucun changement de logique) :
--   - auth.uid() IS NULL reste un contexte DE CONFIANCE (migration, script
--     serveur avec la clé de service, éditeur SQL du dashboard) : la
--     condition "auth.uid() is not null and not is_platform_admin()" est
--     alors fausse par construction, l'exception n'est jamais levée.
--   - CONSÉQUENCE EXPLICITE, VOLONTAIRE : un script utilisant la clé de
--     service (ex. import, seed, tout script serveur futur) PEUT publier
--     une entreprise en écrivant directement status = 'active' — SANS
--     passer par request_company_publication()/
--     review_company_publication_request(). Ce n'est pas un oubli : le
--     rôle service a toujours eu ce pouvoir pour subscription_level/
--     verification_status (0009) et cette migration ne fait qu'étendre
--     status à la même règle déjà en vigueur, plutôt que d'inventer un
--     régime différent pour ce seul champ.
--   - CE QUI CHANGE RÉELLEMENT : ce n'est PAS silencieux. log_audit_event()
--     s'exécute inconditionnellement dans les DEUX cas qui évitent
--     l'exception (auth.uid() IS NULL, ou admin plateforme authentifié) —
--     toute écriture de ces trois champs, quelle que soit sa provenance,
--     laisse une trace dans audit_logs.company_platform_fields_changed.
create or replace function public.protect_companies_platform_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.subscription_level is distinct from old.subscription_level
     or new.verification_status is distinct from old.verification_status
     or new.status is distinct from old.status then
    if auth.uid() is not null and not public.is_platform_admin() then
      raise exception 'subscription_level, verification_status et status ne peuvent être modifiés que par un administrateur de la plateforme'
        using errcode = '42501';
    end if;
    perform public.log_audit_event(
      'company_platform_fields_changed',
      'company',
      new.id,
      jsonb_build_object('subscription_level', old.subscription_level, 'verification_status', old.verification_status, 'status', old.status),
      jsonb_build_object('subscription_level', new.subscription_level, 'verification_status', new.verification_status, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

comment on function public.protect_companies_platform_fields is
  'Protège subscription_level, verification_status et status (status '
  'ajouté en LOT 10C-4, 0026) contre une écriture directe par un '
  'utilisateur authentifié non-admin. auth.uid() IS NULL (clé de service, '
  'migration, éditeur SQL) reste un contexte de confiance, convention '
  'inchangée depuis 0009 : un script à clé de service peut donc publier '
  'une entreprise (status = ''active'') sans passer par '
  'request_company_publication()/review_company_publication_request() — '
  'volontaire, jamais silencieux (log_audit_event systématique).';

-- =====================================================================
-- F — create_partnership_request() : messages -> codes stables uniquement
-- =====================================================================
-- Redéfinition de la fonction de 0024 (qui reste un fichier immuable).
-- SEUL changement métier : 4 messages français destinés à l'interface
-- deviennent des codes stables, traduits FR/EN côté application
-- (RequestPartnershipButton.tsx), même convention déjà amorcée par
-- RATE_LIMIT_EXCEEDED en 0024 :
--   'Vous devez être autorisé à agir au nom de cette entreprise.'
--     -> 'NOT_AUTHORIZED'
--   'Votre entreprise doit être active pour envoyer une demande...'
--     -> 'REQUESTER_NOT_ACTIVE'
--   'Cette entreprise n''est pas disponible pour une mise en relation.'
--     -> 'TARGET_NOT_ACTIVE'
--   'Une demande est déjà en cours entre ces deux entreprises.'
--     -> 'DUPLICATE_ACTIVE_REQUEST'
-- Tout le reste — verrou advisory, seuil 20/heure glissante, provenance
-- MATCH, provenance OPPORTUNITY, notifications, permissions, règles
-- pending/pending_unclaimed, validation cible/demandeur — est repris à
-- l'identique du corps de 0024, caractère pour caractère. Seule
-- exception non fonctionnelle : le commentaire ci-dessous sur le
-- caractère "draft" de l'entreprise demandeuse, devenu factuellement
-- inexact depuis ce lot (une entreprise draft PEUT désormais devenir
-- active en libre-service via publication) — mis à jour pour ne pas
-- induire un futur lecteur en erreur, sans aucun changement de
-- comportement.
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
set search_path = pg_catalog, public
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
  v_recent_request_count int;
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
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Entreprise demandeuse : doit être 'active'. Depuis LOT 10C-4, une
  -- entreprise 'draft' dispose d'une voie de libre-service vers 'active'
  -- (request_company_publication() + validation admin via
  -- review_company_publication_request()) — ce n'est plus un cas
  -- bloquant par absence de parcours, mais une contrainte produit
  -- normale : seule une entreprise publiée peut solliciter une mise en
  -- relation.
  select status into v_requester_status from public.companies where id = p_requester_company_id;
  if v_requester_status is null then
    raise exception 'Entreprise demandeuse introuvable.';
  end if;
  if v_requester_status != 'active' then
    raise exception 'REQUESTER_NOT_ACTIVE';
  end if;

  select status, claimed_at into v_target_status, v_target_claimed_at
  from public.companies where id = p_target_company_id;

  if v_target_status is null then
    raise exception 'Entreprise cible introuvable.';
  end if;
  if v_target_status != 'active' then
    raise exception 'TARGET_NOT_ACTIVE';
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
    raise exception 'DUPLICATE_ACTIVE_REQUEST';
  end if;

  -- Anti-rafale (§B de la demande LOT 10C-2) : compte TOUTES les demandes
  -- créées par cette entreprise, quel que soit leur statut actuel, sur la
  -- dernière heure glissante — jamais filtré par actor_user_id, pour que
  -- plusieurs membres de la même entreprise partagent la même limite.
  --
  -- Verrou consultatif transactionnel AVANT le COUNT (revue de sécurité) :
  -- un simple "COUNT puis INSERT" n'est PAS atomique — deux appels
  -- concurrents pour la MÊME entreprise (ex. 19 demandes existantes, deux
  -- requêtes simultanées) pourraient tous les deux lire 19, tous les deux
  -- passer le contrôle, et produire 21 lignes au lieu de 20 au maximum.
  -- pg_advisory_xact_lock() sérialise les appels concurrents portant sur
  -- la MÊME entreprise demandeuse (hashtextextended() réduit l'UUID à un
  -- entier 64 bits utilisable comme clé de verrou) : le second appel
  -- attend que le premier ait validé (ou annulé) sa transaction avant de
  -- faire son propre COUNT, qui reflète alors correctement l'insertion
  -- précédente. Portée : par ENTREPRISE (p_requester_company_id), jamais
  -- par utilisateur — deux appels pour deux entreprises différentes ne se
  -- bloquent jamais mutuellement. Verrou automatiquement relâché à la fin
  -- de la transaction (variante "xact"), aucun déverrouillage manuel requis.
  perform pg_advisory_xact_lock(hashtextextended(p_requester_company_id::text, 0));

  select count(*) into v_recent_request_count
  from public.partnership_requests
  where requester_company_id = p_requester_company_id
    and created_at >= now() - interval '1 hour';

  if v_recent_request_count >= 20 then
    raise exception 'RATE_LIMIT_EXCEEDED';
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
  '(§17 de la demande Phase 9). Anti-rafale ajouté en Phase 10C (LOT '
  '10C-2) : 20 demandes maximum par entreprise demandeuse sur une heure '
  'glissante, sérialisé par pg_advisory_xact_lock(). LOT 10C-4 : messages '
  'destinés à l''UI convertis en codes stables (REQUESTER_NOT_ACTIVE, '
  'TARGET_NOT_ACTIVE, DUPLICATE_ACTIVE_REQUEST, NOT_AUTHORIZED) — aucun '
  'autre changement de comportement.';

revoke all on function public.create_partnership_request from public;
revoke execute on function public.create_partnership_request from anon;
grant execute on function public.create_partnership_request to authenticated;

-- =====================================================================
-- G — Resserrement de companies_insert_authenticated (0011 non modifiée)
-- =====================================================================
-- Faille distincte de celle corrigée en section E : la politique
-- d'INSERT (0011) ne contraint que l'AUTHENTIFICATION (auth.uid() is not
-- null), jamais les VALEURS insérées. N'importe quel utilisateur
-- authentifié pouvait donc faire un INSERT direct sur companies (via
-- l'API REST, pas via l'UI — CreateCompanyForm.tsx passe déjà par
-- create_company()) avec status='active', verification_status='verified'
-- ou subscription_level='business', se publiant/vérifiant/surclassant
-- instantanément sans jamais passer par aucune RPC officielle. Aucun
-- trigger before insert n'existe pour rattraper ce cas (les deux
-- triggers after insert existants — rattachement owner en 0002,
-- journalisation en 0009 — ne valident rien).
--
-- Valeurs par défaut réelles de ces trois colonnes (lues directement dans
-- 0002, jamais supposées) : status = 'draft', verification_status =
-- 'unverified', subscription_level = 'free' — toutes trois NOT NULL (donc
-- un simple "ou NULL" n'a pas de sens ici : Postgres substitue déjà la
-- valeur par défaut avant l'évaluation du WITH CHECK si la colonne est
-- omise de l'INSERT).
--
-- Vérifié explicitement (pas supposé) que ce resserrement ne casse
-- AUCUN chemin existant :
--   - create_company() (0010/0012/0025) : SECURITY DEFINER, ne fait
--     JAMAIS figurer status/verification_status/subscription_level dans
--     la liste de colonnes de son propre INSERT (valeurs par défaut
--     systématiquement appliquées) — ET, indépendamment, aucune
--     migration ne définit FORCE ROW LEVEL SECURITY sur companies ni ne
--     réassigne son propriétaire (aucun "OWNER TO" dans tout le projet) :
--     le propriétaire de la table est exempté de RLS par défaut en
--     PostgreSQL, et create_company() s'exécute avec les privilèges de
--     ce même propriétaire. Double garantie, pas une seule.
--   - src/lib/import/commit.ts : le client Supabase qu'il reçoit est
--     construit dans scripts/import-companies.ts avec
--     env.SUPABASE_SECRET_KEY (service_role) — tracé directement, pas
--     supposé. service_role contourne entièrement la RLS (voir
--     docs/SECURITY.md).
--   - scripts/seed-demo-data.mjs : construit lui-même son client avec
--     SUPABASE_SECRET_KEY — même contournement RLS.
drop policy if exists "companies_insert_authenticated" on public.companies;

create policy "companies_insert_authenticated" on public.companies
  for insert
  with check (
    auth.uid() is not null
    and (status = 'draft' or public.is_platform_admin())
    and (subscription_level = 'free' or public.is_platform_admin())
    and (verification_status = 'unverified' or public.is_platform_admin())
  );
