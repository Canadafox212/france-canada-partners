-- Phase 7 — Annuaire public : recherche plein texte et fonction de recherche
--
-- Objectif : chercher dans nom légal/commercial, description, secteurs,
-- produits/services, offres et besoins d'un coup, avec de bonnes
-- performances même à plusieurs dizaines de milliers d'entreprises (voir
-- §27 du cahier des charges Phase 7). Une colonne `search_vector`
-- (tsvector), tenue à jour par déclencheur sur chaque table source,
-- évite de reconstruire cette agrégation à chaque recherche — seul un
-- changement réel déclenche un recalcul, jamais une lecture.
--
-- Insensibilité aux accents (§36 : "Québec" et "Quebec" doivent être
-- traités de façon équivalente) obtenue via unaccent() appliqué à
-- l'indexation ET à la recherche, avec la configuration 'simple' (pas de
-- config 'french', pour éviter que la racinisation linguistique déforme
-- des noms d'entreprise ou des codes de produits).

-- 1) Colonne de recherche + index -------------------------------------------
alter table public.companies add column search_vector tsvector;
create index companies_search_vector_idx on public.companies using gin (search_vector);

-- 2) Recalcul centralisé -----------------------------------------------------
--
-- SECURITY DEFINER : appelée par des déclencheurs sur des tables dont
-- l'utilisateur courant n'a pas forcément le droit de lire l'intégralité
-- (ex. besoins d'une autre entreprise) — mais elle ne fait que RE-écrire la
-- colonne search_vector de LA MÊME entreprise que celle affectée par le
-- changement, jamais une donnée arbitraire.
create or replace function public.refresh_company_search_vector(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tsv tsvector;
begin
  select
    setweight(to_tsvector('simple', unaccent(coalesce(c.legal_name, '') || ' ' || coalesce(c.display_name, ''))), 'A')
    || setweight(to_tsvector('simple', unaccent(coalesce(string_agg(distinct ct.description, ' '), ''))), 'B')
    || setweight(to_tsvector('simple', unaccent(coalesce(string_agg(distinct ind.name_fr || ' ' || ind.name_en, ' '), ''))), 'B')
    || setweight(to_tsvector('simple', unaccent(coalesce(string_agg(distinct ps.label_fr || ' ' || ps.label_en, ' '), ''))), 'C')
    || setweight(to_tsvector('simple', unaccent(coalesce(string_agg(distinct co.title, ' '), ''))), 'C')
    || setweight(to_tsvector('simple', unaccent(coalesce(string_agg(distinct cn.title, ' '), ''))), 'C')
    into v_tsv
  from public.companies c
  left join public.company_translations ct on ct.company_id = c.id
  left join public.company_industries ci on ci.company_id = c.id
  left join public.industries ind on ind.id = ci.industry_id
  left join public.company_products_services cps on cps.company_id = c.id
  left join public.products_services ps on ps.id = cps.product_service_id
  left join public.company_offers co on co.company_id = c.id and co.status = 'active'
  left join public.company_needs cn on cn.company_id = c.id and cn.status = 'active'
  where c.id = p_company_id
  group by c.id;

  update public.companies set search_vector = v_tsv where id = p_company_id;
end;
$$;

comment on function public.refresh_company_search_vector is
  'Recalcule companies.search_vector à partir du nom, de la description, '
  'des secteurs, produits/services et titres d''offres/besoins actifs. '
  'Appelée par déclencheur, jamais directement par un client.';

-- 3) Déclencheurs de maintenance ----------------------------------------------
create or replace function public.trigger_refresh_own_company_search_vector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_company_search_vector(new.id);
  return new;
end;
$$;

create trigger refresh_search_vector_on_company
  after insert or update of legal_name, display_name on public.companies
  for each row execute function public.trigger_refresh_own_company_search_vector();

create or replace function public.trigger_refresh_related_company_search_vector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_company_search_vector(coalesce(new.company_id, old.company_id));
  return coalesce(new, old);
end;
$$;

create trigger refresh_search_vector_on_translation
  after insert or update or delete on public.company_translations
  for each row execute function public.trigger_refresh_related_company_search_vector();

create trigger refresh_search_vector_on_company_industries
  after insert or delete on public.company_industries
  for each row execute function public.trigger_refresh_related_company_search_vector();

create trigger refresh_search_vector_on_company_products_services
  after insert or delete on public.company_products_services
  for each row execute function public.trigger_refresh_related_company_search_vector();

create trigger refresh_search_vector_on_offers
  after insert or update or delete on public.company_offers
  for each row execute function public.trigger_refresh_related_company_search_vector();

create trigger refresh_search_vector_on_needs
  after insert or update or delete on public.company_needs
  for each row execute function public.trigger_refresh_related_company_search_vector();

-- 4) Index utiles aux filtres combinables (§5) --------------------------------
create index company_locations_region_idx on public.company_locations (region);
create index company_locations_city_idx on public.company_locations (city);
create index companies_country_code_idx on public.companies (country_code);
create index companies_verification_status_idx on public.companies (verification_status);

