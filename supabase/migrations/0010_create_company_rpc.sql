-- Phase 3 — Création d'entreprise transactionnelle
--
-- La création d'une entreprise touche plusieurs tables (companies,
-- company_locations, company_industries, company_translations). Le
-- rattachement automatique du créateur comme owner (migration 0002) est
-- déjà garanti atomique par un trigger — mais les tables liées, elles,
-- seraient insérées par des appels PostgREST séparés depuis le client,
-- avec un risque d'état partiel en cas d'échec réseau entre deux appels.
--
-- Cette fonction regroupe tout dans une seule transaction côté serveur.
-- security invoker (par défaut) : la fonction s'exécute avec l'identité de
-- l'appelant, pour que les politiques RLS et le trigger de rattachement
-- s'appliquent normalement (auth.uid() reste celui de l'utilisateur connecté).
--
-- Gestion des collisions de slug : en cas de doublon, un suffixe numérique
-- est ajouté automatiquement (ex. "acme", puis "acme-2") plutôt que de
-- renvoyer une erreur à l'utilisateur.

create or replace function public.create_company(
  p_legal_name text,
  p_display_name text,
  p_slug text,
  p_country_code text,
  p_website text default null,
  p_professional_email text default null,
  p_phone text default null,
  p_region text default null,
  p_city text default null,
  p_industry_id uuid default null,
  p_description text default null,
  p_description_locale text default 'fr'
)
returns json
language plpgsql
security invoker
as $$
declare
  v_company_id uuid;
  v_final_slug text := p_slug;
  v_suffix int := 1;
begin
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'Le nom commercial est requis.';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'Le slug est requis.';
  end if;

  while exists (select 1 from public.companies where slug = v_final_slug) loop
    v_suffix := v_suffix + 1;
    v_final_slug := p_slug || '-' || v_suffix;
  end loop;

  insert into public.companies (
    legal_name, display_name, slug, country_code, website, professional_email, phone
  )
  values (
    coalesce(nullif(trim(p_legal_name), ''), p_display_name),
    p_display_name, v_final_slug, p_country_code, p_website, p_professional_email, p_phone
  )
  returning id into v_company_id;

  insert into public.company_locations (company_id, location_type, is_primary, region, city, country_code)
  values (v_company_id, 'headquarters', true, p_region, p_city, p_country_code);

  if p_industry_id is not null then
    insert into public.company_industries (company_id, industry_id, is_primary)
    values (v_company_id, p_industry_id, true);
  end if;

  if p_description is not null and length(trim(p_description)) > 0 then
    insert into public.company_translations (company_id, locale, description)
    values (v_company_id, p_description_locale, p_description);
  end if;

  return json_build_object('id', v_company_id, 'slug', v_final_slug);
end;
$$;

comment on function public.create_company is
  'Crée une entreprise et ses données associées (établissement principal, '
  'secteur principal, description) en une seule transaction. Le rattachement '
  'du créateur comme owner est assuré séparément par le trigger '
  'on_company_created (migration 0002), qui s''exécute dans la même transaction.';

revoke execute on function public.create_company from anon;
grant execute on function public.create_company to authenticated;
