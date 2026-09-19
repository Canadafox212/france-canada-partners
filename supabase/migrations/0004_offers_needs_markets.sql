-- Phase 2 — Offres, besoins et marchés géographiques
--
-- Cœur futur de la plateforme : ce que l'entreprise PROPOSE (company_offers)
-- et ce qu'elle RECHERCHE (company_needs). Les catégories possibles vivent
-- dans business_capability_types plutôt que d'être gravées en dur, pour
-- pouvoir évoluer depuis l'administration sans migration de schéma.

create table public.business_capability_types (
  code text primary key,
  label_fr text not null,
  label_en text not null,
  -- Une même catégorie peut être utilisable comme offre, comme besoin, ou
  -- les deux (ex. DISTRIBUTOR : "je suis distributeur" en offre, "je
  -- cherche un distributeur" en besoin).
  applies_to_offers boolean not null default true,
  applies_to_needs boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.business_capability_types is
  'Vocabulaire des types d''offre/besoin (DISTRIBUTOR, SUPPLIER, ...), '
  'éditable depuis l''administration plutôt que codé en dur.';

insert into public.business_capability_types (code, label_fr, label_en) values
  ('DISTRIBUTOR', 'Distributeur', 'Distributor'),
  ('SUPPLIER', 'Fournisseur', 'Supplier'),
  ('MANUFACTURER', 'Fabricant', 'Manufacturer'),
  ('SUBCONTRACTOR', 'Sous-traitant', 'Subcontractor'),
  ('IMPORTER', 'Importateur', 'Importer'),
  ('EXPORTER', 'Exportateur', 'Exporter'),
  ('SALES_AGENT', 'Agent commercial', 'Sales agent'),
  ('COMMERCIAL_PARTNER', 'Partenaire commercial', 'Commercial partner'),
  ('TECHNOLOGY_PARTNER', 'Partenaire technologique', 'Technology partner'),
  ('INDUSTRIAL_PARTNER', 'Partenaire industriel', 'Industrial partner'),
  ('INVESTOR', 'Investisseur', 'Investor'),
  ('JOINT_VENTURE', 'Coentreprise', 'Joint venture'),
  ('SERVICES', 'Services', 'Services'),
  ('MANUFACTURING_CAPACITY', 'Capacité de fabrication', 'Manufacturing capacity'),
  ('DISTRIBUTION_CAPACITY', 'Capacité de distribution', 'Distribution capacity');

-- Ce que l'entreprise PROPOSE.
create table public.company_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  capability_type_code text not null references public.business_capability_types (code) on delete restrict,
  description text,
  -- Zone visée par CETTE offre précise (distincte des marchés généraux de
  -- l'entreprise dans company_markets ci-dessous).
  target_country_code text check (target_country_code is null or char_length(target_country_code) = 2),
  target_region text,
  created_at timestamptz not null default now()
);

-- Ce que l'entreprise RECHERCHE.
create table public.company_needs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  capability_type_code text not null references public.business_capability_types (code) on delete restrict,
  description text,
  target_country_code text check (target_country_code is null or char_length(target_country_code) = 2),
  target_region text,
  created_at timestamptz not null default now()
);

comment on table public.company_offers is 'Ce que l''entreprise propose (voir company_needs pour ce qu''elle recherche).';
comment on table public.company_needs is 'Ce que l''entreprise recherche (voir company_offers pour ce qu''elle propose).';

-- Marchés géographiques de l'entreprise elle-même (positionnement général,
-- distinct de la zone d'une offre/besoin précis ci-dessus, et distinct de
-- sa localisation physique dans company_locations).
create table public.company_markets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  market_type text not null check (market_type in ('current', 'target')),
  country_code text not null check (char_length(country_code) = 2),
  region text,
  city text,
  created_at timestamptz not null default now()
);

comment on table public.company_markets is
  'Marchés ACTUELS (déjà servis) ou CIBLES (recherchés) de l''entreprise. '
  'Pas limité à France/Québec : conçu pour couvrir tout pays dès le départ.';

-- RLS
alter table public.business_capability_types enable row level security;
create policy "business_capability_types_select_all" on public.business_capability_types
  for select using (true);
create policy "business_capability_types_write_admin" on public.business_capability_types
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.company_offers enable row level security;
alter table public.company_needs enable row level security;
alter table public.company_markets enable row level security;

create policy "company_offers_select_public" on public.company_offers
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_offers_write_owner_admin_member" on public.company_offers
  for all
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());

create policy "company_needs_select_public" on public.company_needs
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_needs_write_owner_admin_member" on public.company_needs
  for all
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());

create policy "company_markets_select_public" on public.company_markets
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_markets_write_owner_admin_member" on public.company_markets
  for all
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());
