# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

## [Non publié]

### Phase 3 — Authentification et gestion d'entreprise (2026-09-19)

#### Ajouté

- Connexion à un vrai projet Supabase (région `ca-central-1`).
- Authentification complète : inscription, confirmation de courriel, connexion, déconnexion, mot de passe oublié, réinitialisation — pages FR/EN avec segments d'URL traduits (`/connexion` vs `/login`, etc.).
- Rafraîchissement de session dans `src/proxy.ts`, protection serveur des pages privées.
- Page `/compte` : informations personnelles, statut de confirmation du courriel, liste des entreprises.
- Création d'entreprise transactionnelle (`create_company()`) : entreprise + établissement principal + secteur principal + description, rattachement automatique du créateur comme `owner`, gestion automatique des collisions de slug.
- Modification d'entreprise (owner/admin), liste des membres.
- Migrations 0007-0012 : `company_translations` (remplace `companies.description`), `audit_logs`, protection par déclencheur des champs contrôlés par la plateforme (`platform_role`, `subscription_level`, `verification_status`), fonction `create_company()`.
- Suite de tests d'intégration réelle contre le vrai projet (`npm run test:integration`), séparée des tests unitaires : inscription/connexion, visiteur ne peut pas écrire, création + rattachement automatique, owner peut modifier son entreprise mais pas les champs protégés, member limité à ses actions autorisées, utilisateur extérieur ne peut rien modifier, tentative d'élévation de privilège bloquée, journal d'audit.

#### Corrigé (trouvé par les tests réels, pas par la relecture)

- La politique d'insertion sur `companies` utilisait `auth.role()`, peu fiable en conditions réelles sur ce projet : remplacée par `auth.uid() is not null` (migration 0011).
- `create_company()` se heurtait à un paradoxe RLS/RETURNING (la ligne fraîchement créée n'était pas visible par son créateur avant l'exécution du déclencheur de rattachement) : passée en `SECURITY DEFINER` (migration 0012).

#### Décidé

- Aucun jeton d'accès CLI ni mot de passe de base de données partagé avec l'assistant : les migrations sont appliquées manuellement via l'éditeur SQL du tableau de bord.
- `audit_logs` avancé de la Phase 9 à la Phase 3 (nécessaire dès maintenant pour tracer création d'entreprise et tentatives sur des champs protégés).

### Phase 2 — Modèle de données central (2026-09-19)

#### Ajouté

- Migrations SQL (`supabase/migrations/0001` à `0006`) : `profiles` (liée à `auth.users`), `companies`, `company_locations`, `company_members`, taxonomie sectorielle (`industries`, `subindustries`, `products_services`), `business_capability_types`, `company_offers`/`company_needs`, `company_markets`, `languages`, `certifications`, `data_sources`/`company_source_records`.
- Politique de sécurité (Row Level Security) écrite avec chaque table, portée par deux fonctions réutilisables : `is_platform_admin()` et `has_company_role()`.
- Rattachement automatique : un nouvel utilisateur obtient un profil automatiquement (déclencheur sur `auth.users`) ; le créateur d'une entreprise en devient automatiquement `owner`.
- Validation locale des migrations (base Postgres embarquée simulant `auth.users`) : les 6 fichiers s'appliquent sans erreur, scénario de bout en bout vérifié (voir `docs/DATABASE.md`).
- Réorganisation des données de sourcing existantes (`data/raw/france/`, `data/raw/quebec/`, `data/raw/matching/`) avec vérification d'intégrité, non versionnées, documentées dans `data/README.md`.

#### Décidé (suite aux précisions demandées avant la phase)

- `profiles` (1:1 avec `auth.users`) plutôt qu'une table `users` dupliquant l'identité de connexion déjà gérée par Supabase Auth.
- Rôles `company_members` (`owner`/`admin`/`member`/`viewer`) explicitement distincts du rôle plateforme (`profiles.platform_role`).
- Vocabulaire des types d'offre/besoin en base (`business_capability_types`), pas codé en dur, pour rester éditable depuis l'administration.
- `companies.description` unique (pas de `_fr`/`_en`) ; adresses uniquement dans `company_locations` (plus sur `companies`).
- Correspondance avec les nomenclatures officielles (NAF/NAICS/SCIAN) explicitement différée à une table future, si le besoin se confirme.

### Phase 1 — Initialisation du projet (2026-09-19)

#### Ajouté

- Socle Next.js 16 (TypeScript, App Router) + Tailwind CSS 4.
- Internationalisation FR/EN (`next-intl`) avec routage par préfixe de langue (`/fr`, `/en`), français par défaut.
- Page d'accueil provisoire reprenant la proposition de valeur du produit.
- Connexion technique à Supabase (client navigateur et client serveur), sans fonctionnalité branchée dessus pour l'instant.
- Validation des variables d'environnement (`src/lib/env.ts`) avec messages d'erreur clairs.
- Schémas de validation réutilisables (`src/validations/common.ts`).
- Utilitaire `slugify` pour les futures URLs d'entreprises.
- Tests unitaires (Vitest) pour les utilitaires et validations.
- ESLint + Prettier configurés ensemble.
- Documentation : `PROJECT_SPEC.md` (révisé), `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/PRIVACY.md`.

#### Corrigé (revue de `PROJECT_SPEC.md` avant développement)

- Le modèle de données ne permettait qu'un seul utilisateur par entreprise (`owner_user_id`) : remplacé par une vraie table `company_members`, prête pour plusieurs utilisateurs dès le lancement.
- Le matching opportunité ↔ entreprise n'existait pas explicitement (seul entreprise ↔ entreprise était couvert) : ajout de `opportunity_matches` et `opportunity_match_score_details`.
- Ajout de la couche de confidentialité RGPD/Loi 25 (`user_consents`, `data_subject_requests`) suite à la décision d'hébergement.

#### Décidé

- Région d'hébergement Supabase : Canada Central (`ca-central-1`).
