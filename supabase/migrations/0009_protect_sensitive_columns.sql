-- Phase 3 — Protection des champs contrôlés par la plateforme
--
-- Une politique RLS protège une LIGNE, pas des COLONNES précises à
-- l'intérieur de cette ligne : un owner autorisé à modifier son entreprise
-- pourrait, sans protection supplémentaire, aussi modifier son
-- subscription_level ou son verification_status dans la même requête —
-- des champs qui ne doivent être changés que par la plateforme elle-même.
--
-- Mécanisme choisi : un trigger BEFORE UPDATE qui compare l'ancienne et la
-- nouvelle valeur des champs protégés et rejette la modification si
-- l'utilisateur n'est pas administrateur de la plateforme.
--
-- Pourquoi un trigger plutôt que les alternatives envisagées :
-- - permissions PostgreSQL par colonne (GRANT/REVOKE) : n'ont pas de prise
--   directe sur PostgREST, qui exécute toutes les requêtes via un seul rôle
--   HTTP (authenticated/anon) — la granularité colonne par colonne s'y gère
--   mal et serait fragile à maintenir ;
-- - RPC sécurisée exclusive : aurait obligé à interdire tout UPDATE direct
--   sur companies/profiles et à faire passer même les champs anodins (nom,
--   téléphone...) par une fonction dédiée — plus lourd que nécessaire ici ;
-- - table séparée : pertinent si ces champs avaient un cycle de vie propre
--   (historique, workflow) — pas le cas pour un simple statut/valeur ;
-- - trigger (retenu) : compare explicitement OLD vs NEW, lisible, réutilise
--   is_platform_admin() déjà existant, et journalise via log_audit_event()
--   le même geste selon qui l'a fait (rejeté si non-admin, tracé si admin).

create or replace function public.protect_profiles_platform_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.platform_role is distinct from old.platform_role then
    -- auth.uid() est NULL en dehors d'une requête authentifiée via PostgREST
    -- (migration, script serveur avec la clé secrète, éditeur SQL du
    -- tableau de bord) : ces contextes sont de confiance par construction
    -- et servent notamment à nommer le tout premier administrateur. Un
    -- auth.uid() non NULL signifie qu'un utilisateur precis agit via
    -- l'API : il doit alors déjà être administrateur.
    if auth.uid() is not null and not public.is_platform_admin() then
      raise exception 'platform_role ne peut être modifié que par un administrateur de la plateforme'
        using errcode = '42501'; -- insufficient_privilege
    end if;
    perform public.log_audit_event(
      'profile_platform_role_changed',
      'profile',
      new.id,
      jsonb_build_object('platform_role', old.platform_role),
      jsonb_build_object('platform_role', new.platform_role)
    );
  end if;
  return new;
end;
$$;

create trigger protect_profiles_platform_role_trigger
  before update on public.profiles
  for each row execute function public.protect_profiles_platform_role();

create or replace function public.protect_companies_platform_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subscription_level is distinct from old.subscription_level
     or new.verification_status is distinct from old.verification_status then
    -- Même raisonnement que protect_profiles_platform_role() ci-dessus :
    -- un contexte sans auth.uid() (migration, script serveur, éditeur SQL)
    -- est de confiance ; un utilisateur authentifié doit être admin.
    if auth.uid() is not null and not public.is_platform_admin() then
      raise exception 'subscription_level et verification_status ne peuvent être modifiés que par un administrateur de la plateforme'
        using errcode = '42501';
    end if;
    perform public.log_audit_event(
      'company_platform_fields_changed',
      'company',
      new.id,
      jsonb_build_object('subscription_level', old.subscription_level, 'verification_status', old.verification_status),
      jsonb_build_object('subscription_level', new.subscription_level, 'verification_status', new.verification_status)
    );
  end if;
  return new;
end;
$$;

create trigger protect_companies_platform_fields_trigger
  before update on public.companies
  for each row execute function public.protect_companies_platform_fields();

-- Journalisation complémentaire (création d'entreprise, changements dans
-- company_members) — s'ajoute au trigger de rattachement automatique de la
-- migration 0002, sans le modifier.

create or replace function public.log_company_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_audit_event(
    'company_created',
    'company',
    new.id,
    null,
    jsonb_build_object('legal_name', new.legal_name, 'display_name', new.display_name)
  );
  return new;
end;
$$;

create trigger log_company_created_trigger
  after insert on public.companies
  for each row execute function public.log_company_created();

create or replace function public.log_company_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event(
      'company_member_added',
      'company_member',
      new.id,
      null,
      jsonb_build_object('company_id', new.company_id, 'user_id', new.user_id, 'role', new.role, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and (new.role is distinct from old.role or new.status is distinct from old.status) then
    perform public.log_audit_event(
      'company_member_updated',
      'company_member',
      new.id,
      jsonb_build_object('role', old.role, 'status', old.status),
      jsonb_build_object('role', new.role, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger log_company_member_change_trigger
  after insert or update on public.company_members
  for each row execute function public.log_company_member_change();
