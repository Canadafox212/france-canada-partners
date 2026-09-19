# Base de données

Le modèle de données complet, table par table, avec les raisons de chaque choix, est documenté dans `PROJECT_SPEC.md` (§4 "Modèle de données relationnel"). Ce fichier explique seulement où et comment les choses sont mises en œuvre techniquement.

## Statut actuel (fin de Phase 4)

**Un vrai projet Supabase existe et est connecté** (région Canada Central, `ca-central-1`). Les 13 migrations ci-dessous y sont appliquées et vérifiées.

| Fichier                                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0001_profiles.sql`                    | `profiles` (liée 1:1 à `auth.users`), création automatique à l'inscription, fonction `is_platform_admin()`                                                                                                                                                                                                                                                                                                         |
| `0002_companies_and_members.sql`       | `companies`, `company_locations`, `company_members`, fonction `has_company_role()`, rattachement automatique du créateur comme `owner`                                                                                                                                                                                                                                                                             |
| `0003_taxonomy.sql`                    | `industries`, `subindustries`, `products_services` + tables de jointure entreprise                                                                                                                                                                                                                                                                                                                                 |
| `0004_offers_needs_markets.sql`        | `business_capability_types`, `company_offers`, `company_needs`, `company_markets`                                                                                                                                                                                                                                                                                                                                  |
| `0005_languages_certifications.sql`    | `languages`, `certifications` + tables de jointure entreprise                                                                                                                                                                                                                                                                                                                                                      |
| `0006_data_sources.sql`                | `data_sources`, `company_source_records`                                                                                                                                                                                                                                                                                                                                                                           |
| `0007_company_translations.sql`        | `company_translations` (remplace `companies.description`), repli de langue géré côté application                                                                                                                                                                                                                                                                                                                   |
| `0008_audit_logs.sql`                  | `audit_logs` + fonction `log_audit_event()` (SECURITY DEFINER)                                                                                                                                                                                                                                                                                                                                                     |
| `0009_protect_sensitive_columns.sql`   | Déclencheurs bloquant la modification de `profiles.platform_role` et `companies.subscription_level`/`verification_status` par un non-administrateur ; journalisation des changements légitimes et de la création d'entreprise                                                                                                                                                                                      |
| `0010_create_company_rpc.sql`          | Fonction `create_company()` : création transactionnelle entreprise + établissement + secteur + traduction, gestion automatique des collisions de slug                                                                                                                                                                                                                                                              |
| `0011_fix_companies_insert_policy.sql` | **Correction** : la politique d'insertion sur `companies` utilisait `auth.role()`, qui s'est révélé peu fiable en conditions réelles sur ce projet ; remplacée par `auth.uid() is not null`                                                                                                                                                                                                                        |
| `0012_fix_create_company_security.sql` | **Correction** : `create_company()` passée en `SECURITY DEFINER` pour éviter un paradoxe RLS (une ligne fraîchement insérée n'est pas visible par `RETURNING` avant que le déclencheur de rattachement `owner` n'ait fini de s'exécuter)                                                                                                                                                                           |
| `0013_offers_needs_enrichment.sql`     | Enrichissement de `company_offers`/`company_needs` (titre, statut actif/inactif, secteur optionnel) ; nouvelles tables `company_offer_products_services`, `company_need_products_services`, `company_offer_languages`, `company_need_languages` ; index de recherche ; catégories `LICENSING`/`FRANCHISING`/`OTHER` ; déclencheurs d'audit (création/statut/suppression, sans jamais journaliser le contenu libre) |

Chaque table a sa politique de sécurité (Row Level Security) écrite dans le même fichier que la table. Les corrections 0011 et 0012 n'ont été trouvées **qu'en testant contre le vrai projet** : la validation locale (Postgres embarqué) ne pouvait pas les révéler, car ce moteur de test s'exécute avec des droits complets et ne peut pas simuler l'application réelle de la RLS. C'est précisément pourquoi les tests contre le projet réel (`tests/integration/`) sont indispensables, pas seulement la validation locale.

### Données de démonstration (Phase 4)

`scripts/seed-demo-data.mjs` (`npm run seed:demo`) crée 3 entreprises de test (2 secteurs, 3 produits/services, 3 offres, 2 besoins) pensées pour la future Phase 6 : l'offre de l'une correspond au besoin de l'autre, et réciproquement. Ce n'est **pas** une migration (pas un changement de schéma) et **pas** un import réel — les entreprises créées n'ont pas de propriétaire (`owner`), elles restent à revendiquer. Script idempotent (s'arrête sans dupliquer si déjà exécuté).

## Comment appliquer une nouvelle migration

Aucun accès direct (jeton CLI, mot de passe de connexion à la base) n'a été partagé avec l'assistant, par prudence — l'application se fait donc manuellement :

1. Ouvrir le tableau de bord Supabase → SQL Editor → New query.
2. Copier-coller le contenu du fichier de migration, dans l'ordre.
3. Exécuter, vérifier l'absence d'erreur.

Si un jour l'accès CLI est configuré (jeton d'accès personnel), `npx supabase db push` permettrait d'automatiser cette étape — non fait à ce stade.

## Rappels de conception (voir PROJECT_SPEC.md pour le détail)

- Pas de gros champs JSON pour des données structurées/filtrables : les relations plusieurs-à-plusieurs (secteurs, produits, langues, marchés) passent par de vraies tables de jointure.
- Séparation stricte entre données personnelles (`profiles`, liée à `auth.users`) et données professionnelles (`companies` et tout le reste).
- Chaque entreprise peut avoir plusieurs utilisateurs rattachés (`company_members`, avec un rôle **dans l'entreprise** distinct du rôle **sur la plateforme**, `profiles.platform_role`), plusieurs établissements (`company_locations`), plusieurs besoins, offres, secteurs, produits, marchés, langues et certifications.
- Les catégories d'offre/besoin (`business_capability_types`) vivent en base, pas dans le code, pour rester modifiables depuis l'administration.
- Deux fonctions PostgreSQL réutilisables portent la logique de sécurité : `is_platform_admin()` et `has_company_role(company_id, roles[])`, appelées par toutes les politiques RLS plutôt que de dupliquer la même sous-requête partout.
- Les champs contrôlés par la plateforme (`profiles.platform_role`, `companies.subscription_level`, `companies.verification_status`) sont protégés par des déclencheurs, pas seulement par la RLS — voir `docs/SECURITY.md`.
- Une offre/un besoin (`company_offers`/`company_needs`) appartient au profil **durable** de l'entreprise ; une future opportunité (Phase 5) sera une publication **ponctuelle** avec durée de vie — voir PROJECT_SPEC.md §4.4.
- Tables encore à venir (par phase) : `opportunities`/`opportunity_responses` (5), `matches`/`opportunity_matches` (6), `claim_requests`/`company_verifications` (8), `notifications`/`favorites` (9), `subscriptions` (12), `user_consents`/`data_subject_requests` (avant le lancement commercial).

## Tests

- `tests/unit/` : tests rapides, hors-ligne (`npm test`).
- `tests/integration/` : tests réels contre le vrai projet Supabase (`npm run test:integration`) — créent et suppriment leurs propres utilisateurs/entreprises de test à chaque exécution. Nécessitent `.env.local`. Deux fichiers : `rls.test.ts` (comptes, entreprises, protection des champs sensibles) et `offers-needs.test.ts` (offres/besoins, rôles, contraintes, audit). Voir `docs/SECURITY.md` pour ce qu'ils couvrent.

## Données de sourcing (pas encore importées)

`data/raw/` contient des fichiers d'entreprises déjà collectés (France, Québec) et un prototype de matching — voir `data/README.md`. Ils ne sont ni lus ni importés par le code à ce stade ; ils serviront de matière première au pipeline d'import (Phase 10).
