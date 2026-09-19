# PROJECT_SPEC.md — France-Canada Partners

> Document de référence permanent du projet. Toute décision structurante importante doit être reflétée ici avant/pendant son implémentation. Ce document est mis à jour au fil des phases, pas figé.

**Statut** : Phase 1 — initialisation technique en cours.
**Dernière mise à jour** : 2026-09-19
**Propriétaire produit** : non-développeur — toute section technique doit rester accompagnée d'une explication en langage clair dans les échanges de suivi.

---

## 0. Vérification de robustesse du modèle (revue du 2026-09-19)

Avant de démarrer la Phase 1, le modèle de données a été relu point par point pour vérifier qu'il supporte réellement les exigences suivantes. Deux lacunes ont été corrigées (marquées ✅ _corrigé_), tout le reste était déjà couvert par la version précédente.

| #   | Exigence                                 | Statut                                                                                                                    |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | 100 000 entreprises ou plus              | OK — modèle relationnel indexable, pas de table monolithique                                                              |
| 2   | Plusieurs utilisateurs par entreprise    | ✅ _corrigé_ — `company_members` devient une table du socle MVP (voir §4.2), au lieu d'un simple `owner_user_id`          |
| 3   | Une entreprise, plusieurs établissements | OK — `company_locations`                                                                                                  |
| 4   | Plusieurs secteurs et sous-secteurs      | OK — `company_industries` (jointure many-to-many)                                                                         |
| 5   | Plusieurs produits et services           | OK — `company_products_services`                                                                                          |
| 6   | Plusieurs marchés actuels/recherchés     | OK — `company_markets` avec `market_type`                                                                                 |
| 7   | Plusieurs besoins                        | OK — `company_needs`, plusieurs lignes par entreprise                                                                     |
| 8   | Plusieurs offres                         | OK — `company_offers`, plusieurs lignes par entreprise                                                                    |
| 9   | Plusieurs opportunités                   | OK — `opportunities.company_id`, sans contrainte d'unicité                                                                |
| 10  | Plusieurs réponses à une opportunité     | OK — `opportunity_responses`                                                                                              |
| 11  | Matching entreprises ↔ entreprises       | OK — `matches`                                                                                                            |
| 12  | Matching opportunités ↔ entreprises      | ✅ _corrigé_ — cette relation n'existait pas explicitement ; ajout de `opportunity_matches` (voir §4.6)                   |
| 13  | FR et EN dès le MVP                      | OK — colonnes `_fr`/`_en` sur les taxonomies + `next-intl`                                                                |
| 14  | Autres langues plus tard                 | OK avec limite documentée — voir §12 (note sur la migration vers une table `translations` générique au-delà de 2 langues) |
| 15  | Abonnements FREE/PREMIUM/BUSINESS        | OK — `companies.subscription_level` + `subscriptions`                                                                     |
| 16  | Revendication d'entreprise existante     | OK — `claim_requests` + `company_verifications`                                                                           |
| 17  | Importation massive                      | OK — `data_sources`, workflow admin par lot                                                                               |
| 18  | Dédoublonnage                            | OK — rapprochement + validation manuelle, jamais automatique                                                              |
| 19  | Traçabilité des sources                  | OK — `data_sources` + `company_data_sources`                                                                              |
| 20  | Administration et modération             | OK — §8                                                                                                                   |

**Vérification JSON** : aucun champ JSON massif n'est utilisé pour des données structurées/filtrables. Le seul champ non-relationnel est `embedding` (type vecteur, réservé au matching par IA future — ce n'est pas un JSON, c'est un type nécessaire pour `pgvector`).

---

## 1. Vision produit

Plateforme B2B de mise en relation entre entreprises françaises et canadiennes, priorité **France ↔ Québec** au lancement, architecture prête pour une extension à tout le Canada.

Proposition de valeur : _« Trouvez le bon partenaire d'affaires entre la France et le Canada. »_

Ce n'est pas un annuaire : le produit central est un **moteur de correspondance** entre les besoins déclarés ("Je recherche") et les offres déclarées ("Je propose") des entreprises.

---

