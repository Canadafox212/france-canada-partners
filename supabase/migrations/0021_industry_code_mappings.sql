-- Phase 8 (suite) — Mapping code officiel → secteur interne, provenance du contenu
--
-- Deux ajouts indépendants pour terminer le cycle du lot pilote (13
-- entreprises françaises importées, voir 0020) sans jamais confondre une
-- donnée officielle (SIRENE) avec une donnée rédigée par la plateforme :
--
-- 1) `industry_code_mappings` : correspondance entre un code de
--    nomenclature OFFICIEL (APE/NAF aujourd'hui, NAICS/SCIAN plus tard) et
--    un secteur interne, avec un niveau de confiance explicite — jamais un
--    rapprochement automatique par simple mot-clé (voir docs/DATA_MAPPING.md
--    §4 : NAF/APE et NAICS/SCIAN ne doivent jamais être mélangés).
-- 2) `company_translations.content_source` : distingue un contenu fourni
--    par l'entreprise elle-même (déclaratif, cas normal depuis la Phase 3)
--    d'un contenu rédigé par l'équipe éditoriale à partir de faits
--    vérifiables (jamais confondu avec une donnée SIRENE ni avec une
--    saisie de l'entreprise).

-- 1) Mapping code officiel -> secteur interne ---------------------------------
create table public.industry_code_mappings (
  id uuid primary key default gen_random_uuid(),
  scheme text not null check (scheme in ('NAF_APE', 'NAICS_SCIAN')),
  code text not null,
  official_label text,
  internal_industry_id uuid references public.industries (id) on delete set null,
  -- REQUIRES_REVIEW : le code existe mais ne décrit pas une activité
  -- commerciale exploitable tel quel (ex. "activités des sièges sociaux"
  -- pour un groupe industriel) — internal_industry_id reste alors NULL
  -- jusqu'à un arbitrage humain, jamais deviné.
  confidence text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW', 'REQUIRES_REVIEW')),
  verified_at timestamptz,
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scheme, code)
);

comment on table public.industry_code_mappings is
  'Correspondance entre un code de nomenclature officiel (APE/NAF, puis '
  'NAICS/SCIAN) et un secteur interne (industries), avec niveau de '
  'confiance explicite. Jamais un rapprochement automatique par mot-clé — '
  'voir docs/DATA_MAPPING.md §4 et docs/DATA_INVENTORY.md.';

create trigger set_industry_code_mappings_updated_at
  before update on public.industry_code_mappings
  for each row execute function public.set_updated_at();

alter table public.industry_code_mappings enable row level security;
create policy "industry_code_mappings_select_all" on public.industry_code_mappings
  for select using (true);
create policy "industry_code_mappings_write_admin" on public.industry_code_mappings
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 2) Provenance du contenu rédactionnel ------------------------------------------
alter table public.company_translations
  add column content_source text not null default 'COMPANY_PROVIDED'
    check (content_source in ('COMPANY_PROVIDED', 'EDITORIAL', 'SOURCE_PROVIDED'));

-- 3) Secteurs internes nécessaires au lot pilote (13 entreprises) -----------------
--
-- Uniquement les secteurs requis par les 8 codes APE réellement présents
-- dans le lot pilote (§3 de la demande : pas de généralisation à toute la
-- nomenclature avant validation). Aucune ligne company_industries n'est
-- créée ici — seule la table de RÉFÉRENCE (secteurs + correspondance) est
-- préparée ; le rattachement d'une entreprise précise à un secteur reste
-- une étape éditoriale distincte, appliquée seulement après autorisation.
insert into public.industries (name_fr, name_en, slug) values
  ('Aéronautique et spatial', 'Aerospace', 'aeronautique-spatial'),
  ('Électronique et semi-conducteurs', 'Electronics and semiconductors', 'electronique-semi-conducteurs'),
  ('Caoutchouc, plasturgie et matériaux', 'Rubber, plastics and materials', 'caoutchouc-plasturgie-materiaux'),
  ('Agroalimentaire et AgTech', 'Agrifood and AgTech', 'agroalimentaire-agtech'),
  ('Technologies et instrumentation scientifique', 'Technology and scientific instrumentation', 'technologies-instrumentation-scientifique')
