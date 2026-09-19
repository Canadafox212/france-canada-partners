-- Phase 2 — Identité utilisateur
--
-- Supabase fournit déjà auth.users pour l'authentification (email, mot de
-- passe, état de connexion). On ne duplique jamais ces informations : cette
-- table ne contient que les données applicatives liées à un utilisateur.
-- Relation 1:1 stricte : profiles.id = auth.users.id.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  -- Langue de l'INTERFACE pour cet utilisateur (à ne pas confondre avec les
  -- langues DE TRAVAIL d'une entreprise : voir company_languages, Phase 2).
  preferred_language text not null default 'fr'
    check (preferred_language in ('fr', 'en')),
  -- Rôle SUR LA PLATEFORME (administration globale), distinct du rôle DANS
  -- UNE ENTREPRISE (voir company_members.role, table à venir dans cette phase).
  platform_role text not null default 'user'
    check (platform_role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Données applicatives liées à un utilisateur Supabase Auth. '
  'L''identité de connexion (email, mot de passe) reste uniquement dans auth.users.';

-- Tenue à jour automatique de updated_at, réutilisée par d'autres tables
-- mutables (companies) dans les migrations suivantes.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Création automatique d'un profil à chaque inscription (pattern standard
-- Supabase). full_name est repris des métadonnées fournies au moment de
-- l'inscription si disponibles, sinon laissé vide (complété ensuite par
-- l'utilisateur — formulaire à construire en Phase 3).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, preferred_language)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'preferred_language', 'fr')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sécurité : fonction utilitaire pour repérer un administrateur de la
-- plateforme depuis n'importe quelle politique RLS, sans provoquer de
-- récursion (SECURITY DEFINER contourne la RLS *à l'intérieur* de la
-- fonction elle-même, uniquement pour cette vérification précise).
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and platform_role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select
  using (id = auth.uid() or public.is_platform_admin());

create policy "profiles_update_own_or_admin" on public.profiles
  for update
  using (id = auth.uid() or public.is_platform_admin());

-- Pas de politique d'insertion/suppression : la création se fait uniquement
-- via le trigger handle_new_user() (contexte serveur), la suppression suit
-- la suppression du compte auth.users (on delete cascade ci-dessus).
