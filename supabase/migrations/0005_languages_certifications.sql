-- Phase 2 — Langues de travail et certifications
--
-- languages ici décrit les langues COMMERCIALES d'une entreprise (dans
-- lesquelles elle peut faire affaire), à ne pas confondre avec
-- profiles.preferred_language qui est la langue de L'INTERFACE pour une
-- personne.

create table public.languages (
  code text primary key, -- ISO 639-1 (ex. 'fr', 'en', 'es')
  name_fr text not null,
  name_en text not null
);

insert into public.languages (code, name_fr, name_en) values
  ('fr', 'Français', 'French'),
  ('en', 'Anglais', 'English'),
  ('es', 'Espagnol', 'Spanish'),
  ('de', 'Allemand', 'German');

create table public.company_languages (
  company_id uuid not null references public.companies (id) on delete cascade,
  language_code text not null references public.languages (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id, language_code)
);

comment on table public.company_languages is
  'Langues de travail commerciales d''une entreprise (pas la langue de '
  'l''interface d''un utilisateur, voir profiles.preferred_language).';

-- Certifications : catalogue standardisé (pour la recherche/le filtre) +
-- l'instance propre à chaque entreprise (émetteur, référence, validité).
create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.company_certifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  certification_id uuid not null references public.certifications (id) on delete restrict,
  issuer text,
  reference text,
  valid_from date,
  valid_until date,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified')),
  created_at timestamptz not null default now()
);

-- RLS
alter table public.languages enable row level security;
create policy "languages_select_all" on public.languages for select using (true);
create policy "languages_write_admin" on public.languages
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.certifications enable row level security;
create policy "certifications_select_all" on public.certifications for select using (true);
create policy "certifications_write_admin" on public.certifications
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.company_languages enable row level security;
create policy "company_languages_select_public" on public.company_languages
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_languages_write_owner_admin_member" on public.company_languages
  for all
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());

alter table public.company_certifications enable row level security;
create policy "company_certifications_select_public" on public.company_certifications
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );
create policy "company_certifications_write_owner_admin_member" on public.company_certifications
  for all
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());