## 2. Choix d'architecture technique

### Décision : Next.js (TypeScript) + PostgreSQL via Supabase + Tailwind CSS

**Pourquoi**

- Données fortement relationnelles (entreprises ↔ besoins ↔ offres ↔ opportunités ↔ correspondances) → une base relationnelle (PostgreSQL) est le bon outil ; WordPress (modèle post/meta) y est structurellement mal adapté.
- SEO critique (le trafic organique est le principal canal d'acquisition prévisible pour un annuaire spécialisé) → Next.js offre un rendu serveur natif et un contrôle fin des métadonnées.
- Supabase fournit en un seul service : base PostgreSQL, authentification, stockage de fichiers, sécurité au niveau ligne (Row Level Security) → réduit fortement le travail d'infrastructure pour un MVP piloté par un non-développeur.
- PostgreSQL supporte l'extension `pgvector`, ce qui permettra d'ajouter un matching par IA (recherche sémantique) plus tard **sans migrer de base de données**.
- Coût de départ quasi nul (paliers gratuits Vercel + Supabase), progressif avec la croissance réelle.
- TypeScript de bout en bout : code plus sûr, plus facile à faire vérifier et faire évoluer par un assistant IA (Claude Code).

**Comparaison**

| Critère                                | WordPress                | Laravel                        | Next.js + Supabase          |
| -------------------------------------- | ------------------------ | ------------------------------ | --------------------------- |
| Modèle relationnel complexe            | Faible                   | Bon                            | Bon                         |
| SEO natif                              | Bon                      | Correct (effort requis)        | Excellent                   |
| Coût de démarrage                      | Très faible              | Faible                         | Faible                      |
| Coût à 100k+ entreprises               | Élevé (plugins)          | Modéré                         | Modéré                      |
| Sécurité (surface d'attaque)           | Dépend des plugins tiers | Bonne                          | Bonne                       |
| Évolution IA (matching sémantique)     | Très difficile           | Possible via services externes | Native (pgvector)           |
| Admin prêt à l'emploi                  | Oui                      | Oui (ex. Filament)             | Non — à construire (simple) |
| Adapté au développement assisté par IA | Correct                  | Bon                            | Excellent                   |

**Risques**

- Pas d'admin "clé en main" → compensé par un back-office volontairement simple, livré par petites étapes.
- Dépendance à Supabase → atténuée : Supabase = PostgreSQL standard, portable vers un autre hébergeur si nécessaire.

**Coûts** : gratuit en MVP, quelques dizaines de $/mois en croissance modérée, coûts prévisibles et proportionnels à l'usage ensuite.

**Complexité** : modérée, supérieure à WordPress au démarrage mais très inférieure à un WordPress "sur-mesure" qui devrait de toute façon reconstruire une couche relationnelle.

**Alternative retenue comme plan B** : Laravel (PHP). Bon choix si l'équipe technique future est orientée PHP. Non retenu comme choix principal car moins optimisé pour le SEO natif et l'évolution vers l'IA sans services tiers additionnels.

**Alternative écartée** : WordPress — adapté à un site vitrine ou un blog, pas à un moteur de correspondance B2B avec filtres croisés et matching à grande échelle.

### Hébergement des données — DÉCISION (2026-09-19)

**Région retenue : Supabase — Canada Central (`ca-central-1`).**

Raison : cohérence géographique avec la priorité Québec du lancement, tout en restant à une latence raisonnable pour la France.

**Important — la localisation ne suffit pas à garantir la conformité.** Héberger à `ca-central-1` aide pour la Loi 25 (données hébergées en sol canadien) mais ne dispense pas :

- des obligations RGPD pour toute personne ou entreprise européenne utilisant le service (le RGPD s'applique en fonction de la localisation des personnes concernées, pas de celle des serveurs) ;
- des obligations de la Loi 25 sur le consentement, les droits des personnes et l'évaluation des facteurs relatifs à la vie privée ;
- de la documentation des transferts internationaux de données (les données d'un utilisateur français transitent vers un serveur canadien : ce transfert doit être documenté et couvert par une base légale, ex. clauses contractuelles types).

L'architecture de conformité correspondante est détaillée en **§9.1**.

---

## 3. Modèle fonctionnel

### Parcours utilisateurs

**Visiteur**
Accueil → Recherche / Annuaire → Filtres → Fiche entreprise (infos publiques) → Mur d'inscription pour contact/réponse.

**Entreprise**
Inscription → Créer ou revendiquer une entreprise → Compléter le profil → Déclarer "Nous recherchons" et "Nous proposons" → Voir les correspondances suggérées → Publier une opportunité → Répondre aux opportunités → Demander une mise en relation → Suivre notifications/statuts.

**Administrateur**
Connexion → Tableau de bord statistique → Modération (vérifications, signalements) → Entreprises (CRUD, suspension, fusion de doublons) → Taxonomies (secteurs/produits) → Abonnements → Imports de données.

---

## 4. Modèle de données relationnel

Principe directeur : **pas de gros champs JSON** pour les données structurées et filtrables (secteurs, langues, marchés, certifications, produits). Ces données passent par de vraies tables relationnelles et des tables de jointure, pour garantir des filtres rapides et fiables à grande échelle (100 000+ entreprises).

**Principe de séparation des données personnelles** : les données à caractère personnel (nom d'une personne, courriel de connexion) ne vivent que dans `users` et les tables de confidentialité (§4.10). Toutes les autres tables ne portent que des données professionnelles/d'entreprise (courriel professionnel générique, téléphone de l'entreprise, adresse commerciale) — cette séparation est ce qui permettra plus tard de répondre facilement à une demande d'accès/suppression sans devoir fouiller tout le schéma.

### 4.1 Utilisateurs

**users**

- id, email, password (géré par Supabase Auth), full_name, role (`user` / `admin`), preferred_language (`fr`/`en`), created_at, last_login_at

### 4.2 Entreprises

**companies**

- id, legal_name, display_name, slug, description_fr, description_en
- country, province_region, city, postal_code, address, latitude, longitude
- website, professional_email, phone, logo_url
- employee_range, revenue_range
- verification_status (`unverified`/`pending`/`verified`)
- subscription_level (`free`/`premium`/`business`)
- profile_completion_score (0-100, calculé)
- embedding (vector, réservé — non utilisé en MVP, prépare le matching IA)
- is_active, created_at, updated_at

**company_members** _(✅ promu au socle MVP — corrige la version précédente)_

- id, company_id (FK), user_id (FK), role (`owner`/`editor`), created_at
- Une entreprise peut avoir plusieurs membres dès le lancement ; l'ancien champ unique `companies.owner_user_id` est abandonné au profit de cette table, pour éviter une migration lourde le jour où une entreprise veut ajouter un deuxième utilisateur (ex. un collègue export). Contrainte : au moins un membre `owner` par entreprise.

**company_locations**

- id, company_id, country, province_region, city, postal_code, address, latitude, longitude, is_headquarters

### 4.3 Classification (taxonomies)

**industries** : id, name_fr, name_en, slug
**subindustries** : id, industry_id (FK), name_fr, name_en, slug
**products_services** : id, subindustry_id (FK), name_fr, name_en, slug, type (`product`/`service`)

**Jointures**

- company_industries (company_id, industry_id)
- company_products_services (company_id, product_service_id)
- company_languages (company_id, language_code)
- company_certifications (id, company_id, name, issuing_body, valid_until)
- company_markets (id, company_id, country/region, market_type: `current`/`target`)
- `companies.export_experience` (booléen simple pour le MVP)

### 4.4 Besoins / offres

**company_needs** ("Nous recherchons")

- id, company_id, need_type (`distributeur`, `fournisseur`, `fabricant`, `sous_traitant`, `importateur`, `exportateur`, `agent_commercial`, `partenaire_technologique`, `partenaire_industriel`, `investisseur`, `partenaire_commercial`), description, target_country, target_region, created_at

**company_offers** ("Nous proposons")

- id, company_id, offer_type (`fabrication`, `distribution`, `sous_traitance`, `produits`, `services`, `technologie`, `importation`, `exportation`, `representation_commerciale`, `capacites_industrielles`), description, created_at

### 4.5 Opportunités

**opportunities**

- id, company_id, title, description, opportunity_type, industry_id, origin_country, target_country, target_region
- estimated_value, currency, deadline
- status (`draft`/`published`/`closed`/`expired`)
- visibility (`public`/`premium_only`), premium_status (`none`/`sponsored`)
- embedding (vector, réservé — matching IA future)
- created_at, expires_at

**opportunity_products_services** (jointure opportunity_id, product_service_id)
**opportunity_responses** : id, opportunity_id, responding_company_id, message, status (`pending`/`accepted`/`declined`), created_at

### 4.6 Correspondances & mise en relation

**matches** (entreprise ↔ entreprise)

- id, company_a_id, company_b_id, score (0-100), status (`suggested`/`viewed`/`dismissed`/`contacted`), created_at, recalculated_at

**match_score_details**

- id, match_id, criterion (ex: `need_offer_fit`, `sector`, `geography`, ...), points_awarded, points_possible

**opportunity_matches** _(✅ ajouté — corrige la version précédente)_ (opportunité ↔ entreprise candidate)

- id, opportunity_id (FK), candidate_company_id (FK), score (0-100), status (`suggested`/`viewed`/`dismissed`/`responded`), created_at, recalculated_at

**opportunity_match_score_details**

- id, opportunity_match_id, criterion, points_awarded, points_possible

**partnership_requests**

- id, requester_company_id, target_company_id, message, status (`pending`/`accepted`/`declined`), created_at

### 4.7 Commercial

**subscriptions**

- id, company_id, plan (`free`/`premium`/`business`), billing_cycle (`monthly`/`annual`), status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at

### 4.8 Confiance & provenance des données

**company_verifications**

- id, company_id, method (`domain_email`/`document`/`manual`), submitted_by_user_id, evidence, status (`pending`/`approved`/`rejected`), reviewed_by_admin_id, reviewed_at, created_at

**claim_requests**

- id, company_id, user_id, professional_email, verification_method, status, created_at, reviewed_by

**data_sources**

- id, source_name, source_url, source_license, source_date, import_date, last_verified_at, imported_record_count

**company_data_sources**

- company_id, data_source_id (traçabilité — une entreprise peut avoir plusieurs provenances après fusion de doublons)

### 4.9 Support

**notifications** : id, user_id, type, payload_summary, read_at, created_at
**favorites** : id, user_id, company_id (nullable), opportunity_id (nullable), created_at
**audit_logs** : id, actor_user_id, action, entity_type, entity_id, before_summary, after_summary, created_at

### 4.10 Confidentialité _(✅ ajouté suite à la décision du 2026-09-19)_

**user_consents**

- id, user_id, consent_type (ex. `terms_of_service`, `marketing_email`, `cookies_analytics`), granted (booléen), granted_at, revoked_at, policy_version
- Sert à prouver qu'un consentement a bien été donné, à quelle version de la politique, et à le retirer sans perdre l'historique.

**data_subject_requests**

- id, user_id, request_type (`access`/`rectification`/`deletion`/`export`), status (`pending`/`in_progress`/`completed`/`rejected`), requested_at, completed_at, notes
- Donne une trace administrable des demandes RGPD/Loi 25 (droit d'accès, de rectification, de suppression, d'export), gérable depuis le back-office admin.

---

## 5. Rôles & permissions

- **Visiteur** : lecture publique uniquement.
- **Utilisateur Free** : compte, création/revendication d'une entreprise, profil et opportunités avec limites.
- **Premium** : visibilité accrue, plus de réponses aux opportunités, badge de confiance.
- **Business** : opportunités/entreprise sponsorisées, accès élargi aux correspondances.
- **Admin** : accès total au back-office.

Sécurité appliquée au niveau base de données (Row Level Security Supabase) en complément des contrôles applicatifs : une entreprise ne peut être modifiée que par ses membres (`company_members`) ; un utilisateur ne voit que ses propres notifications/favoris/consentements.

---

## 6. Arborescence du site

```
/                                    accueil
/entreprises
/entreprises/france
/entreprises/quebec
/entreprises/france/agroalimentaire
/entreprises/quebec/distributeurs
/entreprise/[slug]
/opportunites
/opportunites/france-quebec
/opportunites/[slug]
/secteurs/[secteur]
/compte, /connexion, /inscription
/admin/...                           protégé, non indexé
```

Indexation conditionnelle : une page de liste filtrée n'est indexable que si elle contient un nombre suffisant d'entreprises/opportunités (seuil à définir, ex. ≥ 5).

---

## 7. Moteur de matching (MVP)

Scoring déterministe 0-100, recalculé lors des changements pertinents (profil, besoin, offre) :

| Critère                    | Points  |
| -------------------------- | ------- |
| Compatibilité besoin/offre | 30      |
| Secteur / produit          | 20      |
| Géographie / marché        | 15      |
| Capacité recherchée        | 10      |
| Taille                     | 5       |
| Certifications             | 5       |
| Langues                    | 5       |
| Expérience export          | 5       |
| Entreprise vérifiée        | 5       |
| **Total**                  | **100** |

Le même barème s'applique à deux relations distinctes, stockées séparément (§4.6) :

- **entreprise ↔ entreprise** (`matches`) — pour suggérer des partenaires généraux ;
- **opportunité ↔ entreprise** (`opportunity_matches`) — pour suggérer les entreprises les plus pertinentes face à une opportunité publiée.

Le détail du score est conservé (`match_score_details` / `opportunity_match_score_details`) pour rester explicable.

**Évolution prévue (post-MVP)** : recherche sémantique / embeddings via `pgvector` (colonne `embedding` déjà prévue sur `companies` et `opportunities`), matching hybride (score déterministe + similarité sémantique).

---

## 8. Administration

Back-office `/admin`, protégé par rôle :

- Entreprises : CRUD, suspension, fusion de doublons (avec redirection de slug et migration des données liées)
- Vérification des revendications (`claim_requests` / `company_verifications`)
- Opportunités et signalements
- Taxonomies (secteurs, sous-secteurs, produits/services)
- Abonnements (vue sur statut Stripe une fois intégré)
- Imports de données (aperçu, détection de doublons, validation manuelle)
- Demandes RGPD/Loi 25 (`data_subject_requests`) — suivi et traitement
- Statistiques (croissance, répartition par secteur/pays, etc.)

Construit comme un ensemble de pages simples (tableaux + formulaires), pas un framework d'admin lourd.

---

## 9. Sécurité

- Authentification via Supabase Auth (mot de passe hashé, lien magique ; 2FA envisageable plus tard)
- Row Level Security sur toutes les tables sensibles
- Validation stricte des entrées (formulaires + imports) via schémas de validation (Zod)
- Limitation de fréquence sur les formulaires publics (anti-abus)
- Journal d'audit sur les actions admin sensibles
- Téléversements (logos) : validation type/taille, stockage isolé, pas d'exécution possible
- Clé Supabase "secrète" (accès complet, ex. `SUPABASE_SECRET_KEY`) utilisée uniquement côté serveur, jamais exposée au navigateur

### 9.1 Confidentialité et conformité (RGPD / Loi 25) _(✅ section ajoutée le 2026-09-19)_

> Ceci est une documentation **technique** de l'architecture de confidentialité, pas un avis juridique. Une validation par un professionnel du droit reste nécessaire avant la mise en production, notamment pour la rédaction finale de la politique de confidentialité et l'analyse d'impact éventuelle.

Principes intégrés dès l'architecture :

- **Minimisation des données personnelles** : on ne collecte que ce qui est nécessaire (courriel + nom pour le compte). Toute autre donnée demandée (secteur, produits, etc.) est une donnée d'entreprise, pas une donnée personnelle.
- **Séparation entreprise / personnel** : voir principe en tête de §4. `users` (personnel) est distinct de `companies` (professionnel) ; un même formulaire ne doit jamais mélanger les deux dans un seul champ libre.
- **Consentements et préférences** : table `user_consents` (§4.10) — chaque consentement (conditions d'utilisation, courriels marketing, cookies analytiques) est daté et versionné, et peut être retiré.
- **Droit d'accès, de rectification, de suppression, d'export** : table `data_subject_requests` (§4.10) + procédure admin dédiée. Objectif MVP : un administrateur peut traiter manuellement une demande ; l'automatisation complète (self-service) est un objectif post-MVP.
- **Journalisation des actions importantes** : `audit_logs` couvre les actions admin sensibles (modification/suppression de compte, fusion d'entreprises, changement de statut de vérification).
- **Conservation limitée** : chaque table de données personnelles doit avoir une durée de conservation documentée dans `docs/PRIVACY.md` (ex. compte inactif supprimé après X années — durée exacte à définir avec le propriétaire avant la mise en production).
- **Politique de confidentialité** : un document public sera rédigé avant le lancement ; `docs/PRIVACY.md` sert de brouillon technique interne, pas de version publiée.
- **Gestion des cookies** : un bandeau de consentement sera ajouté avant tout cookie non essentiel (analytique, marketing) ; les cookies strictement nécessaires (session d'authentification) ne demandent pas de consentement.
- **Traçabilité de l'origine des données** : déjà couverte par `data_sources` / `company_data_sources` (§4.8) — s'applique aussi aux données personnelles importées, le cas échéant.
- **Sous-traitants (« subprocessors »)** : à documenter dans `docs/PRIVACY.md` — au minimum Supabase (hébergement/base de données, `ca-central-1`), l'hébergeur de l'application (à déterminer, ex. Vercel), et le futur fournisseur d'emails transactionnels. Chaque nouveau sous-traitant introduit doit être ajouté à cette liste.
- **Transferts internationaux** : toute donnée d'un utilisateur ou d'une entreprise européenne traitée sur un serveur canadien constitue un transfert international au sens du RGPD. À documenter formellement (base légale du transfert) avant le lancement commercial en France — point à traiter avec un conseil juridique.

---

## 10. SEO

Rendu serveur natif (Next.js App Router, SSR/ISR selon les pages), métadonnées dynamiques par page, `sitemap.xml` généré automatiquement, `robots.txt`, données structurées `schema.org` (type Organization pour les fiches entreprises), fil d'Ariane balisé, URLs propres et bilingues, indexation conditionnelle des pages à faible contenu.

---

## 11. Architecture bilingue FR/EN

URLs préfixées par langue (`/fr/...`, `/en/...`) pour un balisage `hreflang` propre. Interface traduite via fichiers de traduction (`next-intl`). Contenus saisis par les entreprises conservés dans leur langue d'origine en MVP (pas de traduction automatique).

**Limite connue et anticipée** : les taxonomies (`industries`, `subindustries`, `products_services`) utilisent des colonnes dédiées `name_fr`/`name_en` plutôt qu'une table de traduction générique. C'est le choix le plus simple et le plus rapide à interroger pour **exactement deux langues**. Si une troisième langue est ajoutée un jour, la migration recommandée est de basculer vers une table `translations` générique (`entity_type`, `entity_id`, `locale`, `field`, `value`) — un chantier isolé, sans impact sur le reste du modèle. On ne construit pas cette table dès maintenant pour ne pas complexifier le MVP pour un besoin hypothétique.

---

## 12. Stratégie d'importation des données

- Sources autorisées : saisie directe, CSV/Excel, API et Open Data sous licence compatible, partenaires.
- **Aucun scraper** contournant les conditions d'utilisation d'un site n'est développé.
- Chaque enregistrement importé conserve : `source_name`, `source_url`, `source_license`, `source_date`, `import_date`, `last_verified_at`.
- Détection de doublons par rapprochement (nom légal normalisé + pays + code postal, ou domaine du site web) ; la fusion reste **une action manuelle validée par un administrateur**, jamais automatique.

---

## 13. Organisation du dépôt Git

Un seul dépôt :

```
/src
  /app          pages Next.js (routage par langue et section)
  /components   composants d'interface réutilisables
  /lib          logique métier (matching, accès Supabase, utilitaires)
  /validations  schémas de validation (Zod)
  /i18n         configuration next-intl
  /types        types partagés (dont les types générés depuis Supabase)
/messages       traductions FR/EN
/supabase       migrations SQL, politiques de sécurité (RLS) — à partir de la Phase 2
/tests          tests automatisés
/docs           documentation fonctionnelle et technique
README.md
CHANGELOG.md
PROJECT_SPEC.md
```

---

## 14. Dépendances envisagées

**MVP** : next, react, typescript, tailwindcss, @supabase/supabase-js, @supabase/ssr, next-intl, zod, prettier, vitest. `react-hook-form` et `@hookform/resolvers` seront ajoutés à la Phase 3 quand les premiers vrais formulaires (compte, entreprise) seront construits — inutile de les installer avant.

**Post-MVP** : stripe, service d'email transactionnel (ex. Resend), pgvector/embeddings, éventuel service de traduction automatique.

---

## 15. Périmètre MVP vs post-MVP

**MVP** (les 17 fonctions du cahier des charges) : consultation, recherche, filtres, fiche entreprise, compte, création/revendication d'entreprise, profil, "Nous recherchons"/"Nous proposons", opportunités + réponses, matching déterministe (entreprise↔entreprise et opportunité↔entreprise), mise en relation, structure Free/Premium/Business (sans facturation réelle), administration de base, gestion de base des demandes RGPD/Loi 25.

**Post-MVP** : intégration Stripe et facturation réelle, restrictions commerciales strictes par palier, entreprises/opportunités sponsorisées, génération de leads, services Concierge, matching par IA (embeddings/recherche sémantique), self-service complet des demandes RGPD (aujourd'hui : traitement manuel par un admin), connexion sociale (Google/LinkedIn), extension à d'autres provinces canadiennes, langues supplémentaires (avec migration vers table `translations`, voir §11).

---

## 16. Ordre de développement

1. Initialisation du projet (Next.js, Supabase, Tailwind, structure de dépôt) — **en cours**
2. Modèle de données central (tables + Row Level Security)
3. Comptes utilisateurs + création/édition d'entreprise (y compris `company_members`)
4. Annuaire public + recherche + filtres + fiche entreprise + SEO de base
5. "Nous recherchons" / "Nous proposons" + opportunités + réponses
6. Moteur de matching déterministe (entreprise↔entreprise, puis opportunité↔entreprise)
7. Revendication d'entreprise + vérification
8. Demandes de mise en relation + notifications
9. Back-office admin (incluant le traitement des demandes RGPD/Loi 25)
10. Import de données
11. Structure des abonnements, puis intégration Stripe
12. SEO avancé + durcissement sécurité + performance
13. Lancement bêta France-Québec

---

## 17. Journal des décisions

| Date       | Décision                                                                           | Raison                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-19 | Stack retenue : Next.js + TypeScript + PostgreSQL/Supabase + Tailwind              | Voir §2                                                                                                                          |
| 2026-09-19 | Matching MVP = scoring déterministe, pas d'IA                                      | Explicabilité, coût, rapidité de mise en œuvre ; architecture préparée pour l'IA plus tard                                       |
| 2026-09-19 | Pas de scraping de sites tiers                                                     | Respect des conditions d'utilisation, risque légal                                                                               |
| 2026-09-19 | Région Supabase : `ca-central-1` (Canada Central)                                  | Priorité Québec, latence raisonnable pour la France ; ne dispense pas des obligations RGPD/Loi 25 (voir §9.1)                    |
| 2026-09-19 | `company_members` remplace `owner_user_id` comme mécanisme central de rattachement | Support natif de plusieurs utilisateurs par entreprise dès le MVP, sans migration future                                         |
| 2026-09-19 | Ajout de `opportunity_matches` distinct de `matches`                               | Le matching opportunité↔entreprise est une relation différente du matching entreprise↔entreprise et doit être stockée séparément |
| 2026-09-19 | Ajout de `user_consents` et `data_subject_requests`                                | Support minimal RGPD/Loi 25 dès l'architecture (consentement, droits des personnes)                                              |

---

_Prochaine révision prévue : à la fin de la Phase 2 (modèle de données), une fois les migrations SQL écrites._
