-- ============================================================================
-- RETOUR ARRIÈRE — 0025_protect_company_contacts.sql (LOT 10C-3)
-- ============================================================================
-- Reconstruit depuis le texte des migrations commitées (0012, 0018, 0025),
-- jamais depuis une introspection de la production.
--
-- ORDRE D'EXÉCUTION OBLIGATOIRE : 0026 (docs/rollback/0026-complet.sql),
-- PUIS 0025 (ce fichier), PUIS 0024
-- (docs/rollback/0024-dedup-et-anti-rafale.sql). Aucune dépendance
-- technique directe trouvée entre 0025 et 0024/0026 (create_company()/
-- submit_company_claim() ne sont touchées ni par 0024 ni par 0026) — cet
-- ordre suit simplement l'ordre chronologique d'application, par prudence.
--
-- ORDRE INTERNE DE CE SCRIPT — DIFFÉRENT DE L'ORDRE NAÏF (contraintes ->
-- copie), CORRIGÉ AVANT ÉCRITURE : les CHECK ajoutées par 0025 empêchent
-- toute écriture dans companies.professional_email/phone tant qu'elles
-- existent. Il faut donc : 1) supprimer les 2 contraintes, 2) recopier
-- company_contacts vers companies AVEC vérification ligne par ligne (la
-- transaction échoue et s'annule intégralement au moindre écart — même
-- discipline que la migration 0025 elle-même, à l'envers), 3) restaurer
-- create_company() (version 0012) et submit_company_claim() (version
-- 0018), 4) seulement alors supprimer company_contacts.
--
-- DONNÉES PERDUES : AUCUNE si ce script s'exécute jusqu'au bout — c'est
-- précisément le but de l'ordre ci-dessus. Si l'étape 2 (vérification)
-- échoue, tout le script est annulé (transaction unique) et rien n'est
-- perdu ni modifié. Le seul cas de perte réelle serait une exécution
-- PARTIELLE hors transaction (ex. collé morceau par morceau dans le SQL
-- Editor) qui supprimerait company_contacts sans avoir d'abord vérifié la
-- recopie — ne jamais faire ça : coller ce fichier en une seule fois.
--
-- FAILLE DE SÉCURITÉ ROUVERTE (corrigée par 0025 — voir CHANGELOG.md, LOT
-- 10C-3) : ramène professional_email/phone en clair dans companies, qui
-- reste lisible PUBLIQUEMENT au niveau ligne pour toute entreprise active
-- (companies_select_public_active, 0002 — la RLS ne filtre jamais par
-- colonne). N'importe quel client interrogeant companies directement avec
-- les mêmes droits qu'avant 0025 (anon ou authentifié, selon la requête)
-- peut de nouveau lire ces coordonnées. Ce script SQL ne republie PAS ces
-- champs sur /entreprises/[slug] par lui-même (loadCompanyBySlug() ne les
-- sélectionne plus côté TypeScript depuis 0025) — mais la donnée
-- redevient accessible en base à quiconque contourne l'interface (API
-- REST directe, par exemple), exactement le problème original.
--
-- Coller dans le SQL Editor du tableau de bord Supabase, comme toute
-- migration de ce projet (voir docs/DATABASE.md).
-- ============================================================================

-- =====================================================================
-- 1. Suppression des 2 contraintes CHECK (0025)
-- =====================================================================
alter table public.companies
  drop constraint if exists companies_professional_email_legacy_null,
  drop constraint if exists companies_phone_legacy_null;

-- =====================================================================
-- 2. Recopie company_contacts -> companies
-- =====================================================================
update public.companies c
set professional_email = cc.professional_email,
    phone = cc.phone
from public.company_contacts cc
where cc.company_id = c.id;

-- =====================================================================
-- 3. Vérification RÉELLE de la recopie (pas un simple COUNT) — échec ->
--    RAISE EXCEPTION, toute la transaction (donc aussi l'étape 1 et la
--    suppression de company_contacts si elle avait déjà eu lieu) est
--    annulée.
-- =====================================================================
do $$
declare
  v_mismatch_count int;
begin
  select count(*) into v_mismatch_count
  from public.company_contacts cc
  join public.companies c on c.id = cc.company_id
  where c.professional_email is distinct from cc.professional_email
     or c.phone is distinct from cc.phone;

  if v_mismatch_count > 0 then
    raise exception
      'Recopie de company_contacts vers companies incomplète ou divergente : % ligne(s) '
      'concernée(s). Retour arrière annulé, company_contacts non supprimée.',
      v_mismatch_count;
  end if;
end;
$$;