-- 5) Fonction de recherche combinée -------------------------------------------
--
-- SECURITY INVOKER (par défaut) : s'exécute avec les droits de l'appelant,
-- la RLS de chaque table jointe continue de s'appliquer normalement (défense
-- en profondeur, en plus du `c.status = 'active'` déjà filtré ici). Utilisable
-- aussi bien par un visiteur anonyme (annuaire public) que par un utilisateur
-- connecté — jamais besoin de la clé secrète pour une simple recherche.
create or replace function public.search_companies(
  p_query text default null,
  p_country_code text default null,
  p_region text default null,
  p_city text default null,
  p_industry_id uuid default null,
  p_subindustry_id uuid default null,
  p_product_service_id uuid default null,
  p_offering_capability_code text default null,
  p_seeking_capability_code text default null,
  p_target_country_code text default null,
  p_verified_only boolean default false,
  p_active_opportunities_only boolean default false,
  p_sort text default 'relevance',
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  display_name text,
  slug text,
  country_code text,
  region text,
  city text,
  verification_status text,
  primary_industry_name_fr text,
  primary_industry_name_en text,
  active_opportunities_count bigint,
  offering_capability_codes text[],
  seeking_capability_codes text[],
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.display_name,
    c.slug,
    c.country_code,
    loc.region,
    loc.city,
    c.verification_status,
    ind.name_fr,
    ind.name_en,
    (
      select count(*) from public.opportunities o
      where o.company_id = c.id and o.status = 'published' and o.expires_at > now()
    ) as active_opportunities_count,
    (
      select array_agg(distinct x.capability_type_code)
      from (
        select capability_type_code from public.company_offers
        where company_id = c.id and status = 'active' limit 3
      ) x
    ) as offering_capability_codes,
    (
      select array_agg(distinct x.capability_type_code)
      from (
        select capability_type_code from public.company_needs
        where company_id = c.id and status = 'active' limit 3
      ) x
    ) as seeking_capability_codes,
    case
      when p_query is not null and p_query <> ''
        then ts_rank(c.search_vector, plainto_tsquery('simple', unaccent(p_query)))
      else 0
    end as rank
  from public.companies c
  left join public.company_locations loc on loc.company_id = c.id and loc.is_primary
  left join public.company_industries ci on ci.company_id = c.id and ci.is_primary
  left join public.industries ind on ind.id = ci.industry_id
  where c.status = 'active'
    and (p_query is null or p_query = '' or c.search_vector @@ plainto_tsquery('simple', unaccent(p_query)))
    and (p_country_code is null or c.country_code = p_country_code)
    and (p_region is null or unaccent(loc.region) ilike unaccent(p_region))
    and (p_city is null or unaccent(loc.city) ilike unaccent(p_city))
    and (p_industry_id is null or exists (
      select 1 from public.company_industries x where x.company_id = c.id and x.industry_id = p_industry_id
    ))
    and (p_subindustry_id is null or exists (
      select 1 from public.company_subindustries x where x.company_id = c.id and x.subindustry_id = p_subindustry_id
    ))
    and (p_product_service_id is null or exists (
      select 1 from public.company_products_services x where x.company_id = c.id and x.product_service_id = p_product_service_id
    ))
    and (p_offering_capability_code is null or exists (
      select 1 from public.company_offers x
      where x.company_id = c.id and x.status = 'active' and x.capability_type_code = p_offering_capability_code
    ))
    and (p_seeking_capability_code is null or exists (
      select 1 from public.company_needs x
      where x.company_id = c.id and x.status = 'active' and x.capability_type_code = p_seeking_capability_code
    ))
    and (p_target_country_code is null or exists (
      select 1 from public.company_markets x
      where x.company_id = c.id and x.market_type = 'target' and x.country_code = p_target_country_code
    ))
    and (not p_verified_only or c.verification_status = 'verified')
    and (not p_active_opportunities_only or exists (
      select 1 from public.opportunities x
      where x.company_id = c.id and x.status = 'published' and x.expires_at > now()
    ))
  order by
    case when p_sort = 'relevance' and p_query is not null and p_query <> ''
      then ts_rank(c.search_vector, plainto_tsquery('simple', unaccent(p_query))) end desc nulls last,
    case when p_sort = 'recent' then c.created_at end desc,
    c.display_name asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

comment on function public.search_companies is
  'Recherche combinée (texte + filtres + tri + pagination) pour l''annuaire '
  'public (§4/§5/§6/§7 Phase 7). Un seul aller-retour base de données par '
  'page de résultats, filtrage effectué côté SQL avant tout renvoi de '
  'lignes — voir docs/DIRECTORY.md.';

grant execute on function public.search_companies to anon, authenticated;
