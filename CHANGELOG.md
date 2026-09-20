# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

## [Non publié]

### Phase 7 — Annuaire public, recherche et revendication (2026-09-19)

#### Ajouté

- Annuaire public (`/entreprises`, `/companies`) : recherche plein texte PostgreSQL (`search_companies()`, `tsvector`/GIN + `unaccent`, insensible aux accents — "Québec"/"Quebec" équivalents), filtres combinables (pays, région, ville, secteur, sous-secteur, produit/service, type proposé/recherché, marché cible, vérifiée, opportunités actives), tri (pertinence/nom/plus récentes), pagination "limit+1" (aucun `COUNT(*)` séparé).
- URLs géographiques/sectorielles (`/entreprises/france`, `/entreprises/canada`, `/entreprises/quebec`, `/entreprises/[geo]/[industry]`) via un ensemble fixe et restreint (`geoSlugs.ts`) — jamais de génération automatique de combinaisons.
- Fiche entreprise publique (`/entreprises/[slug]`) : identité, description, secteurs, produits/services, langues, certifications, offres/besoins/opportunités actifs, coordonnées professionnelles (jamais l'adresse complète ni de donnée personnelle), données structurées `schema.org` (Organization), bouton "Copier le lien".
- Compatibilité ciblée sur la fiche publique (`getCompatibilityBetweenCompanies`, réutilise strictement le moteur Phase 6, jamais un score parallèle) avec sélecteur d'entreprise pour un utilisateur qui en possède plusieurs.
- Revendication d'entreprise (`company_claims`) : méthode A (auto-approbation si le domaine du courriel professionnel correspond ET au domaine réel du compte connecté ET n'est pas un domaine grand public ET l'entreprise n'a encore aucun membre) et méthode B (examen manuel par un administrateur, `/admin/revendications`). Attribution `owner` si l'entreprise n'a aucun membre, `admin` sinon — un propriétaire déjà légitime n'est jamais déplacé. Écriture exclusivement via trois fonctions SECURITY DEFINER, aucune politique RLS d'insertion/mise à jour pour un client normal.
- `companies.claimed_at` : protège une entreprise déjà revendiquée contre un futur réimport aveugle (Phase 10).
- SEO : `sitemap.xml`/`robots.txt` générés, `generateMetadata` par page (titre/description/canonical/Open Graph), indexation conditionnelle des listes filtrées (`shouldIndexDirectoryPage()`), fil d'Ariane balisé, `metadataBase` ajouté (manquant depuis la Phase 5, corrigé ici).
- Page d'accueil mise à jour : barre de recherche (redirection GET vers l'annuaire, aucune IA), CTA "Trouver une entreprise"/"Voir les opportunités"/"Inscrire mon entreprise".
- Migrations `0017_public_directory_search.sql`, `0018_company_claims.sql` et `0019_backfill_search_vectors.sql` (correctif, voir ci-dessous), validées localement puis appliquées au projet réel.
- Nouveaux tests unitaires (`tests/unit/directory/indexing.test.ts`) et tests d'intégration réels (`tests/integration/directory.test.ts` : recherche publique, sécurité de la revendication — y compris l'échec d'un courriel usurpé ne correspondant pas au compte réel et l'impossibilité de modifier `claim_status` directement —, compatibilité ciblée). Toutes les suites précédentes continuent de passer.
- `docs/DIRECTORY.md` et `docs/CLAIMING.md`.

#### Corrigé

- `0019_backfill_search_vectors.sql` : les entreprises créées avant la migration 0017 (dont les entreprises `[DEMO]`) avaient `search_vector` à `null` — un déclencheur ne recalcule que pour les changements futurs, jamais pour les lignes déjà en base. Trouvé en testant la recherche avec les vraies données de démonstration (§39 du cahier des charges), pas seulement en local.

#### Documenté

- `PROJECT_SPEC.md` (§4.8, §6, §8, §10, §16) mis à jour pour refléter le schéma et l'arborescence réellement construits ; `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/MATCHING.md` complétés.

#### Décidé