-- =====================================================================
-- 4. create_company() — restaure la version 0012
-- =====================================================================
create or replace function public.create_company(
  p_legal_name text,
  p_display_name text,
  p_slug text,
  p_country_code text,
  p_website text default null,
  p_professional_email text default null,
  p_phone text default null,
  p_region text default null,
  p_city text default null,
  p_industry_id uuid default null,
  p_description text default null,
  p_description_locale text default 'fr'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_final_slug text := p_slug;
  v_suffix int := 1;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise pour créer une entreprise.'
      using errcode = '42501';
  end if;

  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'Le nom commercial est requis.';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'Le slug est requis.';
  end if;

  while exists (select 1 from public.companies where slug = v_final_slug) loop
    v_suffix := v_suffix + 1;
    v_final_slug := p_slug || '-' || v_suffix;
  end loop;

  insert into public.companies (
    legal_name, display_name, slug, country_code, website, professional_email, phone
  )
  values (
    coalesce(nullif(trim(p_legal_name), ''), p_display_name),
    p_display_name, v_final_slug, p_country_code, p_website, p_professional_email, p_phone
  )
  returning id into v_company_id;

  insert into public.company_locations (company_id, location_type, is_primary, region, city, country_code)
  values (v_company_id, 'headquarters', true, p_region, p_city, p_country_code);

  if p_industry_id is not null then
    insert into public.company_industries (company_id, industry_id, is_primary)
    values (v_company_id, p_industry_id, true);
  end if;

  if p_description is not null and length(trim(p_description)) > 0 then
    insert into public.company_translations (company_id, locale, description)
    values (v_company_id, p_description_locale, p_description);
  end if;

  return json_build_object('id', v_company_id, 'slug', v_final_slug);
end;
$$;

revoke execute on function public.create_company from anon;
grant execute on function public.create_company to authenticated;

-- =====================================================================
-- 5. submit_company_claim() — restaure la version 0018
-- =====================================================================
create or replace function public.submit_company_claim(
  p_company_id uuid,
  p_professional_email text,
  p_justification text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_company_domain text;
  v_claim_domain text;
  v_member_count int;
  v_claim_id uuid;
  v_status text := 'pending';
  v_method text := 'manual';
  v_freemail_domains text[] := array[
    'gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'yahoo.com', 'live.com', 'aol.com', 'protonmail.com'
  ];
begin
  if v_user_id is null then
    raise exception 'Connexion requise.' using errcode = '28000';
  end if;
  if p_professional_email is null or position('@' in p_professional_email) = 0 then
    raise exception 'Adresse courriel professionnelle invalide.';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Entreprise introuvable.';
  end if;
  if exists (
    select 1 from public.company_claims
    where company_id = p_company_id and user_id = v_user_id and status in ('pending', 'verified')
  ) then
    raise exception 'Une revendication est déjà en cours pour cette entreprise.';
  end if;

  select email into v_user_email from auth.users where id = v_user_id;
  v_claim_domain := lower(split_part(p_professional_email, '@', 2));
  select lower(split_part(professional_email, '@', 2)) into v_company_domain
    from public.companies where id = p_company_id and professional_email is not null;
  select count(*) into v_member_count from public.company_members where company_id = p_company_id;

  if v_company_domain is not null
     and v_claim_domain = v_company_domain
     and not (v_claim_domain = any(v_freemail_domains)) then
    v_method := 'domain_match';
    if lower(split_part(coalesce(v_user_email, ''), '@', 2)) = v_claim_domain
       and v_member_count = 0 then
      v_status := 'approved';
    end if;
  end if;

  insert into public.company_claims (
    company_id, user_id, professional_email, verification_method, status, justification,
    reviewed_at
  )
  values (
    p_company_id, v_user_id, p_professional_email, v_method, v_status, p_justification,
    case when v_status = 'approved' then now() else null end
  )
  returning id into v_claim_id;

  if v_status = 'approved' then
    insert into public.company_members (company_id, user_id, role, status, joined_at)
    values (p_company_id, v_user_id, 'owner', 'active', now())
    on conflict (company_id, user_id) do nothing;
    update public.companies set claimed_at = now() where id = p_company_id;
    perform public.log_audit_event(
      'company_claim_auto_approved', 'company_claim', v_claim_id,
      null, jsonb_build_object('company_id', p_company_id, 'method', v_method)
    );
  else
    perform public.log_audit_event(
      'company_claim_submitted', 'company_claim', v_claim_id,
      null, jsonb_build_object('company_id', p_company_id, 'method', v_method)
    );
  end if;

  return json_build_object('id', v_claim_id, 'status', v_status);
end;
$$;

revoke execute on function public.submit_company_claim from anon;
grant execute on function public.submit_company_claim to authenticated;

-- =====================================================================
-- 6. Nettoyage des commentaires "OBSOLÈTE" laissés par 0025
-- =====================================================================
comment on column public.companies.professional_email is null;
comment on column public.companies.phone is null;

-- =====================================================================
-- 7. Suppression de company_contacts (données déjà recopiées et
--    vérifiées à l'étape 3) — entraîne aussi le trigger
--    set_company_contacts_updated_at et les 3 politiques RLS de la table.
-- =====================================================================
drop table if exists public.company_contacts;
