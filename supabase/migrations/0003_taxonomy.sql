-- Phase 2 — Taxonomie sectorielle et produits/services
--
-- Nomenclature propre à la plateforme, volontairement indépendante de toute
-- nomenclature officielle (NAF/APE, NAICS/SCIAN...). Une table de
-- correspondance (ex. industry_code_mappings) pourra être ajoutée plus tard
-- si le besoin de faire correspondre ces nomenclatures officielles se
-- confirme — inutile de l'anticiper avant d'en avoir l'usage réel.

create table public.industries (
  id uuid primary key default gen_random_uuid(),
  name_fr text not null,
  name_en text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.subindustries (
  id uuid primary key default gen_random_uuid(),
  industry_id uuid not null references public.industries (id) on delete cascade,
  name_fr text not null,
  name_en text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Une entreprise peut appartenir à plusieurs secteurs ; is_primary désigne
-- le secteur principal affiché en priorité (ex. dans les résultats de
-- recherche).
create table public.company_industries (
  company_id uuid not null references public.companies (id) on delete cascade,
  industry_id uuid not null references public.industries (id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (company_id, industry_id)
);

create unique index company_industries_one_primary_per_company
  on public.company_industries (company_id)
  where is_primary;

create table public.company_subindustries (
  company_id uuid not null references public.companies (id) on delete cascade,
  subindustry_id uuid not null references public.subindustries (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id, subindustry_id)
);

-- Produits et services : vocabulaire structuré (pas de texte libre) pour
-- permettre la recherche et le matching. label_fr/label_en car ce sont des
-- valeurs de référence partagées entre entreprises (contrairement aux
-- descriptions saisies par une entreprise, qui restent dans sa langue).
create table public.products_services (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('product', 'service')),
  subindustry_id uuid references public.subindustries (id) on delete set null,
  label_fr text not null,
  label_en text not null,
  slug text not null unique,
  category text,
  created_at timestamptz not null default now()
);

-- Rattachement d'un produit/service à une entreprise, avec une description
-- libre complémentaire propre à cette entreprise (ex. une spécificité de
-- fabrication) en plus du libellé standardisé.
create table public.company_products_services (
  company_id uuid not null references public.companies (id) on delete cascade,
  product_service_id uuid not null references public.products_services (id) on delete restrict,
  description text,
  created_at timestamptz not null default now(),
  primary key (company_id, product_service_id)
);

-- RLS : tables de référence lisibles par tout le monde (nécessaires aux
-- filtres de l'annuaire public), modifiables uniquement par un
-- administrateur de la plateforme.
alter table public.industries enable row level security;
alter table public.subindustries enable row level security;
alter table public.products_services enable row level security;

create policy "industries_select_all" on public.industries
  for select using (true);
create policy "industries_write_admin" on public.industries
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "subindustries_select_all" on public.subindustries
  for select using (true);
create policy "subindustries_write_admin" on public.subindustries
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "products_services_select_all" on public.products_services
  for select using (true);
create policy "products_services_write_admin" on public.products_services
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- RLS : rattachements entreprise <-> taxonomie, lisibles publiquement si
-- l'entreprise est active, modifiables par les membres habilités de
-- l'entreprise (mêmes règles que le reste du profil d'entreprise).
alter table public.company_industries enable row level security;
alter table public.company_subindustries enable row level security;
alter table public.company_products_services enable row level security;

create policy "company_industries_select_public" on public.company_industries
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_industries_write_owner_admin" on public.company_industries
  for all
  using (public.has_company_role(company_id, array['owner', 'admin']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin']) or public.is_platform_admin());

create policy "company_subindustries_select_public" on public.company_subindustries
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_subindustries_write_owner_admin" on public.company_subindustries
  for all
  using (public.has_company_role(company_id, array['owner', 'admin']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin']) or public.is_platform_admin());

create policy "company_products_services_select_public" on public.company_products_services
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_products_services_write_owner_admin" on public.company_products_services
  for all
  using (public.has_company_role(company_id, array['owner', 'admin']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin']) or public.is_platform_admin());
