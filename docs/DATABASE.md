# Base de données

Le modèle de données complet, table par table, avec les raisons de chaque choix, est documenté dans `PROJECT_SPEC.md` (§4 "Modèle de données relationnel"). Ce fichier explique seulement où et comment les choses sont mises en œuvre techniquement.

## Statut actuel (fin de Phase 2)

Les migrations SQL du socle central sont écrites dans `supabase/migrations/` :

| Fichier                             | Contenu                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_profiles.sql`                 | `profiles` (liée 1:1 à `auth.users`), création automatique à l'inscription, fonction `is_platform_admin()`                             |
| `0002_companies_and_members.sql`    | `companies`, `company_locations`, `company_members`, fonction `has_company_role()`, rattachement automatique du créateur comme `owner` |
| `0003_taxonomy.sql`                 | `industries`, `subindustries`, `products_services` + tables de jointure entreprise                                                     |
| `0004_offers_needs_markets.sql`     | `business_capability_types`, `company_offers`, `company_needs`, `company_markets`                                                      |
| `0005_languages_certifications.sql` | `languages`, `certifications` + tables de jointure entreprise                                                                          |
| `0006_data_sources.sql`             | `data_sources`, `company_source_records`                                                                                               |

Chaque table a sa politique de sécurité (Row Level Security) écrite dans le même fichier, pas ajoutée après coup.

**Ces migrations n'ont pas encore été appliquées à un vrai projet Supabase** (aucun projet n'existe encore — à créer par le propriétaire du projet, région `ca-central-1`). Elles ont été validées localement avec une base Postgres embarquée simulant `auth.users`/`auth.uid()` : les 6 fichiers s'appliquent sans erreur, et un scénario de bout en bout a été vérifié (inscription → profil créé automatiquement → création d'entreprise → rattachement automatique comme propriétaire → secteur, produit, offre, besoin, marché, langue, certification, source). Cette validation ne couvre pas l'application réelle des politiques RLS (le moteur de test agit avec des droits complets) : à revérifier une fois connecté à un vrai projet Supabase.

## Comment appliquer ces migrations

Une fois un projet Supabase créé (région Canada Central) :

```bash
npx supabase login
npx supabase link --project-ref <votre-ref-de-projet>
npx supabase db push
```

Ou, plus simplement pour démarrer : copier-coller le contenu de chaque fichier, dans l'ordre, dans l'éditeur SQL du tableau de bord Supabase.

## Rappels de conception (voir PROJECT_SPEC.md pour le détail)

- Pas de gros champs JSON pour des données structurées/filtrables : les relations plusieurs-à-plusieurs (secteurs, produits, langues, marchés) passent par de vraies tables de jointure.
- Séparation stricte entre données personnelles (`profiles`, liée à `auth.users`) et données professionnelles (`companies` et tout le reste).
- Chaque entreprise peut avoir plusieurs utilisateurs rattachés (`company_members`, avec un rôle **dans l'entreprise** distinct du rôle **sur la plateforme**, `profiles.platform_role`), plusieurs établissements (`company_locations`), plusieurs besoins, offres, secteurs, produits, marchés, langues et certifications.
- Les catégories d'offre/besoin (`business_capability_types`) vivent en base, pas dans le code, pour rester modifiables depuis l'administration.
- Deux fonctions PostgreSQL réutilisables portent la logique de sécurité : `is_platform_admin()` et `has_company_role(company_id, roles[])`, appelées par toutes les politiques RLS plutôt que de dupliquer la même sous-requête partout.
- Tables encore à venir (par phase) : `opportunities`/`opportunity_responses` (5), `matches`/`opportunity_matches` (6), `claim_requests`/`company_verifications` (7), `notifications`/`favorites` (8), `audit_logs` (9), `subscriptions` (11), `user_consents`/`data_subject_requests` (avant le lancement commercial).

## Données de sourcing (pas encore importées)

`data/raw/` contient des fichiers d'entreprises déjà collectés (France, Québec) et un prototype de matching — voir `data/README.md`. Ils ne sont ni lus ni importés par le code à ce stade ; ils serviront de matière première au pipeline d'import (Phase 10).
