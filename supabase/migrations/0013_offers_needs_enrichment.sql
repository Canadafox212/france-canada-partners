-- Phase 4 — Enrichissement des offres et besoins
--
-- Objectif : que "Nous proposons" / "Nous recherchons" deviennent des
-- données structurées et interrogeables (pour la Phase 6 - matching),
-- pas de simples zones de texte. Migration additive : ne modifie ni ne
-- réécrit le contenu des migrations déjà appliquées (0004).
--
-- Rappel de vocabulaire (voir aussi PROJECT_SPEC.md §4.4 et §7bis) :
-- une OFFRE/un BESOIN appartient au profil DURABLE de l'entreprise (pas de
-- date d'expiration) ; une future OPPORTUNITÉ (Phase 5) sera une publication
-- ponctuelle, avec une durée de vie, destinée à recevoir des réponses.

-- Catégories manquantes par rapport à la liste demandée pour cette phase.
-- Les codes déjà en place (DISTRIBUTOR, SUPPLIER, MANUFACTURER,
-- SUBCONTRACTOR, IMPORTER, EXPORTER, SALES_AGENT, COMMERCIAL_PARTNER,
-- INDUSTRIAL_PARTNER, TECHNOLOGY_PARTNER, INVESTOR, JOINT_VENTURE, SERVICES,
-- MANUFACTURING_CAPACITY, DISTRIBUTION_CAPACITY) couvrent déjà, sous un nom
-- différent, la plupart des catégories demandées (ex. DISTRIBUTOR ≈
-- "distribution", INVESTOR ≈ "investment") : ils ne sont pas renommés pour
-- ne pas casser les données déjà créées en Phase 2/3. Seules les catégories
-- réellement absentes sont ajoutées ici.
insert into public.business_capability_types (code, label_fr, label_en) values
  ('LICENSING', 'Licence', 'Licensing'),
  ('FRANCHISING', 'Franchise', 'Franchising'),
  ('OTHER', 'Autre', 'Other')
on conflict (code) do nothing;

-- Offres : titre, statut, secteur optionnel, horodatage de mise à jour.
alter table public.company_offers
  add column title text,
  add column status text not null default 'active' check (status in ('active', 'inactive')),
  add column industry_id uuid references public.industries (id) on delete set null,
  add column updated_at timestamptz not null default now();

create trigger set_company_offers_updated_at
  before update on public.company_offers
  for each row execute function public.set_updated_at();

-- Besoins : mêmes ajouts, plus une indication (libre) de taille de
-- partenaire recherchée — même format texte que companies.employee_range,
-- volontairement pas une nouvelle table de référence pour ce champ optionnel.
alter table public.company_needs
  add column title text,
  add column status text not null default 'active' check (status in ('active', 'inactive')),
  add column industry_id uuid references public.industries (id) on delete set null,
  add column sought_employee_range text,
  add column updated_at timestamptz not null default now();

create trigger set_company_needs_updated_at
  before update on public.company_needs
  for each row execute function public.set_updated_at();

comment on column public.company_offers.title is
  'Titre affichable, généralement composé automatiquement par l''application '
  'à partir du type/produit/marché plutôt que saisi manuellement (voir '
  'CreateOfferForm) — reste modifiable.';
comment on column public.company_needs.title is 'Voir company_offers.title.';