- Recherche en plein texte PostgreSQL plutôt qu'`ILIKE`, pour rester performant à l'échelle visée (100 000+ entreprises).
- Compatibilité affichée uniquement sur la fiche d'une entreprise, jamais dans la liste de résultats (évite de recalculer des dizaines de scores par page vue).
- Un seul segment de route `[geoOrSlug]` pour fiches entreprise ET entrées géographiques (contrainte Next.js sur les segments dynamiques).
- Pas de logo d'entreprise ni de favoris cette phase (aucun stockage de fichiers configuré ; `favorites` reste une table de la Phase 9).

### Phase 6 — Moteur de matching (2026-09-19)

#### Ajouté

- Moteur de matching déterministe (aucune IA/embedding) : entreprise↔entreprise (besoin comparé à une offre) et opportunité↔entreprise (dans les deux sens, selon `direction`). Architecture en deux étapes : génération de candidats en SQL (`src/lib/matching/candidateGeneration.ts`, filtrage par compatibilité/statut avant tout calcul détaillé) puis scoring en TypeScript pur, testable sans base de données (`src/lib/matching/scoring.ts`).
- `capability_compatibility` : matrice de compatibilité besoin↔offre administrable, ne stockant que les correspondances croisées (règle réflexive "même code = compatible" implicite dans le moteur).
- `matches` et `opportunity_matches` : score (0-100), confiance (0-100, reflète les données manquantes), détail par critère, version de l'algorithme (`MATCH_V1`), écriture réservée à la clé secrète — aucune politique RLS n'autorise un client normal à fabriquer un score, déclencheur `protect_match_score_fields` en défense supplémentaire.
- Barème centralisé (30/20/15/10/5/5/5/5/5 = 100), incompatibilité fondamentale = élimination complète (pas un score de 0), donnée manquante = ratio neutre + réduction de la confiance (jamais du score au-delà de ce ratio).
- Interface : "Vos partenaires potentiels" et "Opportunités pour vous" (page entreprise), "Entreprises compatibles" (page de gestion d'une opportunité), avec repli "Pourquoi ce score ?" détaillant chaque critère.
- Migration `0016_matching_engine.sql`, validée localement puis appliquée au projet réel.
- 28 nouveaux tests unitaires (`tests/unit/matching/scoring.test.ts`, règles métier, déterminisme) et de nouveaux tests d'intégration réels (`tests/integration/matching.test.ts` : cohérence métier + sécurité RLS des tables de matching). Les suites précédentes continuent de passer.
- `docs/MATCHING.md` : architecture, pondération, gestion des données manquantes, limites connues, stratégie de recalcul.

#### Documenté

- `PROJECT_SPEC.md` §4.6/§7 mis à jour pour refléter le schéma réellement construit (différences avec la version envisagée en Phase 0 : `score_breakdown` en jsonb plutôt qu'une table séparée, pas de `partnership_requests` cette phase).

#### Décidé

- Recalcul "à la lecture" (appelé depuis les Server Components, upserté comme sous-produit) plutôt qu'un déclencheur sur chaque écriture — simplicité et fiabilité pour le MVP.
- Certifications requises non modélisées sur `company_needs` : critère toujours neutre pour l'instant (limite documentée, pas un oubli).
- Vocabulaire imposé : "Score de compatibilité", jamais "Probabilité de réussite".

### Phase 5 — Opportunités commerciales (2026-09-19)

#### Ajouté

- `opportunities` : intention commerciale ponctuelle avec échéance, distincte du profil durable (offres/besoins) — titre et slug composés automatiquement, réutilisation de `business_capability_types` (+ direction seeking/offering) plutôt qu'un nouveau vocabulaire, produits/services rattachés, dates de publication/expiration calculées automatiquement (90 jours par défaut).
- Cycle de vie complet : brouillon → publiée → pause/clôture → archivage, avec fonction administrable `expire_stale_opportunities()`.
- `opportunity_responses` : une entreprise répond à une opportunité **au nom d'une entreprise**, jamais en son nom propre ; auto-réponse interdite (déclencheur) ; une seule réponse active par entreprise et par opportunité ; qui peut changer quoi strictement séparé entre répondant et éditeur (déclencheur) ; confidentialité stricte (RLS).
- `notifications` (avancée depuis la Phase 8/9) + `create_notification()` : notifications automatiques à la réception d'une réponse et à son acceptation/refus.
- Interface complète : page publique `/opportunites` (filtres : type, secteur, pays d'origine/cible, région, produit) et `/opportunites/[slug]` (détail + réponse), gestion dans l'espace entreprise (création avec pré-remplissage depuis une offre/un besoin existant, édition, changement de statut, consultation/acceptation/refus des réponses reçues) — FR/EN avec URLs traduites.
- Migrations `0014_opportunities.sql` et `0015_opportunity_responses_and_notifications.sql`, validées localement puis appliquées au projet réel.
- 22 nouveaux tests d'intégration réels (`tests/integration/opportunities.test.ts`) : rôles, visibilité des brouillons, auto-réponse interdite, confidentialité, notifications, expiration. Les 32 tests des Phases 3-4 continuent de passer (54 au total).
- 3 opportunités de démonstration (`npm run seed:demo`), entreprises marquées `[DEMO]` pour ne jamais être confondues avec de vraies entreprises.

#### Documenté

- Distinction OFFRE/BESOIN (durable) vs OPPORTUNITÉ (ponctuelle, avec durée de vie et réponses) précisée dans `PROJECT_SPEC.md` §4.4/§4.5.

#### Décidé

- Codes `business_capability_types` existants non renommés (déjà tranché en Phase 4) ; réutilisés tels quels pour les opportunités via un champ `direction`.
- Expiration calculée à la lecture plutôt que par tâche planifiée (pas de pg_cron dans cet environnement) — fonction manuelle/administrable disponible.
- Entreprises de démonstration marquées `[DEMO]` dans leur nom et leur description.

### Phase 4 — Offres et besoins structurés (2026-09-19)

#### Ajouté

- Enrichissement de `company_offers`/`company_needs` : titre (composé automatiquement), statut actif/inactif, secteur optionnel, taille de partenaire recherchée (besoins).
- Produits/services et langues rattachables à une offre ou un besoin précis (`company_offer_products_services`, `company_need_products_services`, `company_offer_languages`, `company_need_languages`), en plus de la description libre.
- 3 nouvelles catégories (`LICENSING`, `FRANCHISING`, `OTHER`) dans `business_capability_types`.
- Interface "Mon entreprise" enrichie (`/compte/entreprises/[id]`) : sections Profil, Produits & services, Nous proposons, Nous recherchons, Membres — ajout/modification/activation-désactivation/suppression d'une offre ou d'un besoin, avec libellés commerciaux (jamais de vocabulaire technique visible).
- Index de recherche interne (catégorie, entreprise, statut, pays, secteur, produit) et requêtes de démonstration ("qui propose X", "qui recherche X", "besoins ciblant tel pays").
- Journal d'audit des offres/besoins (création, changement de statut, modification, suppression) sans jamais journaliser le titre ni la description.
- Jeu de données de démonstration (`npm run seed:demo`, `scripts/seed-demo-data.mjs`) : 3 entreprises dont l'offre de l'une correspond au besoin de l'autre, pensées pour la future Phase 6.
- Migration `0013_offers_needs_enrichment.sql`, validée localement puis appliquée au projet réel.
- Suite de tests d'intégration réelle `tests/integration/offers-needs.test.ts` (15 tests : rôles, contraintes, statuts, audit) — la suite de la Phase 3 continue de passer sans modification.

#### Documenté

- Distinction conceptuelle OFFRE/BESOIN (profil durable de l'entreprise) vs OPPORTUNITÉ (Phase 5, publication ponctuelle avec durée de vie) — voir `PROJECT_SPEC.md` §4.4.
- Réorientation de la feuille de route : offres/besoins/opportunités/matching avant l'annuaire public, à la demande explicite du propriétaire du projet.

#### Décidé

- Codes `business_capability_types` déjà en place non renommés malgré une liste de noms légèrement différente demandée (éviter de casser des données déjà créées) ; équivalence documentée.
- Jeu de données de démonstration livré comme script (idempotent), pas comme migration — une migration décrit un changement de schéma, pas des données.

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
