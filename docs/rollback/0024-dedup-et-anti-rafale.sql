-- ============================================================================
-- RETOUR ARRIÈRE — 0024_dedup_search_and_rate_limit.sql (LOT 10C-2)
-- ============================================================================
-- Reconstruit depuis le texte des migrations commitées (0023, 0024),
-- jamais depuis une introspection de la production.
--
-- ORDRE D'EXÉCUTION OBLIGATOIRE : 0026 (docs/rollback/0026-complet.sql),
-- PUIS 0025 (docs/rollback/0025-protection-coordonnees.sql), PUIS 0024
-- (ce fichier) — DERNIER de la séquence, jamais avant les deux autres.
-- create_partnership_request() n'a qu'une seule version vivante en base à
-- la fois (CREATE OR REPLACE) : la chaîne réelle est 0023 -> 0024 -> 0026.
-- Ce script restaure la version 0023, en partant de la version 0024 que
-- docs/rollback/0026-complet.sql doit avoir déjà remise en place. Exécuter
-- ce fichier avant 0026-complet.sql écraserait silencieusement la version
-- 0026 de cette même fonction (conversion des messages en codes stables)
-- sans que ce soit tracé nulle part.
--
-- DONNÉES PERDUES : AUCUNE. Cette migration ne créait que des fonctions
-- (2 pures/lecture, 1 lecture SECURITY DEFINER), 1 index et 1 fonction
-- redéfinie — aucun de ces objets ne stocke de donnée propre. Les lignes
-- déjà présentes dans partnership_requests, companies, etc. ne sont pas
-- affectées.
--
-- FAILLE DE SÉCURITÉ ROUVERTE (corrigée par 0024 — voir CHANGELOG.md, LOT
-- 10C-2) : supprime l'anti-rafale de create_partnership_request() — une
-- entreprise authentifiée peut de nouveau envoyer un nombre ILLIMITÉ de
-- demandes de mise en relation, sans la limite de 20/heure glissante ni le
-- verrou pg_advisory_xact_lock qui protégeait contre la course critique
-- entre COUNT et INSERT sous appels concurrents.
--
-- RÉGRESSION FONCTIONNELLE (pas une faille rouverte, une fonctionnalité
-- qui disparaît) : la détection de doublon avant création d'entreprise
-- (find_similar_companies(), get_company_claim_preview(),
-- DuplicateWarning.tsx côté interface) cesse de fonctionner — les 2 RPC
-- qu'elle appelle n'existent plus après ce script. CreateCompanyForm.tsx
-- continuera de fonctionner (la recherche de doublon y est un
-- avertissement, pas un blocage), mais échouera silencieusement à
-- avertir d'un doublon existant tant que 0024 n'est pas réappliquée.
--
-- Coller dans le SQL Editor du tableau de bord Supabase, comme toute
-- migration de ce projet (voir docs/DATABASE.md).
-- ============================================================================

-- =====================================================================
-- 1. create_partnership_request() — restaure la version 0023
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
-- 2. Suppression de l'index composite ajouté par 0024
-- =====================================================================
drop index if exists public.partnership_requests_requester_created_idx;

-- =====================================================================
-- 3. Suppression des 2 RPC de détection de doublon (0024)
-- =====================================================================
drop function if exists public.get_company_claim_preview(text);
drop function if exists public.find_similar_companies(text, text, text, text, text);

-- =====================================================================
-- 4. Suppression de la fonction utilitaire de normalisation (0024)
-- =====================================================================
drop function if exists public.extract_website_domain(text);
