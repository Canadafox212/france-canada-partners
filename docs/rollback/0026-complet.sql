-- ============================================================================
-- RETOUR ARRIÈRE COMPLET — 0026_secure_company_publication.sql (LOT 10C-4)
-- ============================================================================
-- Reconstruit depuis le texte des migrations commitées (0009, 0011, 0024,
-- 0026), jamais depuis une introspection de la production — même principe
-- que docs/rollback/0026-fonctions-avant.sql (fichier PARTIEL, conservé tel
-- quel à côté de celui-ci, non modifié).
--
-- ORDRE D'EXÉCUTION OBLIGATOIRE : 0026 (ce fichier), PUIS 0025, PUIS 0024.
-- create_partnership_request() n'a qu'une seule version vivante en base à
-- la fois (CREATE OR REPLACE) : la chaîne réelle est 0023 -> 0024 -> 0026.
-- Ce que ce script restaure ici, c'est la version 0024 de cette fonction —
-- docs/rollback/0024-dedup-et-anti-rafale.sql part ENSUITE de cette version
-- 0024 pour revenir à 0023. Exécuter 0024 avant 0026 écraserait
-- silencieusement une partie de 0026 (conversion des messages en codes)
-- sans que ce soit tracé nulle part.
--
-- DONNÉES PERDUES : la table company_publication_requests est supprimée à
-- la section 4 — TOUT l'historique des demandes de publication (en
-- attente, approuvées, refusées, avec leur motif) est perdu
-- DÉFINITIVEMENT, sans possibilité de récupération par ce script. Si des
-- demandes réelles existent au moment de l'exécution, les exporter AVANT
-- (ex. `select * from company_publication_requests`) si leur historique
-- doit être conservé.
--
-- FAILLES DE SÉCURITÉ ROUVERTES (corrigées par 0026, audit indépendant
-- Cowork — voir CHANGELOG.md, LOT 10C-4) :
--   1. UPDATE direct de companies.status : un owner/admin autorisé à
--      modifier sa propre fiche peut de nouveau écrire n'importe quelle
--      valeur de status, y compris 'active', en un seul UPDATE, sans
--      passer par aucune validation ni par le workflow de publication.
--   2. INSERT avec valeurs élevées : un utilisateur authentifié peut de
--      nouveau insérer directement une ligne companies avec
--      status='active', verification_status='verified' ou
--      subscription_level='business' via l'API REST, sans passer par
--      create_company() ni par aucune RPC officielle.
-- Aucune des deux n'est silencieuse dans la version 0026 (log_audit_event
-- systématique) — après ce rollback, elles ne sont plus tracées du tout.
--
-- IMPORTANT après exécution : RequestPartnershipButton.tsx (interface)
-- traduit actuellement les codes stables (NOT_AUTHORIZED,
-- REQUESTER_NOT_ACTIVE, TARGET_NOT_ACTIVE, DUPLICATE_ACTIVE_REQUEST) —
-- après restauration de la version 0024 de create_partnership_request()
-- (messages français bruts), l'interface affichera ces phrases comme si
-- elles étaient des clés de traduction inconnues. Revoir ce composant en
-- même temps que tout usage réel de ce script.
--
-- Coller dans le SQL Editor du tableau de bord Supabase, comme toute
-- migration de ce projet (voir docs/DATABASE.md).
-- ============================================================================

-- =====================================================================
-- 1. protect_companies_platform_fields() — restaure la version 0009
-- =====================================================================
create or replace function public.protect_companies_platform_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subscription_level is distinct from old.subscription_level
     or new.verification_status is distinct from old.verification_status then
    if auth.uid() is not null and not public.is_platform_admin() then
      raise exception 'subscription_level et verification_status ne peuvent être modifiés que par un administrateur de la plateforme'
        using errcode = '42501';
    end if;
    perform public.log_audit_event(
      'company_platform_fields_changed',
      'company',
      new.id,
      jsonb_build_object('subscription_level', old.subscription_level, 'verification_status', old.verification_status),
      jsonb_build_object('subscription_level', new.subscription_level, 'verification_status', new.verification_status)
    );
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 2. companies_insert_authenticated — restaure la version 0011
-- =====================================================================
drop policy if exists "companies_insert_authenticated" on public.companies;

create policy "companies_insert_authenticated" on public.companies
  for insert
  with check (auth.uid() is not null);

-- =====================================================================
-- 3. create_partnership_request() — restaure la version 0024
-- =====================================================================
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

  if not public.has_company_role(p_requester_company_id, array['owner', 'admin', 'member']) then
    raise exception 'Vous devez être autorisé à agir au nom de cette entreprise.' using errcode = '42501';
  end if;

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

revoke all on function public.create_partnership_request from public;
revoke execute on function public.create_partnership_request from anon;
grant execute on function public.create_partnership_request to authenticated;

-- =====================================================================
-- 4. Objets créés PAR 0026 — suppression complète (PERTE DE DONNÉES,
--    voir en-tête). Contrairement à 0026-fonctions-avant.sql, ces
--    instructions sont ICI actives, pas commentées : ce fichier EST le
--    rollback complet.
-- =====================================================================
drop function if exists public.review_company_publication_request(uuid, text, text);
drop function if exists public.request_company_publication(uuid);
drop function if exists public.admin_is_company_ready_for_publication(uuid);
drop function if exists public.is_company_ready_for_publication(uuid);
drop table if exists public.company_publication_requests;
