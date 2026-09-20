-- Phase 7 — Correctif : remplissage initial de companies.search_vector
--
-- Bug trouvé en testant avec les données de démonstration réelles (§39) :
-- la migration 0017 ajoute la colonne `search_vector` et des déclencheurs
-- qui la recalculent à chaque INSERT/UPDATE/DELETE pertinent — mais un
-- déclencheur ne s'exécute que pour les changements FUTURS. Les entreprises
-- déjà présentes avant l'application de 0017 (dont les entreprises
-- `[DEMO]`) se sont retrouvées avec `search_vector` à `null`, donc
-- invisibles à `search_companies()` malgré `status = 'active'`.
--
-- Correctif ponctuel, sans rapport avec le schéma : recalcule la colonne
-- pour toutes les entreprises existantes, une seule fois. Sans effet sur
-- les entreprises créées après 0017 (déjà à jour par déclencheur) —
-- ré-exécuter cette migration ne changerait rien pour elles.
do $$
declare
  r record;
begin
  for r in select id from public.companies loop
    perform public.refresh_company_search_vector(r.id);
  end loop;
end;
$$;
