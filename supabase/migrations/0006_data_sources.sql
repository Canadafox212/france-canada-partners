-- Phase 2 — Traçabilité des sources de données
--
-- Répond à "d'où provient cette information ?" pour chaque donnée importée.
-- data_sources = catalogue des sources connues (SIRENE, INPI, Corporations
-- Canada, inscription directe...). company_source_records = le lien entre
-- une entreprise et chacune de ses sources (une entreprise peut en avoir
-- plusieurs, notamment après une fusion de doublons).
--
-- Aucun import n'est effectué dans cette phase : ces tables préparent
-- seulement la structure. Voir data/README.md pour les données brutes déjà
-- collectées (non versionnées, non importées).

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- ex. "SIRENE", "INPI", "Corporations Canada", "Inscription directe"
  url text,
  source_type text not null
    check (source_type in ('open_data', 'registry', 'partner', 'manual_entry', 'admin_import')),
  license_name text,
  license_url text,
  created_at timestamptz not null default now()
);

comment on table public.data_sources is
  'Catalogue des sources de données connues, avec leur licence. À vérifier '
  'source par source avant tout import (voir data/README.md et PROJECT_SPEC.md §12).';

create table public.company_source_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  data_source_id uuid not null references public.data_sources (id) on delete restrict,
  -- Identifiant de cette entreprise DANS la source d'origine (ex. un SIREN).
  source_record_id text,
  -- Date à laquelle l'information a été observée dans la source (peut
  -- différer de la date d'import).
  source_date date,
  imported_at timestamptz not null default now(),
  last_verified_at timestamptz,
  -- Pointeur libre vers la donnée brute d'origine (ex. chemin de fichier,
  -- numéro de ligne) — volontairement un texte simple, pas un bloc JSON.
  raw_reference text,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'disputed')),
  created_at timestamptz not null default now()
);

comment on table public.company_source_records is
  'Une entreprise peut avoir plusieurs sources (ex. après fusion de '
  'doublons importés depuis deux registres différents).';

create index company_source_records_company_id_idx
  on public.company_source_records (company_id);

-- RLS : la provenance des données est une information de gouvernance
-- interne, pas un contenu public. Réservée aux administrateurs de la
-- plateforme ; les imports eux-mêmes (Phase 10) utiliseront la clé de
-- service, qui contourne la RLS.
alter table public.data_sources enable row level security;
create policy "data_sources_admin_only" on public.data_sources
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.company_source_records enable row level security;
create policy "company_source_records_admin_only" on public.company_source_records
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());
