-- Phase 8 (suite) — Pipeline d'import : staging, batches, garde-fou de licence
--
-- Voir docs/IMPORT_PIPELINE.md pour l'architecture complète. Principe
-- absolu : aucune ligne source ne passe JAMAIS directement d'un fichier à
-- `companies` — elle transite obligatoirement par `staging_companies`,
-- rattachée à un `import_batches`, avec un statut de licence vérifié à la
-- création du batch (déclencheur, pas seulement une vérification
-- applicative — un administrateur ne doit pas pouvoir la contourner par
-- accident).

-- 1) Statut de licence machine-lisible sur data_sources -----------------------
alter table public.data_sources
  add column license_status text not null default 'UNKNOWN'
    check (license_status in ('APPROVED_FOR_IMPORT', 'REVIEW_REQUIRED', 'DO_NOT_IMPORT', 'UNKNOWN')),
  add column commercial_use_allowed boolean not null default false;

comment on column public.data_sources.license_status is
  'Statut décidé lors de l''audit (docs/DATA_SOURCES.md) : seul '
  'APPROVED_FOR_IMPORT avec commercial_use_allowed = true permet la '
  'création d''un batch d''import sans dérogation administrateur explicite.';

-- Sources déjà tranchées par l'audit Phase 8 (voir docs/DATA_SOURCES.md).
-- Les sources encore "REVIEW_REQUIRED" ou "UNKNOWN" ne sont volontairement
-- pas toutes créées ici : seules celles utiles à ce jour (le pilote et son
-- contre-exemple bloqué) le sont, pour ne pas préremplir des lignes
-- inutilisées.
insert into public.data_sources (name, url, source_type, license_name, license_url, license_status, commercial_use_allowed) values
  (
    'Annuaire des Entreprises / API Recherche d''entreprises',
    'https://recherche-entreprises.api.gouv.fr/',
    'open_data',
    'Licence Ouverte 2.0 (Etalab)',
    'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    'APPROVED_FOR_IMPORT',
    true
  ),
  (
    'Répertoires sectoriels France (GIFAS, Minalogic, Polymeris, Medicen, Eurobiomed, Agri Sud-Ouest Innovation)',
    null,
    'registry',
    null,
    null,
    'REVIEW_REQUIRED',
    false
  ),
  (
    'Sourcing Québec (data/raw/quebec, REQ non intégré)',
    null,
    'registry',
    null,
    null,
    'DO_NOT_IMPORT',
    false
  )
on conflict (name) do nothing;

-- 2) import_batches -------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.data_sources (id) on delete restrict,
  batch_name text not null,
  filename text not null,
  country_code text not null check (char_length(country_code) = 2),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  dry_run boolean not null default true,
  rows_received int not null default 0,
  rows_valid int not null default 0,
  rows_warning int not null default 0,
  rows_quarantined int not null default 0,
  rows_rejected int not null default 0,
  rows_new int not null default 0,
  rows_existing int not null default 0,
  rows_duplicates int not null default 0,
  rows_created int not null default 0,
  rows_updated int not null default 0,
  -- Dérogation explicite au garde-fou de licence (voir déclencheur plus
  -- bas) : renseignée seulement si la source n'est pas approuvée et
  -- qu'un administrateur a explicitement choisi de passer outre.
  license_override_justification text,
  license_override_by uuid references public.profiles (id),
  license_override_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

comment on table public.import_batches is
  'Un batch = une exécution du pipeline sur UN fichier. dry_run=true ne '
  'crée jamais de ligne dans companies (voir staging_companies). Une '
  'exécution réelle correspond à un NOUVEAU batch (dry_run=false), pas à '
  'une mise à jour du batch de dry run — historique immuable des deux.';

comment on column public.import_batches.rows_new is 'Lignes sans correspondance connue (duplicate_level = NEW).';
comment on column public.import_batches.rows_existing is 'Lignes rattachées à une entreprise déjà existante (duplicate_level = EXACT, jamais recréées).';
comment on column public.import_batches.rows_duplicates is 'Lignes mises en quarantaine pour arbitrage humain (VERY_LIKELY/POSSIBLE/UNLIKELY).';

create index import_batches_source_idx on public.import_batches (source_id);
create index import_batches_status_idx on public.import_batches (status);

