-- Phase 3 — Description d'entreprise multilingue
--
-- Remplace companies.description (colonne unique) par une table normalisée,
-- pour préparer proprement FR/EN sans dupliquer de colonnes _fr/_en sur
-- companies. Une entreprise n'est pas obligée de fournir les deux langues :
-- le repli vers la langue disponible est géré côté application (voir
-- src/lib/companies.ts), pas en base.
--
-- Migration additive : ne modifie pas le contenu des fichiers précédents.

create table public.company_translations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  locale text not null check (locale in ('fr', 'en')),
  description text,
  tagline text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, locale)
);

comment on table public.company_translations is
  'Description/accroche d''une entreprise par langue. Une entreprise peut '
  'n''avoir qu''une seule langue renseignée ; le repli vers la langue '
  'disponible se fait côté application, pas en base.';

create trigger set_company_translations_updated_at
  before update on public.company_translations
  for each row execute function public.set_updated_at();

-- Reprise des descriptions déjà saisies (le cas échéant) en 'fr' par défaut,
-- avant de retirer l'ancienne colonne.
insert into public.company_translations (company_id, locale, description)
select id, 'fr', description
from public.companies
where description is not null and length(trim(description)) > 0;

alter table public.companies drop column description;

-- RLS : même règle que le reste du profil d'entreprise.
alter table public.company_translations enable row level security;

create policy "company_translations_select_public" on public.company_translations
  for select
  using (
    exists (select 1 from public.companies c where c.id = company_id and c.status = 'active')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "company_translations_write_owner_admin_member" on public.company_translations
  for all
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());
