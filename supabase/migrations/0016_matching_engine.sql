-- Phase 6 — Moteur de matching (déterministe, sans IA)
--
-- Trois éléments : 1) la matrice de compatibilité besoin↔offre, centralisée
-- et administrable (pas dispersée dans le code) ; 2) le stockage persistant
-- des correspondances calculées (entreprise↔entreprise et
-- opportunité↔entreprise), avec le détail du score et la version de
-- l'algorithme ; 3) les index nécessaires à la génération de candidats à
-- grande échelle (voir docs/MATCHING.md pour l'algorithme complet, qui vit
-- en TypeScript pour rester testable — cette migration ne fait QUE stocker
-- la matrice et les résultats, jamais le calcul lui-même).

-- 1) Matrice de compatibilité BESOIN ↔ OFFRE ------------------------------
--
-- Ne stocke que ce qui n'est PAS une évidence : une entreprise qui recherche
-- un DISTRIBUTOR est toujours compatible avec une entreprise qui propose
-- DISTRIBUTOR (même code) — cette règle réflexive est implicite, gérée par
-- le moteur (src/lib/matching/config.ts), pas dupliquée ici pour chaque
-- code. Cette table ne contient que les correspondances CROISÉES
-- (codes différents mais compatibles en pratique), avec un ratio < 1.
create table public.capability_compatibility (
  need_code text not null references public.business_capability_types (code) on delete cascade,
  offer_code text not null references public.business_capability_types (code) on delete cascade,
  compatibility_ratio numeric(3, 2) not null check (compatibility_ratio > 0 and compatibility_ratio <= 1),
  note text,
  created_at timestamptz not null default now(),
  primary key (need_code, offer_code)
);

comment on table public.capability_compatibility is
  'Correspondances CROISÉES besoin↔offre (codes différents), en plus de la '
  'règle réflexive implicite (même code = compatibilité totale, gérée par '
  'le moteur). Administrable sans redéploiement de code — voir docs/MATCHING.md §Matrice.';

insert into public.capability_compatibility (need_code, offer_code, compatibility_ratio, note) values
  ('DISTRIBUTOR', 'DISTRIBUTION_CAPACITY', 0.6, 'Une capacité de distribution déclarée répond partiellement à une recherche de distributeur.'),
  ('DISTRIBUTION_CAPACITY', 'DISTRIBUTOR', 0.6, 'Symétrique de la ligne précédente.'),
  ('MANUFACTURER', 'MANUFACTURING_CAPACITY', 0.6, 'Une capacité de fabrication déclarée répond partiellement à une recherche de fabricant.'),
  ('MANUFACTURING_CAPACITY', 'MANUFACTURER', 0.6, 'Symétrique de la ligne précédente.'),
  ('MANUFACTURER', 'SUBCONTRACTOR', 0.6, 'Un sous-traitant peut répondre à un besoin de fabrication.'),
  ('SUBCONTRACTOR', 'MANUFACTURER', 0.6, 'Symétrique de la ligne précédente.'),
  ('SUBCONTRACTOR', 'MANUFACTURING_CAPACITY', 0.6, 'Une capacité de fabrication peut répondre à un besoin de sous-traitance.'),
  ('MANUFACTURING_CAPACITY', 'SUBCONTRACTOR', 0.6, 'Symétrique de la ligne précédente.'),
  ('SALES_AGENT', 'COMMERCIAL_PARTNER', 0.6, 'Un partenaire commercial peut assurer un rôle de représentation.'),
  ('COMMERCIAL_PARTNER', 'SALES_AGENT', 0.6, 'Symétrique de la ligne précédente.'),
  ('TECHNOLOGY_PARTNER', 'LICENSING', 0.6, 'Une offre de licence peut répondre à une recherche de partenaire technologique.'),
  ('LICENSING', 'TECHNOLOGY_PARTNER', 0.6, 'Symétrique de la ligne précédente.');

alter table public.capability_compatibility enable row level security;

create policy "capability_compatibility_select_all" on public.capability_compatibility
  for select using (true);
create policy "capability_compatibility_write_admin" on public.capability_compatibility
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 2) Résultats persistés ----------------------------------------------------
--
-- Entreprise ↔ entreprise : compare le BESOIN d'une entreprise à l'OFFRE
-- d'une autre (jamais besoin↔besoin ni offre↔offre — voir docs/MATCHING.md).
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  need_id uuid not null references public.company_needs (id) on delete cascade,
  candidate_company_id uuid not null references public.companies (id) on delete cascade,
  offer_id uuid not null references public.company_offers (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  confidence smallint not null check (confidence between 0 and 100),
  -- Détail du score : explication du calcul (voir §Explicabilité de
  -- docs/MATCHING.md). Exception assumée au principe "pas de gros JSON" du
  -- projet : ceci est un artefact d'explication propre à CE match, pas une
  -- donnée métier structurée qu'on filtre/agrège across matches.
  score_breakdown jsonb not null,
  algorithm_version text not null,
  calculated_at timestamptz not null default now(),
  status text not null default 'suggested' check (status in ('suggested', 'viewed', 'dismissed', 'contacted')),
  feedback text check (feedback is null or feedback in ('relevant', 'not_relevant', 'already_in_contact', 'not_interested')),
  unique (need_id, offer_id)
);

