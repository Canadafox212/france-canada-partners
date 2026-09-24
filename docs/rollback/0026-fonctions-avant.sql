-- ============================================================================
-- ⚠️ RECONSTRUCTION DEPUIS LES MIGRATIONS, PAS UNE INTROSPECTION DE LA
--    PRODUCTION ⚠️
-- ============================================================================
-- Plan de retour arrière PARTIEL pour 0026_secure_company_publication.sql
-- (Phase 10C, LOT 10C-4). Fichier non versionné (voir .gitignore).
--
-- Historique de ce fichier :
--   - Généré une première fois le 2026-09-21, AVANT l'application de la
--     migration 0026, en reconstruisant le corps des objets ci-dessous
--     depuis les fichiers de migration locaux (0009, 0024) — jamais en
--     exécutant pg_get_functiondef() ni aucune autre requête contre le
--     projet Supabase distant.
--   - Le 2026-09-23, ce fichier a été écrasé par erreur (réécrit sans
--     avoir été relu au préalable) lors d'un rattrapage de documentation
--     de la Phase 10C. Le contenu du 21 septembre a été retrouvé via les
--     points de contrôle internes de Claude Code (~/.claude/file-history/)
--     et confirmé identique à l'état du fichier juste avant l'écrasement.
--   - Cette version fusionne les deux : le corps couvre désormais un
--     troisième objet absent de la version initiale du 21 septembre (la
--     politique companies_insert_authenticated, 0011).
--
-- Origine section par section : les sections 1 et 3
-- (protect_companies_platform_fields, create_partnership_request) ont été
-- reconstruites le 21 septembre depuis 0009 et 0024 ; la section 2
-- (companies_insert_authenticated) a été reconstruite le 23 septembre
-- depuis 0011. Dans les trois cas, la reconstruction part du texte de la
-- migration source tel qu'écrit dans le dépôt, en supposant qu'aucune
-- modification manuelle n'a été appliquée directement en base entre
-- l'exécution de cette migration et la rédaction de 0026 — hypothèse
-- jamais vérifiée par introspection.
--
-- Pourquoi une reconstruction et pas une introspection réelle : cet
-- environnement ne dispose d'aucune chaîne de connexion Postgres directe
-- (seules NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
-- SUPABASE_SECRET_KEY sont configurées — des clés REST/PostgREST, pas une
-- connexion `postgres://`), aucun projet lié via `supabase link`, et
-- aucune fonction RPC n'expose une exécution SQL arbitraire.
--
-- IMPORTANT — pourquoi aucune requête d'introspection n'est incluse ici :
-- la migration 0026 est déjà appliquée en production. Exécuter
-- pg_get_functiondef() ou relire la politique actuelle ne donnerait
-- désormais que l'état APRÈS 0026, jamais l'état d'avant que ce fichier
-- documente — de telles requêtes seraient une fausse piste, pas une
-- vérification. Si une confirmation réelle de l'état pré-0026 est un jour
-- nécessaire, la seule voie possible serait une sauvegarde/point-in-time
-- recovery Supabase antérieure au 2026-09-21, si elle existe encore —
-- à vérifier au tableau de bord Supabase (Database → Backups), jamais
-- supposée.
--
-- USAGE EN CAS DE ROLLBACK après application de 0026 : exécuter les 3
-- blocs ci-dessous restaure exactement le comportement d'avant 0026 pour
-- ces trois objets (protection de companies.status retirée, contrainte
-- sur les valeurs insérées dans companies retirée, messages d'erreur de
-- create_partnership_request redevenus des phrases françaises). Cela ne
-- supprime PAS la table company_publication_requests ni les fonctions
-- request_company_publication() / review_company_publication_request() /
-- is_company_ready_for_publication() / admin_is_company_ready_for_publication()
-- créées par 0026 — voir la section 4, à n'exécuter qu'après décision
-- explicite, jamais automatiquement.
--
-- Coller dans le SQL Editor du tableau de bord Supabase, comme toute
-- migration de ce projet (voir docs/DATABASE.md, "Comment appliquer une
-- nouvelle migration").
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

-- IMPORTANT après exécution : RequestPartnershipButton.tsx (interface)
-- traduit actuellement les codes stables (NOT_AUTHORIZED,
-- REQUESTER_NOT_ACTIVE, TARGET_NOT_ACTIVE, DUPLICATE_ACTIVE_REQUEST) —
-- si cette fonction est restaurée sans aussi revenir sur ce composant,
-- l'interface affichera ces messages français bruts comme s'ils étaient
-- déjà des clés de traduction inconnues. Revoir ce composant en même temps
-- que tout usage réel de ce script.

-- =====================================================================
-- 4. Objets créés PAR 0026 à supprimer en cas de rollback complet
--    (À NE FAIRE QU'APRÈS DÉCISION EXPLICITE — jamais automatique)
-- =====================================================================
-- drop function if exists public.review_company_publication_request(uuid, text, text);
-- drop function if exists public.request_company_publication(uuid);
-- drop function if exists public.admin_is_company_ready_for_publication(uuid);
-- drop function if exists public.is_company_ready_for_publication(uuid);
-- drop table if exists public.company_publication_requests;
