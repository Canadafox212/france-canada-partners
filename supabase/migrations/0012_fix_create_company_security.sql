-- Phase 3 — Correction de create_company() : RETURNING vs RLS
--
-- Deuxième bug distinct du précédent (0011), découvert par les mêmes tests
-- réels : à l'intérieur de la fonction, `insert into companies (...)
-- returning id into v_company_id` échouait malgré une politique d'insertion
-- désormais correcte. Raison : PostgreSQL applique aussi la politique de
-- SELECT à la clause RETURNING d'un INSERT. Juste après l'insertion, la
-- ligne a status = 'draft' (donc la condition "status = 'active'" est
-- fausse) et le déclencheur qui crée son propriétaire dans company_members
-- ne s'est pas encore exécuté au moment où RETURNING est évalué : la
-- politique de SELECT ne trouve donc personne autorisé à voir cette ligne
-- toute neuve, et la transaction entière est rejetée.
--
-- Correction : create_company() devient SECURITY DEFINER (comme les autres
-- fonctions de confiance du schéma : handle_new_company, log_audit_event),
-- ce qui lui permet de mener à bien ses propres opérations internes sans se
-- heurter à ce paradoxe de démarrage. Ce n'est pas un affaiblissement de la
-- sécurité : l'accès à la fonction reste strictement réservé aux
-- utilisateurs authentifiés (révoqué pour "anon", cf. 0010), et une garde
-- explicite refuse tout appel sans utilisateur connecté.

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
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_final_slug text := p_slug;
  v_suffix int := 1;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise pour créer une entreprise.'
      using errcode = '42501';
  end if;

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

-- Le GRANT/REVOKE de la migration 0010 reste valable (fonction remplacée,
-- pas recréée), mais on le répète ici pour que ce fichier soit
-- autoportant et vérifiable indépendamment.
revoke execute on function public.create_company from anon;
grant execute on function public.create_company to authenticated;
