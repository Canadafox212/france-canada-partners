-- Phase 5 — Opportunités commerciales
--
-- Troisième élément fondamental du futur moteur (ENTREPRISE → OFFRES →
-- BESOINS → OPPORTUNITÉS), avant le MATCHING (Phase 6).
--
-- Différence avec company_offers/company_needs (voir PROJECT_SPEC.md §4.4) :
-- une offre/un besoin décrit le profil DURABLE d'une entreprise (pas de fin
-- de vie) ; une opportunité est une intention PONCTUELLE, publiée à une
-- date donnée, avec une échéance, destinée à recevoir des réponses.
--
-- Réutilise business_capability_types (comme demandé) plutôt que de créer
-- un nouveau vocabulaire : une "direction" (seeking/offering) distingue
-- "Recherche distributeur" de "Proposition de distribution" pour le même
-- code DISTRIBUTOR.

create extension if not exists unaccent;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  slug text unique, -- généré automatiquement si absent, voir trigger plus bas
  title text not null,
  description text,
  capability_type_code text not null references public.business_capability_types (code) on delete restrict,
  direction text not null check (direction in ('seeking', 'offering')),
  industry_id uuid references public.industries (id) on delete set null,
  origin_country_code text not null check (char_length(origin_country_code) = 2),
  target_country_code text check (target_country_code is null or char_length(target_country_code) = 2),
  target_region text,
  language_code text not null references public.languages (code) on delete restrict,
  estimated_value numeric,
  currency_code text check (currency_code is null or char_length(currency_code) = 3),
  deadline date,
  published_at timestamptz,
  expires_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'closed', 'expired', 'archived')),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.opportunities is
  'Intention commerciale PONCTUELLE avec échéance, distincte du profil '
  'durable (company_offers/company_needs). Voir PROJECT_SPEC.md §4.4bis.';
comment on column public.opportunities.direction is
  'seeking = "Nous recherchons X" ; offering = "Nous proposons X" — combiné '
  'à capability_type_code pour couvrir tous les types demandés sans '
  'dupliquer le vocabulaire (ex. DISTRIBUTOR+seeking = recherche '
  'distributeur, DISTRIBUTOR+offering = proposition de distribution).';
comment on column public.opportunities.status is
  'archived : retirée de toute vue publique, y compris "terminée" — '
  'distinct de closed/expired qui restent visibles pour référence.';

create trigger set_opportunities_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

-- Génère un slug lisible (titre + suffixe court aléatoire) si absent.
-- L'identité réelle reste l'UUID ; le slug ne sert qu'à l'URL.
create or replace function public.set_opportunity_slug()
returns trigger
language plpgsql
as $$
declare
  base_slug text;
  candidate text;
begin
  if new.slug is not null and length(trim(new.slug)) > 0 then
    return new;
  end if;

  base_slug := lower(regexp_replace(unaccent(coalesce(new.title, 'opportunite')), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  if length(base_slug) = 0 then
    base_slug := 'opportunite';
  end if;

  loop
    candidate := base_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not exists (select 1 from public.opportunities where slug = candidate);
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger set_opportunity_slug_trigger
  before insert on public.opportunities
  for each row execute function public.set_opportunity_slug();

-- Calcule published_at / expires_at à la (première) publication. Durée par
-- défaut : 90 jours si aucune échéance (deadline) n'est fournie.
create or replace function public.set_opportunity_publish_dates()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if new.published_at is null then
      new.published_at := now();
    end if;
    if new.expires_at is null then
      new.expires_at := coalesce(new.deadline::timestamptz, now() + interval '90 days');
    end if;
  end if;
  return new;
end;
$$;

create trigger set_opportunity_publish_dates_trigger
  before insert or update on public.opportunities
  for each row execute function public.set_opportunity_publish_dates();

-- Produits/services concernés (structuré, en plus de la description libre) —
-- même schéma que pour les offres/besoins (Phase 4).
create table public.opportunity_products_services (
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  product_service_id uuid not null references public.products_services (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, product_service_id)
);

-- Bascule administrable des opportunités expirées : le statut ne change
-- jamais tout seul (pas de tâche planifiée dans cet environnement), mais
-- rien ne dépend de ce déclenchement pour la sécurité ou l'affichage
-- public — la visibilité publique se calcule directement sur expires_at
-- (voir politique RLS ci-dessous), pas sur ce statut. Cette fonction est un
-- confort administratif pour que la colonne status reflète la réalité ;
-- appelable manuellement ou, plus tard, par une tâche planifiée (pg_cron).
create or replace function public.expire_stale_opportunities()
returns integer
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.opportunities
    set status = 'expired'
    where status = 'published' and expires_at is not null and expires_at < now()
    returning id
  )
  select count(*)::integer from updated;
$$;

revoke execute on function public.expire_stale_opportunities from anon, authenticated;
grant execute on function public.expire_stale_opportunities to service_role;

-- Index utiles à la liste publique, aux filtres et au futur matching.
create index opportunities_company_id_idx on public.opportunities (company_id);
create index opportunities_status_idx on public.opportunities (status);
create index opportunities_capability_type_idx on public.opportunities (capability_type_code);
create index opportunities_target_country_idx on public.opportunities (target_country_code);
create index opportunities_origin_country_idx on public.opportunities (origin_country_code);
create index opportunities_industry_idx on public.opportunities (industry_id);
create index opportunities_expires_at_idx on public.opportunities (expires_at);
create index opportunity_products_services_product_idx on public.opportunity_products_services (product_service_id);

-- RLS — opportunities
-- Visibilité publique : published/expired/closed restent consultables
-- (page "Cette opportunité est terminée" gérée côté application) ;
-- draft/paused/archived ne sont visibles qu'à l'entreprise et aux admins.
alter table public.opportunities enable row level security;

create policy "opportunities_select_public_or_member" on public.opportunities
  for select
  using (
    status in ('published', 'expired', 'closed')
    or public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "opportunities_insert_owner_admin_member" on public.opportunities
  for insert
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());

create policy "opportunities_update_owner_admin_member" on public.opportunities
  for update
  using (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin())
  with check (public.has_company_role(company_id, array['owner', 'admin', 'member']) or public.is_platform_admin());

-- RLS — opportunity_products_services (même principe que pour offres/besoins)
alter table public.opportunity_products_services enable row level security;

create policy "opportunity_products_services_select_public" on public.opportunity_products_services
  for select
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and (o.status in ('published', 'expired', 'closed') or public.has_company_role(o.company_id, array['owner', 'admin', 'member', 'viewer']))
    )
    or public.is_platform_admin()
  );

create policy "opportunity_products_services_write_owner_admin_member" on public.opportunity_products_services
  for all
  using (
    exists (select 1 from public.opportunities o where o.id = opportunity_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  )
  with check (
    exists (select 1 from public.opportunities o where o.id = opportunity_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  );

-- Audit : création, changement de statut, modification — jamais le titre
-- ni la description (même principe que pour les offres/besoins, Phase 4).
create or replace function public.log_opportunity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event('opportunity_created', 'opportunity', new.id, null,
      jsonb_build_object('company_id', new.company_id, 'capability_type_code', new.capability_type_code, 'status', new.status));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.log_audit_event('opportunity_status_changed', 'opportunity', new.id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  elsif tg_op = 'UPDATE' then
    perform public.log_audit_event('opportunity_updated', 'opportunity', new.id, null,
      jsonb_build_object('capability_type_code', new.capability_type_code));
  end if;
  return new;
end;
$$;

create trigger log_opportunity_change_trigger
  after insert or update on public.opportunities
  for each row execute function public.log_opportunity_change();