comment on table public.matches is
  'Correspondance calculée entre le BESOIN d''une entreprise et l''OFFRE '
  'd''une autre. Écrite uniquement par le service de matching (clé secrète) '
  '— jamais par un client direct, voir RLS ci-dessous.';

create index matches_company_idx on public.matches (company_id);
create index matches_candidate_company_idx on public.matches (candidate_company_id);
create index matches_score_idx on public.matches (score desc);

-- Opportunité ↔ entreprise : direction 'seeking' compare l'opportunité à
-- des OFFRES candidates ; direction 'offering' compare à des BESOINS
-- candidats (une seule des deux colonnes est renseignée selon le cas).
create table public.opportunity_matches (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  candidate_company_id uuid not null references public.companies (id) on delete cascade,
  candidate_offer_id uuid references public.company_offers (id) on delete cascade,
  candidate_need_id uuid references public.company_needs (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  confidence smallint not null check (confidence between 0 and 100),
  score_breakdown jsonb not null,
  algorithm_version text not null,
  calculated_at timestamptz not null default now(),
  status text not null default 'suggested' check (status in ('suggested', 'viewed', 'dismissed', 'contacted')),
  feedback text check (feedback is null or feedback in ('relevant', 'not_relevant', 'already_in_contact', 'not_interested')),
  unique (opportunity_id, candidate_company_id),
  check (
    (candidate_offer_id is not null and candidate_need_id is null)
    or (candidate_offer_id is null and candidate_need_id is not null)
  )
);

comment on table public.opportunity_matches is
  'Entreprises compatibles avec une opportunité publiée. candidate_offer_id '
  'renseigné si l''opportunité "recherche" (comparée aux offres) ; '
  'candidate_need_id renseigné si elle "propose" (comparée aux besoins).';

create index opportunity_matches_opportunity_idx on public.opportunity_matches (opportunity_id);
create index opportunity_matches_candidate_company_idx on public.opportunity_matches (candidate_company_id);
create index opportunity_matches_score_idx on public.opportunity_matches (score desc);

-- RLS : un match contient potentiellement de l'information commerciale
-- sensible (voir Phase 6, tests de sécurité). Visible uniquement par les
-- deux entreprises concernées et les administrateurs de la plateforme —
-- jamais par le grand public, jamais par une entreprise tierce. Aucune
-- politique d'écriture : seule la clé secrète (service_role, qui contourne
-- la RLS) peut créer/mettre à jour un match — jamais un client direct,
-- pour qu'un score ne puisse jamais être fabriqué depuis le navigateur.
alter table public.matches enable row level security;

create policy "matches_select_involved_parties" on public.matches
  for select
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.has_company_role(candidate_company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

-- Une entreprise impliquée peut mettre à jour statut/feedback (ex. "vu",
-- "pas intéressé"), jamais le score ni le détail (protégé par déclencheur).
create policy "matches_update_involved_parties" on public.matches
  for update
  using (
    public.has_company_role(company_id, array['owner', 'admin', 'member'])
    or public.has_company_role(candidate_company_id, array['owner', 'admin', 'member'])
    or public.is_platform_admin()
  );

create or replace function public.protect_match_score_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_platform_admin() then
    return new;
  end if;
  if new.score is distinct from old.score
     or new.confidence is distinct from old.confidence
     or new.score_breakdown is distinct from old.score_breakdown
     or new.algorithm_version is distinct from old.algorithm_version then
    raise exception 'Le score d''un match ne peut être modifié que par le service de calcul.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_matches_score_trigger
  before update on public.matches
  for each row execute function public.protect_match_score_fields();

alter table public.opportunity_matches enable row level security;

create policy "opportunity_matches_select_involved_parties" on public.opportunity_matches
  for select
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member', 'viewer'])
    )
    or public.has_company_role(candidate_company_id, array['owner', 'admin', 'member', 'viewer'])
    or public.is_platform_admin()
  );

create policy "opportunity_matches_update_involved_parties" on public.opportunity_matches
  for update
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id and public.has_company_role(o.company_id, array['owner', 'admin', 'member'])
    )
    or public.has_company_role(candidate_company_id, array['owner', 'admin', 'member'])
    or public.is_platform_admin()
  );

create trigger protect_opportunity_matches_score_trigger
  before update on public.opportunity_matches
  for each row execute function public.protect_match_score_fields();
