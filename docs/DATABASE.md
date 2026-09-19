# Base de données

Le modèle de données complet, table par table, avec les raisons de chaque choix, est documenté dans `PROJECT_SPEC.md` (§4 "Modèle de données relationnel"). Ce fichier ne le duplique pas — il explique seulement où et comment les choses seront mises en œuvre techniquement.

## Statut actuel

Aucune table n'est encore créée. La Phase 1 (celle-ci) ne prépare que la connexion technique à Supabase (`src/lib/supabase/`). Les migrations SQL arrivent en **Phase 2**.

## Où vivront les migrations

`supabase/migrations/` — un fichier SQL numéroté par migration, exactement comme Supabase CLI les génère. Rien n'y est encore créé.

## Rappels de conception (voir PROJECT_SPEC.md pour le détail)

- Pas de gros champs JSON pour des données structurées/filtrables : les relations plusieurs-à-plusieurs (secteurs, produits, langues, marchés) passent par de vraies tables de jointure.
- Séparation stricte entre données personnelles (`users`) et données professionnelles (`companies` et tout le reste).
- Chaque entreprise peut avoir plusieurs utilisateurs rattachés (`company_members`), plusieurs établissements (`company_locations`), plusieurs besoins, offres et opportunités.
- Deux tables de correspondance distinctes : `matches` (entreprise ↔ entreprise) et `opportunity_matches` (opportunité ↔ entreprise) — voir §4.6 et §7 de `PROJECT_SPEC.md`.
- Sécurité au niveau ligne (Row Level Security) sur toutes les tables contenant des données appartenant à un utilisateur ou une entreprise précise — à écrire en même temps que chaque table en Phase 2.