-- 3) staging_companies ------------------------------------------------------------
--
-- Colonnes structurées plutôt qu'un unique bloc JSON (cohérent avec le
-- principe déjà appliqué dans tout ce projet, voir docs/DATABASE.md
-- "Rappels de conception") : chaque champ normalisé doit pouvoir être
-- filtré/validé/comparé individuellement (ex. retrouver toutes les lignes
-- où le domaine du site est vide). `raw_record` fait exception assumée :
-- c'est une copie brute de la ligne source complète, utile UNIQUEMENT pour
-- l'audit humain d'une ligne précise (retrouver ce qui n'a pas été mappé),
-- jamais lue par une requête applicative — même logique que
-- `matches.score_breakdown` (Phase 6) ou `staging` au sens large.
create table public.staging_companies (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_number int not null,
  source_record_id text,

  raw_display_name text,
  raw_legal_name text,
  raw_registration_number text,
  raw_website text,
  raw_phone text,
  raw_email text,
  raw_country text,
  raw_region text,
  raw_city text,
  raw_postal_code text,
  raw_address text,
  raw_sector_code text,
  raw_sector_label text,
  raw_description text,

  normalized_display_name text,
  normalized_legal_name text,
  normalized_registration_number text,
  normalized_website text,
  normalized_website_domain text,
  normalized_phone text,
  normalized_email text,
  email_classification text
    check (email_classification is null or email_classification in ('GENERIC_BUSINESS', 'NAMED_BUSINESS', 'PUBLIC_PROVIDER', 'INVALID', 'UNKNOWN')),
  normalized_country_code text,
  normalized_region text,
  normalized_city text,
  normalized_postal_code text,
  normalized_address text,
  normalized_description text,

  validation_status text not null default 'VALID'
    check (validation_status in ('VALID', 'WARNING', 'REJECTED', 'QUARANTINED')),
  duplicate_level text
    check (duplicate_level is null or duplicate_level in ('EXACT', 'VERY_LIKELY', 'POSSIBLE', 'UNLIKELY', 'NEW')),
  duplicate_of_company_id uuid references public.companies (id),

  created_company_id uuid references public.companies (id),

  raw_record jsonb,

  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index staging_companies_batch_idx on public.staging_companies (batch_id);
create index staging_companies_validation_idx on public.staging_companies (validation_status);
create index staging_companies_duplicate_idx on public.staging_companies (duplicate_level);
create index staging_companies_registration_idx on public.staging_companies (normalized_registration_number);
create index staging_companies_domain_idx on public.staging_companies (normalized_website_domain);

-- 4) import_row_issues -------------------------------------------------------------
create table public.import_row_issues (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  staging_company_id uuid references public.staging_companies (id) on delete cascade,
  severity text not null check (severity in ('WARNING', 'ERROR')),
  code text not null,
  message text not null,
  field_name text,
  created_at timestamptz not null default now()
);

create index import_row_issues_batch_idx on public.import_row_issues (batch_id);
create index import_row_issues_staging_idx on public.import_row_issues (staging_company_id);

-- 5) import_duplicate_candidates ----------------------------------------------------
create table public.import_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  staging_company_id uuid not null references public.staging_companies (id) on delete cascade,
  -- Exactement une des deux cibles : une entreprise déjà en base, ou une
  -- AUTRE ligne du même batch (doublon interne au fichier importé).
  existing_company_id uuid references public.companies (id) on delete cascade,
  other_staging_company_id uuid references public.staging_companies (id) on delete cascade,
  match_level text not null check (match_level in ('EXACT', 'VERY_LIKELY', 'POSSIBLE', 'UNLIKELY')),
  match_signal text not null,
  created_at timestamptz not null default now(),
  check ((existing_company_id is not null) <> (other_staging_company_id is not null))
);

create index import_duplicate_candidates_batch_idx on public.import_duplicate_candidates (batch_id);

-- 6) Traçabilité : rattacher un enregistrement source à son batch --------------------
alter table public.company_source_records
  add column import_batch_id uuid references public.import_batches (id) on delete set null;

-- 7) Garde-fou de licence (§4 de la demande) -----------------------------------------
--
-- Bloque la CRÉATION d'un batch (dry run comme réel — un dry run sur une
-- source interdite n'a pas de sens non plus) si la source n'est pas
-- explicitement approuvée, sauf dérogation portant à la fois une
-- justification ET une référence à un profil administrateur. La
-- vérification porte sur le profil RÉFÉRENCÉ (license_override_by), pas
-- sur l'appelant courant : le pipeline s'exécute via un script de
-- confiance (clé secrète), qui n'a pas de session utilisateur authentifiée
-- au sens RLS — voir docs/IMPORT_PIPELINE.md.
create or replace function public.enforce_import_license_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_allowed boolean;
begin
  select license_status, commercial_use_allowed into v_status, v_allowed
    from public.data_sources where id = new.source_id;

  if v_status = 'APPROVED_FOR_IMPORT' and v_allowed then
    return new;
  end if;

  if new.license_override_justification is null or trim(new.license_override_justification) = '' then
    raise exception 'Source non autorisée pour import commercial (statut %) : une dérogation avec justification est requise.', v_status
      using errcode = '42501';
  end if;

  if new.license_override_by is null or not exists (
    select 1 from public.profiles where id = new.license_override_by and platform_role = 'admin'
  ) then
    raise exception 'La dérogation de licence doit référencer un administrateur de la plateforme.'
      using errcode = '42501';
  end if;

  new.license_override_at := now();
  perform public.log_audit_event(
    'import_license_override', 'import_batch', new.id,
    null, jsonb_build_object('source_id', new.source_id, 'status', v_status, 'justification', new.license_override_justification)
  );
  return new;
end;
$$;

create trigger enforce_import_license_gate_trigger
  before insert on public.import_batches
  for each row execute function public.enforce_import_license_gate();

-- 8) RLS : réservé aux administrateurs de la plateforme (§39) ------------------------
-- Le pipeline s'exécute via un script de confiance (clé secrète, qui
-- contourne la RLS) : ces politiques sont une seconde barrière, pas le
-- mécanisme principal — elles empêchent qu'un utilisateur normal, ou une
-- future interface web, n'accède à ces données sans être administrateur.
alter table public.import_batches enable row level security;
alter table public.staging_companies enable row level security;
alter table public.import_row_issues enable row level security;
alter table public.import_duplicate_candidates enable row level security;

create policy "import_batches_admin_only" on public.import_batches
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "staging_companies_admin_only" on public.staging_companies
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "import_row_issues_admin_only" on public.import_row_issues
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "import_duplicate_candidates_admin_only" on public.import_duplicate_candidates
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
