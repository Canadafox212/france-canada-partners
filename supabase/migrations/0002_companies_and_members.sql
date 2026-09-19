-- Phase 2 — Entreprises, établissements, et rattachement des utilisateurs
--
-- Une entreprise est indépendante de l'utilisateur qui l'a créée : elle peut
-- exister avant d'être revendiquée (import, saisie admin). Le rattachement
-- utilisateur <-> entreprise passe exclusivement par company_members, qui
-- permet dès le départ plusieurs utilisateurs par entreprise et un même
-- utilisateur rattaché à plusieurs entreprises.

-- Nécessaire pour le type "vector" (colonne embedding ci-dessous), réservé
-- au matching sémantique futur — voir PROJECT_SPEC.md §7.
create extension if not exists vector;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  slug text not null unique,
  -- Texte libre saisi par l'entreprise dans sa propre langue : voir
  -- PROJECT_SPEC.md §11 (pas de traduction automatique en MVP).
  description text,
  website text,
  professional_email text,
  phone text,
  -- Identifiant légal, format libre car il varie par pays (SIREN en France,
  -- NEQ au Québec, etc.) : pas de contrainte de format ici.
  company_registration_number text,
  country_code text not null check (char_length(country_code) = 2),
  employee_range text,
  revenue_range text,
  export_experience boolean not null default false,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified')),
  subscription_level text not null default 'free'
    check (subscription_level in ('free', 'premium', 'business')),
  profile_completion_score smallint not null default 0
    check (profile_completion_score between 0 and 100),
  -- Statut de cycle de vie (visibilité), distinct de verification_status
  -- (confiance) et de subscription_level (offre commerciale).
  status text not null default 'draft'
    check (status in ('draft', 'active', 'suspended', 'archived')),
  -- Réservé au matching sémantique futur (pgvector) — inutilisé en MVP,
  -- voir PROJECT_SPEC.md §7. Dimension 1536 = choix provisoire (taille
  -- courante des modèles d'embedding généralistes) ; à ajuster sans
  -- difficulté le jour où un modèle précis sera choisi, tant qu'aucune
  -- donnée n'a encore été écrite dans cette colonne.
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Entreprise. Existe indépendamment de tout utilisateur : voir company_members '
  'pour le rattachement, et claim_requests (phase ultérieure) pour la revendication.';

create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- Établissements : une entreprise peut avoir plusieurs adresses (siège,
-- usine, entrepôt...). L'adresse "principale" affichée par défaut est celle
-- marquée is_primary.
create table public.company_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  location_type text not null default 'headquarters'
    check (location_type in
      ('headquarters', 'office', 'factory', 'warehouse', 'branch', 'other')),
  address_line_1 text,
  address_line_2 text,
  city text,
  postal_code text,
  region text,
  country_code text not null check (char_length(country_code) = 2),
  latitude double precision,
  longitude double precision,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.company_locations is
  'Établissements d''une entreprise (peut en avoir plusieurs). is_primary '
  'désigne l''adresse affichée par défaut sur la fiche entreprise.';

-- Un seul établissement principal par entreprise.
create unique index company_locations_one_primary_per_company
  on public.company_locations (company_id)
  where is_primary;

-- Membres d'entreprise : rôle DANS L'ENTREPRISE (à ne pas confondre avec
-- profiles.platform_role, qui concerne l'administration de la plateforme).
create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'removed')),
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

comment on table public.company_members is
  'Rattachement utilisateur <-> entreprise avec un rôle propre à cette '
  'entreprise. Un utilisateur peut appartenir à plusieurs entreprises.';

-- Sécurité : fonction utilitaire pour vérifier si l'utilisateur courant a
-- un rôle donné dans une entreprise donnée, réutilisée par toutes les
-- tables liées à une entreprise dans les migrations suivantes.
create or replace function public.has_company_role(
  target_company_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

comment on function public.has_company_role is
  'Vrai si l''utilisateur connecté a un des rôles indiqués (actif) dans '
  'l''entreprise donnée. Utilisée par les politiques RLS des tables liées '
  'à une entreprise (offres, besoins, produits, etc.).';

-- Rattachement automatique : quand un utilisateur connecté crée une
-- entreprise, il en devient "owner" immédiatement. Sans effet lors d'une
-- création par un import/admin en service_role (auth.uid() alors nul) :
-- l'entreprise existe sans membre, en attente d'être revendiquée.
create or replace function public.handle_new_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.company_members (company_id, user_id, role, status, joined_at)
    values (new.id, auth.uid(), 'owner', 'active', now())
    on conflict (company_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_company_created
  after insert on public.companies
  for each row execute function public.handle_new_company();

-- RLS — companies
alter table public.companies enable row level security;

create policy "companies_select_public_active" on public.companies
  for select
  using (
    status = 'active'
    or public.has_company_role(id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "companies_insert_authenticated" on public.companies
  for insert
  with check (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "companies_update_owner_admin" on public.companies
  for update
  using (
    public.has_company_role(id, array['owner', 'admin'])
    or public.is_platform_admin()
  );

-- Pas de politique de suppression : la désactivation passe par status =
-- 'archived', pas par une suppression physique (traçabilité, cohérence
-- avec les tables liées). Seul le rôle service (imports/admin) peut
-- supprimer, en contournant la RLS.

-- RLS — company_locations
alter table public.company_locations enable row level security;

create policy "company_locations_select_public" on public.company_locations
  for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.status = 'active'
    )
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "company_locations_write_owner_admin" on public.company_locations
  for all
  using (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  );

-- RLS — company_members
alter table public.company_members enable row level security;

create policy "company_members_select_same_company" on public.company_members
  for select
  using (
    user_id = auth.uid()
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "company_members_write_owner_admin" on public.company_members
  for all
  using (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  )
  with check (
    public.has_company_role(company_id, array['owner', 'admin'])
    or public.is_platform_admin()
  );