on conflict (slug) do nothing;

-- 4) Correspondances proposées pour les 8 codes APE du lot pilote -----------------
--
-- Trois codes (25.62B, 30.30Z, 26.11Z, 22.19Z, 28.30Z) correspondent
-- directement à leur libellé officiel : HIGH confidence. Deux codes
-- (26.70Z, 71.12B) décrivent une activité voisine mais pas identique au
-- secteur d'application observé lors du sourcing : MEDIUM, à confirmer.
-- Un code (70.10Z, "activités des sièges sociaux") est un code
-- administratif de tête de groupe qui ne décrit aucune activité
-- commerciale réelle : REQUIRES_REVIEW, internal_industry_id volontairement
-- laissé NULL — jamais deviné à partir de la réputation de l'entreprise.
insert into public.industry_code_mappings (scheme, code, official_label, internal_industry_id, confidence, source, notes)
select 'NAF_APE', v.code, v.official_label, i.id, v.confidence, 'INSEE (nomenclature APE/NAF rév. 2)', v.notes
from (values
  ('25.62B', 'Mécanique industrielle', 'aeronautique-spatial', 'HIGH', 'Code de mécanique de précision ; noms légaux (FIGEAC AERO, Dedienne Aerospace) corroborent le secteur réel via une donnée officielle (raison sociale SIRENE), pas une supposition.'),
  ('30.30Z', 'Construction aéronautique et spatiale', 'aeronautique-spatial', 'HIGH', 'Le code décrit littéralement la construction aéronautique (Airbus Atlantic, Latecoere).'),
  ('26.11Z', 'Fabrication de composants électroniques', 'electronique-semi-conducteurs', 'HIGH', 'Correspondance directe (Soitec, STMicroelectronics Rousset SAS).'),
  ('22.19Z', 'Fabrication d''autres articles en caoutchouc', 'caoutchouc-plasturgie-materiaux', 'HIGH', 'Correspondance directe (Hutchinson SNC).'),
  ('28.30Z', 'Fabrication de machines agricoles et forestières', 'agroalimentaire-agtech', 'HIGH', 'Correspondance directe (MAF AGROBOTIC).'),
  ('26.70Z', 'Fabrication de matériels optique et photographique', 'technologies-instrumentation-scientifique', 'MEDIUM', 'ABBELIGHT : le code décrit la fabrication d''instruments optiques ; le sourcing initial classait cette activité en "santé/biotech" (marché d''application, pas activité déclarée) — à confirmer avant publication.'),
  ('71.12B', 'Ingénierie, études techniques', 'agroalimentaire-agtech', 'MEDIUM', 'AGREENCULTURE : le code décrit une activité d''ingénierie générale, pas spécifiquement agricole ; le sourcing initial la classait "agroalimentaire/AgTech" — à confirmer avant publication.'),
  ('70.10Z', 'Activités des sièges sociaux', null, 'REQUIRES_REVIEW', 'Safran, Thales, CLAYENS : code administratif de tête de groupe, ne décrit pas l''activité commerciale réelle du groupe. Nécessite un arbitrage humain (pas de secteur interne deviné à partir de la notoriété de l''entreprise).')
) as v(code, official_label, industry_slug, confidence, notes)
left join public.industries i on i.slug = v.industry_slug
on conflict (scheme, code) do nothing;

comment on column public.company_translations.content_source is
  'COMPANY_PROVIDED (défaut) : saisi par l''entreprise elle-même via son '
  'espace de gestion. EDITORIAL : rédigé par l''équipe France-Canada '
  'Partners à partir de faits vérifiables (jamais copié d''une source '
  'tierce) — voir docs/EDITORIAL_CONTENT.md. SOURCE_PROVIDED : repris '
  'tel quel d''une source dont la licence couvre explicitement ce texte '
  '(non utilisé à ce jour, aucune source de ce projet ne le permet encore).';
