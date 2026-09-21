-- Phase 10C, LOT 10C-3 — Protection des coordonnées professionnelles.
--
-- companies reste lisible publiquement AU NIVEAU LIGNE pour toute
-- entreprise active (companies_select_public_active, migration 0002) —
-- Postgres RLS ne restreint jamais par colonne. professional_email et
-- phone ne doivent donc plus jamais y résider en clair : elles vivent
-- désormais dans public.company_contacts, une table séparée avec sa
-- propre RLS strictement réservée aux membres de l'entreprise et aux
-- administrateurs de la plateforme.
--
-- Séquence obligatoire (revue de sécurité, refus explicite d'une période
-- transitoire où les vraies valeurs resteraient lisibles dans companies) :
--   A. créer company_contacts + RLS ;
--   B. copier les données existantes ;
--   C. VÉRIFIER RÉELLEMENT la copie, ligne par ligne (pas un simple COUNT
--      — deux jeux de données différents peuvent avoir le même nombre de
--      lignes) ; échec -> RAISE EXCEPTION, toute la migration est annulée
--      (un script SQL exécuté tel quel est une seule transaction : rien
--      n'est appliqué, pas même la création de la table) ;
--   D. rediriger create_company() et submit_company_claim() ;
--   E. mettre à NULL les anciennes colonnes ;
--   F. contraintes CHECK empêchant toute future valeur non nulle —
--      préférées à un trigger correcteur silencieux : si du code ancien
--      ou oublié tente encore d'écrire une valeur, l'erreur est immédiate
--      et visible, jamais une correction silencieuse.
--
-- Étape B (suppression physique des colonnes) : migration future
-- séparée, seulement après validation en production — PAS dans ce lot.
--
-- Ne touche à AUCUNE des migrations 0001-0024. 0024 reste immuable.

-- =====================================================================
-- A — Table company_contacts
-- =====================================================================
create table public.company_contacts (
  company_id uuid primary key references public.companies (id) on delete cascade,
  professional_email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_contacts is
  'Coordonnées professionnelles d''une entreprise (Phase 10C, LOT 10C-3) — '
  'JAMAIS publiques, contrairement à companies (lisible en ligne pour '
  'toute entreprise active). Lecture réservée aux membres de l''entreprise '
  '(owner/admin/member/viewer) et aux administrateurs de la plateforme ; '
  'écriture réservée à owner/admin. Voir docs/SECURITY.md.';

create trigger set_company_contacts_updated_at
  before update on public.company_contacts
  for each row execute function public.set_updated_at();

alter table public.company_contacts enable row level security;

create policy "company_contacts_select_member_or_admin" on public.company_contacts
  for select
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "company_contacts_insert_owner_admin" on public.company_contacts
  for insert
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  );

create policy "company_contacts_update_owner_admin" on public.company_contacts
  for update
  using (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  );

-- Aucune politique DELETE (§ demande explicite) : pour retirer des
-- coordonnées, owner/admin mettent professional_email/phone à NULL via
-- UPDATE — jamais de suppression de ligne en libre-service, même
-- principe que companies elle-même (0002, "pas de politique de
-- suppression"). Seule la suppression en cascade depuis companies
-- (réservée au rôle service) retire une ligne company_contacts.

-- =====================================================================
-- B — Copie des données existantes
-- =====================================================================
insert into public.company_contacts (company_id, professional_email, phone)
select id, professional_email, phone
from public.companies
where professional_email is not null or phone is not null;

-- =====================================================================
-- C — Vérification RÉELLE de la copie (pas un simple COUNT)
-- =====================================================================
-- Compare, pour CHAQUE entreprise ayant une valeur non nulle avant
-- migration, la présence ET l'égalité stricte des deux valeurs côté
-- company_contacts. "is distinct from" traite NULL correctement (deux
-- NULL sont considérés égaux, contrairement à =). Si la moindre ligne
-- manque ou diverge, la migration entière échoue AVANT toute mise à NULL
-- des anciennes colonnes.
do $$
declare
  v_mismatch_count int;
begin
  select count(*) into v_mismatch_count
  from public.companies c
  left join public.company_contacts cc on cc.company_id = c.id
  where (c.professional_email is not null or c.phone is not null)
    and (
      cc.company_id is null
      or cc.professional_email is distinct from c.professional_email
      or cc.phone is distinct from c.phone
    );

  if v_mismatch_count > 0 then
    raise exception
      'Copie de company_contacts incomplète ou divergente : % ligne(s) '
      'concernée(s). Migration annulée, aucune colonne legacy modifiée.',
      v_mismatch_count;
  end if;
end;
$$;

-- =====================================================================
-- D — create_company() redéfinie : signature publique inchangée
-- =====================================================================
-- p_professional_email/p_phone restent acceptés (aucune rupture pour
-- CreateCompanyForm.tsx, qui continue d'appeler exactement pareil) —
-- mais la valeur réelle va désormais dans company_contacts, jamais dans
-- companies (NULL explicite, cohérent avec la contrainte ajoutée en F).
-- search_path durci à "pg_catalog, public" (même durcissement que 0024) ;
-- comportement transactionnel inchangé (une fonction PL/pgSQL est déjà
-- une seule transaction de bout en bout — aucun risque d'écriture
-- partielle entre companies et company_contacts).
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
set search_path = pg_catalog, public
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
    p_display_name, v_final_slug, p_country_code, p_website, null, null
  )
  returning id into v_company_id;

  if p_professional_email is not null or p_phone is not null then
    insert into public.company_contacts (company_id, professional_email, phone)
    values (v_company_id, p_professional_email, p_phone);
  end if;

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

comment on function public.create_company is
  'Crée une entreprise et ses données associées (établissement principal, '
  'secteur principal, description, coordonnées) en une seule transaction. '
  'professional_email/phone sont écrites dans company_contacts depuis la '
  'Phase 10C (LOT 10C-3) — jamais dans companies, qui reste lisible '
  'publiquement au niveau ligne pour les entreprises actives.';

revoke all on function public.create_company from public;
revoke execute on function public.create_company from anon;
grant execute on function public.create_company to authenticated;

-- =====================================================================
-- E — submit_company_claim() redéfinie : UN SEUL changement de source
-- =====================================================================
-- p_professional_email reste l'email fourni par le DEMANDEUR (inchangé,
-- table company_claims, jamais concernée par ce lot). Seul
-- v_company_domain change de source : company_contacts au lieu de
-- companies. Aucun autre comportement ne change (méthode, seuil
-- d'auto-approbation, comptage de membres, journal d'audit).
create or replace function public.submit_company_claim(
  p_company_id uuid,
  p_professional_email text,
  p_justification text default null
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public
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
  -- Phase 10C (LOT 10C-3) : source déplacée de companies vers
  -- company_contacts — seule ligne changée dans cette fonction.
  select lower(split_part(professional_email, '@', 2)) into v_company_domain
    from public.company_contacts where company_id = p_company_id and professional_email is not null;
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

comment on function public.submit_company_claim is
  'Point d''entrée UNIQUE pour créer une revendication — voir '
  'docs/CLAIMING.md. Le domaine professionnel de l''entreprise est lu '
  'depuis company_contacts depuis la Phase 10C (LOT 10C-3), jamais depuis '
  'companies.';

revoke all on function public.submit_company_claim from public;
revoke execute on function public.submit_company_claim from anon;
grant execute on function public.submit_company_claim to authenticated;

-- =====================================================================
-- F — Neutralisation des colonnes legacy
-- =====================================================================
-- Ne touche que les lignes réellement concernées (déjà toutes copiées et
-- vérifiées à l'étape C) — évite de déclencher inutilement le trigger
-- updated_at des lignes déjà NULL des deux côtés.
update public.companies
set professional_email = null, phone = null
where professional_email is not null or phone is not null;

-- Contraintes CHECK plutôt qu'un trigger correcteur silencieux : toute
-- tentative future d'écrire une valeur non nulle échoue immédiatement et
-- de façon visible, au lieu d'être silencieusement ramenée à NULL. Les
-- colonnes restent physiquement présentes (compatibilité descendante du
-- schéma) jusqu'à une Étape B séparée qui les supprimera après validation
-- en production — jamais mélangée à cette migration.
alter table public.companies
  add constraint companies_professional_email_legacy_null check (professional_email is null),
  add constraint companies_phone_legacy_null check (phone is null);

comment on column public.companies.professional_email is
  'OBSOLÈTE depuis la Phase 10C (LOT 10C-3) — toujours NULL (contrainte '
  'companies_professional_email_legacy_null). La vraie valeur vit dans '
  'company_contacts.professional_email. Colonne conservée temporairement '
  'pour compatibilité de schéma, sera supprimée par une migration future '
  'séparée (Étape B), après validation en production.';

comment on column public.companies.phone is
  'OBSOLÈTE depuis la Phase 10C (LOT 10C-3) — toujours NULL (contrainte '
  'companies_phone_legacy_null). La vraie valeur vit dans '
  'company_contacts.phone. Colonne conservée temporairement pour '
  'compatibilité de schéma, sera supprimée par une migration future '
  'séparée (Étape B), après validation en production.';