-- Produits/services concernés (structuré) — s'ajoute à la description libre
-- déjà existante, ne la remplace pas.
create table public.company_offer_products_services (
  offer_id uuid not null references public.company_offers (id) on delete cascade,
  product_service_id uuid not null references public.products_services (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (offer_id, product_service_id)
);

create table public.company_need_products_services (
  need_id uuid not null references public.company_needs (id) on delete cascade,
  product_service_id uuid not null references public.products_services (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (need_id, product_service_id)
);

-- Langues souhaitées pour cette offre/ce besoin précis (optionnel, distinct
-- des langues générales de l'entreprise dans company_languages).
create table public.company_offer_languages (
  offer_id uuid not null references public.company_offers (id) on delete cascade,
  language_code text not null references public.languages (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (offer_id, language_code)
);

create table public.company_need_languages (
  need_id uuid not null references public.company_needs (id) on delete cascade,
  language_code text not null references public.languages (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (need_id, language_code)
);

-- Index utiles au futur matching et à la recherche interne (Phase 6/17) :
-- capability type, entreprise, statut, géographie, secteur, produit.
create index company_offers_capability_type_idx on public.company_offers (capability_type_code);
create index company_offers_status_idx on public.company_offers (status);
create index company_offers_target_country_idx on public.company_offers (target_country_code);
create index company_offers_industry_idx on public.company_offers (industry_id);

create index company_needs_capability_type_idx on public.company_needs (capability_type_code);
create index company_needs_status_idx on public.company_needs (status);
create index company_needs_target_country_idx on public.company_needs (target_country_code);
create index company_needs_industry_idx on public.company_needs (industry_id);

create index company_offer_products_services_product_idx on public.company_offer_products_services (product_service_id);
create index company_need_products_services_product_idx on public.company_need_products_services (product_service_id);

-- RLS : mêmes règles que la ligne parente (offer/need), vérifiée via une
-- sous-requête vers company_offers/company_needs.
alter table public.company_offer_products_services enable row level security;
alter table public.company_need_products_services enable row level security;
alter table public.company_offer_languages enable row level security;
alter table public.company_need_languages enable row level security;

create policy "company_offer_products_services_select_public" on public.company_offer_products_services
  for select
  using (
    exists (
      select 1 from public.company_offers o
      join public.companies c on c.id = o.company_id
      where o.id = offer_id
        and (c.status = 'active' or public.has_company_role(c.id, array['owner', 'admin', 'member', 'viewer']))
    )
    or public.is_platform_admin()
  );
create policy "company_offer_products_services_write_owner_admin_member" on public.company_offer_products_services
  for all
  using (
    exists (select 1 from public.company_offers o where o.id = offer_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  )
  with check (
    exists (select 1 from public.company_offers o where o.id = offer_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  );

create policy "company_need_products_services_select_public" on public.company_need_products_services
  for select
  using (
    exists (
      select 1 from public.company_needs n
      join public.companies c on c.id = n.company_id
      where n.id = need_id
        and (c.status = 'active' or public.has_company_role(c.id, array['owner', 'admin', 'member', 'viewer']))
    )
    or public.is_platform_admin()
  );
create policy "company_need_products_services_write_owner_admin_member" on public.company_need_products_services
  for all
  using (
    exists (select 1 from public.company_needs n where n.id = need_id and public.has_company_role(n.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  )
  with check (
    exists (select 1 from public.company_needs n where n.id = need_id and public.has_company_role(n.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  );

create policy "company_offer_languages_select_public" on public.company_offer_languages
  for select
  using (
    exists (
      select 1 from public.company_offers o
      join public.companies c on c.id = o.company_id
      where o.id = offer_id
        and (c.status = 'active' or public.has_company_role(c.id, array['owner', 'admin', 'member', 'viewer']))
    )
    or public.is_platform_admin()
  );
create policy "company_offer_languages_write_owner_admin_member" on public.company_offer_languages
  for all
  using (
    exists (select 1 from public.company_offers o where o.id = offer_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  )
  with check (
    exists (select 1 from public.company_offers o where o.id = offer_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  );

create policy "company_need_languages_select_public" on public.company_need_languages
  for select
  using (
    exists (
      select 1 from public.company_needs n
      join public.companies c on c.id = n.company_id
      where n.id = need_id
        and (c.status = 'active' or public.has_company_role(c.id, array['owner', 'admin', 'member', 'viewer']))
    )
    or public.is_platform_admin()
  );
create policy "company_need_languages_write_owner_admin_member" on public.company_need_languages
  for all
  using (
    exists (select 1 from public.company_needs n where n.id = need_id and public.has_company_role(n.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  )
  with check (
    exists (select 1 from public.company_needs n where n.id = need_id and public.has_company_role(n.company_id, array['owner', 'admin', 'member']))
    or public.is_platform_admin()
  );

-- Audit : création, changement de statut (activer/désactiver), suppression.
-- Le contenu libre (title, description) n'est JAMAIS journalisé, seulement
-- des identifiants et le type de catégorie, pour limiter l'exposition de
-- contenu potentiellement sensible dans le journal d'audit.

create or replace function public.log_offer_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event('offer_created', 'company_offer', new.id, null,
      jsonb_build_object('company_id', new.company_id, 'capability_type_code', new.capability_type_code));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.log_audit_event('offer_status_changed', 'company_offer', new.id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  elsif tg_op = 'UPDATE' then
    perform public.log_audit_event('offer_updated', 'company_offer', new.id, null,
      jsonb_build_object('capability_type_code', new.capability_type_code));
  elsif tg_op = 'DELETE' then
    perform public.log_audit_event('offer_deleted', 'company_offer', old.id,
      jsonb_build_object('company_id', old.company_id, 'capability_type_code', old.capability_type_code), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger log_offer_change_trigger
  after insert or update or delete on public.company_offers
  for each row execute function public.log_offer_change();

create or replace function public.log_need_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event('need_created', 'company_need', new.id, null,
      jsonb_build_object('company_id', new.company_id, 'capability_type_code', new.capability_type_code));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.log_audit_event('need_status_changed', 'company_need', new.id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  elsif tg_op = 'UPDATE' then
    perform public.log_audit_event('need_updated', 'company_need', new.id, null,
      jsonb_build_object('capability_type_code', new.capability_type_code));
  elsif tg_op = 'DELETE' then
    perform public.log_audit_event('need_deleted', 'company_need', old.id,
      jsonb_build_object('company_id', old.company_id, 'capability_type_code', old.capability_type_code), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger log_need_change_trigger
  after insert or update or delete on public.company_needs
  for each row execute function public.log_need_change();
