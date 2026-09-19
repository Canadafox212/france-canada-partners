# PROJECT_SPEC.md — France-Canada Partners

> Document de référence permanent du projet. Toute décision structurante importante doit être reflétée ici avant/pendant son implémentation. Ce document est mis à jour au fil des phases, pas figé.

**Statut** : Phase 6 — moteur de matching déterministe (entreprise↔entreprise et opportunité↔entreprise), testé en conditions réelles.
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

**Principe de séparation des données personnelles** : les données à caractère personnel (nom d'une personne, courriel de connexion) ne vivent que dans `profiles`/`auth.users` et les tables de confidentialité (§4.10). Toutes les autres tables ne portent que des données professionnelles/d'entreprise (courriel professionnel générique, téléphone de l'entreprise, adresse commerciale) — cette séparation est ce qui permettra plus tard de répondre facilement à une demande d'accès/suppression sans devoir fouiller tout le schéma.

### 4.1 Identité utilisateur _(✅ revu en Phase 2)_

Supabase fournit déjà `auth.users` pour l'authentification (email, mot de passe, état de connexion) : **ce n'est pas dupliqué**. Une table applicative distincte porte uniquement les données propres au produit, en relation 1:1 stricte avec `auth.users` (`profiles.id = auth.users.id`, création automatique par déclencheur à l'inscription).

**profiles**

- id (PK, FK → `auth.users.id`), full_name, preferred_language (`fr`/`en` — langue de l'**interface** pour cette personne), platform_role (`user`/`admin` — rôle **sur la plateforme**, distinct du rôle dans une entreprise, voir §4.2), created_at, updated_at

### 4.2 Entreprises _(✅ champs revus en Phase 2)_

**companies** — une entreprise est indépendante de l'utilisateur qui l'a créée ; elle peut exister avant d'être revendiquée.

- id, legal_name, display_name, slug
- website, professional_email, phone, company_registration_number (format libre : SIREN en France, NEQ au Québec, etc.)
- country_code (pays "principal", pour un filtre rapide sans jointure — l'adresse complète et les établissements multiples vivent dans `company_locations`)
- employee_range, revenue_range, export_experience (booléen)
- verification_status (`unverified`/`pending`/`verified`) — confiance
- subscription_level (`free`/`premium`/`business`) — offre commerciale
- profile_completion_score (0-100, calculé)
- status (`draft`/`active`/`suspended`/`archived`) — cycle de vie/visibilité, distinct des deux précédents
- embedding (vector, réservé — non utilisé en MVP, prépare le matching IA)
- created_at, updated_at

**company_locations** — une entreprise peut avoir plusieurs établissements.

- id, company_id (FK), location_type (`headquarters`/`office`/`factory`/`warehouse`/`branch`/`other`), address_line_1, address_line_2, city, postal_code, region, country_code, latitude, longitude, is_primary, created_at
- Un seul établissement `is_primary` par entreprise (contrainte d'unicité).

**company_members** _(✅ rôles précisés en Phase 2)_

- id, company_id (FK), user_id (FK → `profiles.id`), role (`owner`/`admin`/`member`/`viewer` — rôle **dans cette entreprise**), status (`invited`/`active`/`removed`), invited_at, joined_at, created_at
- Une entreprise peut avoir plusieurs membres ; un même utilisateur peut appartenir à plusieurs entreprises. Rattachement automatique : le créateur d'une entreprise en devient `owner` immédiatement (déclencheur). Ce rôle ne doit jamais être confondu avec `profiles.platform_role` (administration globale de la plateforme).

**company_translations** _(✅ ajouté en Phase 3 — remplace `companies.description`)_

- id, company_id (FK), locale (`fr`/`en`), description, tagline, created_at, updated_at, unique (company_id, locale)
- Une entreprise n'est pas obligée de fournir sa description dans les deux langues ; le repli vers la langue disponible se fait côté application (`src/lib/companies.ts`), pas en base. Ce choix (table dédiée plutôt que `description_fr`/`description_en` sur `companies`) reste cohérent avec la limite déjà documentée en §11.

### 4.3 Classification (taxonomies) _(✅ précisée en Phase 2)_

**industries** : id, name_fr, name_en, slug
**subindustries** : id, industry_id (FK), name_fr, name_en, slug
**products_services** : id, type (`product`/`service`), subindustry_id (FK, nullable), label_fr, label_en, slug, category (texte libre optionnel)

**Jointures**

- company_industries (company_id, industry_id, is_primary) — plusieurs secteurs par entreprise, un seul marqué secteur principal (contrainte d'unicité)
- company_subindustries (company_id, subindustry_id)
- company_products_services (company_id, product_service_id, description) — `description` est un texte libre complémentaire propre à l'entreprise, en plus du libellé standardisé
- company_languages (company_id, language_code) — langues **commerciales** de l'entreprise, à ne pas confondre avec `profiles.preferred_language`
- company_certifications (id, company_id, certification_id, issuer, reference, valid_from, valid_until, verification_status)
- company_markets (id, company_id, market_type `current`/`target`, country_code, region, city)

**Nomenclatures officielles (NAF/APE, NAICS/SCIAN...)** : volontairement non liées à l'application dès maintenant, pour ne pas dépendre d'une nomenclature propriétaire. Si le besoin de correspondance se confirme, une table de correspondance (ex. `industry_code_mappings` : industry_id, code_system, code) sera ajoutée à ce moment-là, sans impact sur le reste du modèle.

### 4.4 Besoins / offres _(✅ enrichi en Phase 4 — cœur du futur matching)_

> **OFFRE vs BESOIN vs OPPORTUNITÉ** — distinction importante pour la Phase 5 :
> une **OFFRE** ("Nous proposons") ou un **BESOIN** ("Nous recherchons") appartient au **profil durable** de l'entreprise : pas de date d'expiration, ça décrit ce que l'entreprise est capable de fournir ou cherche en continu. Une **OPPORTUNITÉ** (Phase 5, pas encore construite) sera une **publication ponctuelle**, avec une durée de vie, destinée à recevoir des réponses — ex. « recherche un distributeur pour un lancement produit avant fin mars ». Le moteur de matching (Phase 6) rapprochera des OFFRES/BESOINS durables ET, plus tard, des OPPORTUNITÉS ponctuelles.

Les catégories d'offre/besoin ne sont **pas** codées en dur (elles doivent pouvoir évoluer depuis l'administration sans migration de schéma) :

**business_capability_types** : code (PK, ex. `DISTRIBUTOR`), label_fr, label_en, applies_to_offers (booléen), applies_to_needs (booléen), is_active
Valeurs : DISTRIBUTOR, SUPPLIER, MANUFACTURER, SUBCONTRACTOR, IMPORTER, EXPORTER, SALES_AGENT, COMMERCIAL_PARTNER, TECHNOLOGY_PARTNER, INDUSTRIAL_PARTNER, INVESTOR, JOINT_VENTURE, SERVICES, MANUFACTURING_CAPACITY, DISTRIBUTION_CAPACITY, LICENSING, FRANCHISING, OTHER _(3 dernières ajoutées en Phase 4)_.

**company_offers** ("Nous proposons") : id, company_id, capability_type_code (FK), title (composé automatiquement, voir `src/lib/offersNeeds.ts`), description, industry_id (FK, optionnel), target_country_code, target_region, status (`active`/`inactive`), created_at, updated_at
**company_needs** ("Nous recherchons") : mêmes champs, plus sought_employee_range (texte libre, optionnel — taille de partenaire recherchée)

**Jointures** _(✅ ajoutées en Phase 4)_ : `company_offer_products_services`/`company_need_products_services` (produits/services concernés — s'ajoute à la description libre, ne la remplace pas), `company_offer_languages`/`company_need_languages` (langues souhaitées pour cette offre/ce besoin précis, distinctes des langues générales de l'entreprise dans `company_languages`).

`target_country_code`/`target_region` décrivent la zone visée par **cette offre/besoin précis** — distincte des marchés généraux de l'entreprise (`company_markets`) et de sa localisation physique (`company_locations`). Une offre/besoin visant plusieurs marchés se traduit par plusieurs lignes, pas par une liste dans une seule ligne (simplicité voulue pour le MVP).

Sécurité : mêmes politiques que le reste du profil d'entreprise (owner/admin/member peuvent gérer, viewer en lecture seule, tout le monde en lecture si l'entreprise est active) — voir §9. Les champs contrôlés par la plateforme (`subscription_level`, `verification_status`, `platform_role`) restent hors de portée des offres/besoins, aucune nouvelle voie de contournement n'a été introduite.

### 4.5 Opportunités _(✅ construite en Phase 5)_

**opportunities** — intention ponctuelle, avec échéance (voir encadré §4.4).

- id, company_id, slug (généré automatiquement à partir du titre), title (composé automatiquement, comme pour les offres/besoins), description
- capability_type_code (FK → `business_capability_types`, **réutilisé** plutôt qu'un nouveau vocabulaire), direction (`seeking`/`offering` — combiné au code pour couvrir "Recherche X" et "Proposition de X")
- industry_id (FK, optionnel)
- origin_country_code, target_country_code, target_region, language_code (langue de publication — une opportunité peut être publiée dans une seule langue)
- estimated_value, currency_code, deadline (tous facultatifs — une PME peut publier en quelques minutes)
- published_at, expires_at (calculés automatiquement à la publication : 90 jours par défaut si aucune `deadline`)
- status (`draft`/`published`/`paused`/`closed`/`expired`/`archived`), visibility (`public`/`private`, réservé)
- created_at, updated_at

**opportunity_products_services** (jointure opportunity_id, product_service_id) — même principe que pour les offres/besoins.

**opportunity_responses** — réponse d'une entreprise à l'opportunité d'une autre. **Jamais publique.**

- id, opportunity_id, responding_company_id, responding_user_id (la personne répond **au nom d'une entreprise**, jamais en son nom propre), message, status (`declared_interest`/`under_review`/`accepted`/`declined`/`withdrawn`), created_at, updated_at
- Contrainte unique (opportunity_id, responding_company_id) : une seule réponse par entreprise et par opportunité pour le MVP (modifiable/retirable, jamais recréée).
- Auto-réponse interdite par déclencheur (une entreprise ne peut pas répondre à sa propre opportunité). Qui peut changer quoi est également imposé par déclencheur : l'entreprise répondante peut modifier son message et retirer sa réponse ; seule l'entreprise ayant publié peut faire progresser le statut (mise en examen/acceptation/refus).

**notifications** _(✅ avancée de la Phase 8 à la Phase 5, comme `audit_logs`/`company_translations` l'ont été en Phase 3)_ : id, user_id, type, payload (jsonb), read_at, created_at. Écriture réservée à `create_notification()` (SECURITY DEFINER) — jamais d'insertion directe par un client.

### 4.6 Correspondances & mise en relation _(✅ construite en Phase 6 — voir docs/MATCHING.md)_

**matches** (entreprise ↔ entreprise — compare le BESOIN d'une entreprise à l'OFFRE d'une autre, jamais besoin↔besoin ni offre↔offre)

- id, company_id (côté besoin), need_id (FK), candidate_company_id (côté offre), offer_id (FK), score (0-100), confidence (0-100), score_breakdown (jsonb — détail par critère), algorithm_version, calculated_at, status (`suggested`/`viewed`/`dismissed`/`contacted`), feedback (nullable, préparé pour un futur retour utilisateur, jamais utilisé pour ajuster l'algorithme automatiquement)
- **Différence avec la version envisagée en Phase 0** : pas de table `match_score_details` séparée — le détail vit dans `score_breakdown` (jsonb), assumé comme exception au principe "pas de gros JSON" car c'est un artefact d'explication propre à un match, pas une donnée métier filtrée/agrégée. Écriture réservée à la clé secrète (aucune politique RLS d'insertion/modification pour un client normal) — voir docs/SECURITY.md.

**opportunity_matches** (opportunité ↔ entreprise candidate — direction `seeking` comparée aux offres, `offering` comparée aux besoins)

- id, opportunity_id (FK), candidate_company_id (FK), candidate_offer_id (FK, nullable), candidate_need_id (FK, nullable — exactement un des deux renseigné selon la direction), score, confidence, score_breakdown, algorithm_version, calculated_at, status, feedback

**partnership_requests** _(pas encore construite — reportée, la mise en relation directe passe pour l'instant par les réponses aux opportunités, §4.5)_

### 4.7 Commercial

**subscriptions**

- id, company_id, plan (`free`/`premium`/`business`), billing_cycle (`monthly`/`annual`), status, stripe_customer_id, stripe_subscription_id, current_period_end, created_at

### 4.8 Confiance & provenance des données

**company_verifications**

- id, company_id, method (`domain_email`/`document`/`manual`), submitted_by_user_id (FK → `profiles.id`), evidence, status (`pending`/`approved`/`rejected`), reviewed_by_admin_id (FK → `profiles.id`), reviewed_at, created_at

**claim_requests**

- id, company_id, user_id (FK → `profiles.id`), professional_email, verification_method, status, created_at, reviewed_by

**data_sources** _(✅ enrichi en Phase 2)_

- id, name (ex. "SIRENE", "INPI", "Corporations Canada", "Inscription directe"), url, source_type (`open_data`/`registry`/`partner`/`manual_entry`/`admin_import`), license_name, license_url, created_at

**company_source_records** _(✅ renommé et enrichi en Phase 2 — remplace `company_data_sources`)_

- id, company_id (FK), data_source_id (FK), source_record_id (identifiant de l'entreprise **dans** la source, ex. un SIREN), source_date, imported_at, last_verified_at, raw_reference (pointeur libre vers la donnée brute, texte simple — pas de JSON), status (`active`/`superseded`/`disputed`), created_at
- Une entreprise peut avoir plusieurs sources (notamment après fusion de doublons).

### 4.9 Support

**notifications** : id, user_id (FK → `profiles.id`), type, payload_summary, read_at, created_at
**favorites** : id, user_id (FK → `profiles.id`), company_id (nullable), opportunity_id (nullable), created_at
**audit_logs** : id, actor_user_id (FK → `profiles.id`), action, entity_type, entity_id, before_summary, after_summary, created_at

### 4.10 Confidentialité _(✅ ajouté suite à la décision du 2026-09-19)_

**user_consents**

- id, user_id (FK → `profiles.id`), consent_type (ex. `terms_of_service`, `marketing_email`, `cookies_analytics`), granted (booléen), granted_at, revoked_at, policy_version
- Sert à prouver qu'un consentement a bien été donné, à quelle version de la politique, et à le retirer sans perdre l'historique.

**data_subject_requests**

- id, user_id (FK → `profiles.id`), request_type (`access`/`rectification`/`deletion`/`export`), status (`pending`/`in_progress`/`completed`/`rejected`), requested_at, completed_at, notes
- Donne une trace administrable des demandes RGPD/Loi 25 (droit d'accès, de rectification, de suppression, d'export), gérable depuis le back-office admin.

---

## 5. Rôles & permissions

Deux échelles de rôle, bien distinctes (voir §4.1 et §4.2) :

- **Rôle sur la plateforme** (`profiles.platform_role`) : `user` (par défaut) ou `admin` (accès total au back-office).
- **Rôle dans une entreprise** (`company_members.role`) : `owner`, `admin`, `member`, `viewer` — s'applique uniquement à la gestion de cette entreprise précise, sans rapport avec l'administration de la plateforme.

Paliers commerciaux (`companies.subscription_level`), orthogonaux aux deux rôles ci-dessus :

- **Free** : profil et opportunités avec limites.
- **Premium** : visibilité accrue, plus de réponses aux opportunités, badge de confiance.
- **Business** : opportunités/entreprise sponsorisées, accès élargi aux correspondances.

Sécurité appliquée au niveau base de données (Row Level Security Supabase) en complément des contrôles applicatifs, écrite en même temps que chaque table plutôt qu'après coup : une entreprise ne peut être modifiée que par ses membres habilités (`company_members`) ou un administrateur de la plateforme ; un utilisateur ne voit que ses propres notifications/favoris/consentements.

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

## 7. Moteur de matching (MVP) _(✅ construit en Phase 6 — voir docs/MATCHING.md pour l'architecture complète)_

Scoring déterministe 0-100, recalculé **à la lecture** (appelé depuis les pages concernées plutôt que par déclencheur sur chaque écriture, choix documenté §23/§11 de docs/MATCHING.md) :

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

Le détail du score est conservé dans `score_breakdown` (voir §4.6) pour rester explicable — affiché à l'utilisateur sous "Pourquoi ce score ?", jamais généré par une IA. Une incompatibilité fondamentale de type (aucune ligne dans `capability_compatibility`) **élimine** le candidat entièrement plutôt que de produire un score de 0. Seuil d'affichage : 60/100 (les scores plus bas restent calculés et persistés pour analyse interne, jamais supprimés). Vocabulaire imposé : "Score de compatibilité", jamais "Probabilité de réussite".

**Évolution prévue (post-MVP)** : recherche sémantique / embeddings via `pgvector` (colonne `embedding` déjà présente sur `companies` depuis la Phase 2, inutilisée pour l'instant), matching hybride (score déterministe + similarité sémantique) via un futur critère `SEMANTIC_SIMILARITY` sans casser l'architecture actuelle.

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

1. Initialisation du projet (Next.js, Supabase, Tailwind, structure de dépôt) — **fait**
2. Modèle de données central (identité, entreprises, membres, établissements, taxonomie, produits, offres/besoins, marchés, langues, certifications, sources) — **fait**, RLS écrite avec chaque table.
3. Comptes utilisateurs + création/édition d'entreprise — **fait** : inscription, confirmation de courriel, connexion/déconnexion, mot de passe oublié/réinitialisation, profil, création d'entreprise (transactionnelle, `create_company()`), modification par owner/admin, liste des membres. `audit_logs` et `company_translations` ont été avancés depuis leur phase d'origine (9 et 2) car nécessaires dès maintenant. Sécurité testée en conditions réelles.
4. Offres et besoins structurés — **fait** : "Nous proposons"/"Nous recherchons" avec produits/services, secteur, géographie et langues rattachés, statut actif/inactif, journal d'audit. Jeu de données de démonstration (`npm run seed:demo`). Priorité métier explicite : le cœur du produit (offres/besoins/opportunités/matching) passe avant l'annuaire public.
5. Opportunités commerciales — **fait** : publication (brouillon/publiée/pause/clôture/archivage), réponses des entreprises (au nom d'une entreprise, jamais en son nom propre), auto-réponse interdite, confidentialité stricte des réponses, notifications internes, expiration administrable (90 jours par défaut), page publique + liste filtrée, pré-remplissage à partir d'un besoin/offre existant. `notifications` avancée depuis sa phase d'origine (9), comme `audit_logs`/`company_translations` l'ont été en Phase 3.
6. **Moteur de matching déterministe** (entreprise↔entreprise, puis opportunité↔entreprise) — prochaine phase proposée
7. Annuaire public + recherche + filtres + fiche entreprise + SEO de base (repoussé après le cœur métier, à la demande explicite du propriétaire du projet)
8. Revendication d'entreprise + vérification
9. Demandes de mise en relation + favoris
10. Back-office admin (incluant le traitement des demandes RGPD/Loi 25)
11. Import de données (pipeline réel, `data/raw/`)
12. Structure des abonnements, puis intégration Stripe
13. SEO avancé + durcissement sécurité + performance
14. Lancement bêta France-Québec

Tables encore à ajouter, avec leur propre phase : `claim_requests`/`company_verifications` (8), `favorites` (9), `subscriptions` (12), `user_consents`/`data_subject_requests` (au plus tard avant le lancement commercial).

---

## 17. Journal des décisions

| Date       | Décision                                                                                                                                                           | Raison                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-19 | Stack retenue : Next.js + TypeScript + PostgreSQL/Supabase + Tailwind                                                                                              | Voir §2                                                                                                                                                                                                                                  |
| 2026-09-19 | Matching MVP = scoring déterministe, pas d'IA                                                                                                                      | Explicabilité, coût, rapidité de mise en œuvre ; architecture préparée pour l'IA plus tard                                                                                                                                               |
| 2026-09-19 | Pas de scraping de sites tiers                                                                                                                                     | Respect des conditions d'utilisation, risque légal                                                                                                                                                                                       |
| 2026-09-19 | Région Supabase : `ca-central-1` (Canada Central)                                                                                                                  | Priorité Québec, latence raisonnable pour la France ; ne dispense pas des obligations RGPD/Loi 25 (voir §9.1)                                                                                                                            |
| 2026-09-19 | `company_members` remplace `owner_user_id` comme mécanisme central de rattachement                                                                                 | Support natif de plusieurs utilisateurs par entreprise dès le MVP, sans migration future                                                                                                                                                 |
| 2026-09-19 | Ajout de `opportunity_matches` distinct de `matches`                                                                                                               | Le matching opportunité↔entreprise est une relation différente du matching entreprise↔entreprise et doit être stockée séparément                                                                                                         |
| 2026-09-19 | Ajout de `user_consents` et `data_subject_requests`                                                                                                                | Support minimal RGPD/Loi 25 dès l'architecture (consentement, droits des personnes)                                                                                                                                                      |
| 2026-09-19 | `profiles` (liée 1:1 à `auth.users`) remplace la table `users` envisagée initialement                                                                              | Éviter de dupliquer l'identité de connexion déjà gérée par Supabase Auth ; ne conserver que les données applicatives                                                                                                                     |
| 2026-09-19 | Rôles `company_members` précisés : `owner`/`admin`/`member`/`viewer`, distincts de `profiles.platform_role`                                                        | Séparer clairement le rôle dans une entreprise du rôle sur la plateforme (demande explicite avant la Phase 2)                                                                                                                            |
| 2026-09-19 | `business_capability_types` remplace un enum figé pour les types d'offre/besoin                                                                                    | Permettre à un administrateur de faire évoluer ce vocabulaire sans migration de schéma                                                                                                                                                   |
| 2026-09-19 | `companies.description` unique (pas de `description_fr`/`description_en`) — **remplacé en Phase 3 par `company_translations`**                                     | Cohérent avec le principe déjà posé en §11 ; la table dédiée permet en plus qu'une entreprise ne renseigne qu'une seule langue, avec repli côté application                                                                              |
| 2026-09-19 | Adresses uniquement dans `company_locations` (plus de champs d'adresse sur `companies`)                                                                            | Une entreprise a par nature 0 à N établissements ; éviter de dupliquer l'adresse "principale" à deux endroits                                                                                                                            |
| 2026-09-19 | `data_sources`/`company_source_records` enrichis (type, licence, identifiant dans la source, statut)                                                               | Nécessaire pour tracer rigoureusement la provenance avant tout import réel (Phase 10)                                                                                                                                                    |
| 2026-09-19 | Fichiers de sourcing d'entreprises déplacés vers `data/raw/{france,quebec,matching}/`, non versionnés                                                              | Organisation claire de la matière première du futur pipeline d'import, sans les mélanger au code applicatif — voir `data/README.md`                                                                                                      |
| 2026-09-19 | Projet Supabase réel créé et connecté (`ca-central-1`) ; migrations 0001-0010 appliquées manuellement via l'éditeur SQL, pas via la CLI                            | Aucun jeton d'accès CLI ni mot de passe de base de données partagé avec l'assistant, par prudence (secrets trop sensibles pour transiter par la conversation)                                                                            |
| 2026-09-19 | Politique `companies_insert_authenticated` corrigée (`auth.role()` → `auth.uid() is not null`) — migration 0011                                                    | `auth.role()` s'est révélé peu fiable en conditions réelles sur ce projet (bloquait à tort les utilisateurs connectés), découvert par les tests d'intégration réels                                                                      |
| 2026-09-19 | `create_company()` passée en `SECURITY DEFINER` — migration 0012                                                                                                   | Contournait un paradoxe RLS/RETURNING découvert par les mêmes tests réels (la ligne fraîchement créée n'était pas encore visible par son créateur au moment où `RETURNING` était évalué)                                                 |
| 2026-09-19 | `audit_logs` avancé de la Phase 9 à la Phase 3                                                                                                                     | Plusieurs événements de cette phase (création d'entreprise, tentative de modification d'un champ protégé, ajout de membre) devaient déjà être traçables                                                                                  |
| 2026-09-19 | Champs protégés (`platform_role`, `subscription_level`, `verification_status`) via déclencheurs plutôt que permissions par colonne, RPC exclusive ou table séparée | Solution la plus lisible, réutilise `is_platform_admin()`, journalise nativement — voir `supabase/migrations/0009_protect_sensitive_columns.sql`                                                                                         |
| 2026-09-19 | URLs traduites par langue (`/connexion` vs `/login`) via l'option `pathnames` de next-intl                                                                         | Meilleur SEO et meilleure lisibilité pour l'utilisateur final qu'un simple préfixe de langue sur un chemin identique                                                                                                                     |
| 2026-09-19 | Tests de sécurité réels contre le vrai projet plutôt que pgTAP                                                                                                     | pgTAP nécessite une instance Postgres locale via Docker, indisponible dans cet environnement ; les tests réels se sont avérés plus efficaces (ont trouvé deux bugs réels que la validation locale de la Phase 2 ne pouvait pas détecter) |
| 2026-09-19 | Priorité métier réorientée : offres/besoins/opportunités/matching avant l'annuaire public                                                                          | Le propriétaire du projet a explicitement demandé que l'avantage concurrentiel (savoir ce que chaque entreprise propose/recherche) prime sur la construction d'un simple annuaire — voir §16                                             |
| 2026-09-19 | Codes `business_capability_types` existants conservés (non renommés) malgré une liste de noms légèrement différente demandée en Phase 4                            | Éviter de casser des données déjà créées (clé primaire déjà référencée) ; équivalence sémantique documentée en §4.4, seules les catégories réellement absentes (LICENSING, FRANCHISING, OTHER) ont été ajoutées                          |
| 2026-09-19 | Produits/services et langues d'une offre/besoin dans des tables de jointure dédiées, pas de duplication dans `company_products_services`/`company_languages`       | Une offre/un besoin peut cibler des produits différents de ceux déclarés au niveau de l'entreprise ; séparation plus flexible pour le futur matching                                                                                     |
| 2026-09-19 | Titre d'une offre/d'un besoin composé automatiquement par l'application, pas saisi par l'utilisateur                                                               | Garder le formulaire rapide à remplir (demande explicite) tout en conservant un champ structuré et recherchable                                                                                                                          |
| 2026-09-19 | Journal d'audit des offres/besoins : jamais le contenu libre (titre/description), seulement les identifiants et le type de catégorie                               | Limiter l'exposition de contenu commercial potentiellement sensible dans un journal technique                                                                                                                                            |
| 2026-09-19 | Jeu de données de démonstration créé par un script (`scripts/seed-demo-data.mjs`), pas par une migration SQL                                                       | Une migration décrit une évolution de schéma, pas des données ; le script est idempotent et réutilisable sans polluer l'historique des migrations                                                                                        |
| 2026-09-19 | `opportunities.capability_type_code` réutilise `business_capability_types` avec un champ `direction` (`seeking`/`offering`) plutôt qu'un nouveau vocabulaire       | Couvre "Recherche X" et "Proposition de X" pour chaque catégorie sans dupliquer le vocabulaire déjà en place — demande explicite de réutiliser les catégories existantes                                                                 |
| 2026-09-19 | Auto-réponse interdite et contrôle de qui peut changer quoi (`opportunity_responses`) imposés par des déclencheurs, pas par l'interface                            | Garantie au niveau base de données, testée explicitement (demande explicite du propriétaire du projet) ; l'interface ne peut pas être contournée par un appel API direct                                                                 |
| 2026-09-19 | Expiration des opportunités calculée à l'affichage (`expires_at`) plutôt que par une tâche planifiée (pg_cron)                                                     | Aucune tâche planifiée fiable/testable dans cet environnement ; une fonction administrable (`expire_stale_opportunities()`) reste disponible pour mettre à jour le statut affiché, sans dépendance fragile non vérifiable                |
| 2026-09-19 | `notifications` avancée de la Phase 8/9 à la Phase 5                                                                                                               | Nécessaire dès maintenant pour "votre opportunité a reçu une réponse" et les accusés d'acceptation/refus ; écriture réservée à `create_notification()` (SECURITY DEFINER), jamais d'insertion directe                                    |
| 2026-09-19 | Entreprises de démonstration marquées `[DEMO]` dans leur nom commercial et leur description                                                                        | Éviter toute confusion avec de vraies entreprises, demande explicite avant la Phase 5                                                                                                                                                    |
| 2026-09-19 | Matrice de compatibilité besoin↔offre stockée dans une table SQL (`capability_compatibility`), avec règle réflexive implicite plutôt que stockée                   | Administrable sans déploiement de code ; éviter 18 lignes redondantes pour la règle "même code = compatible"                                                                                                                             |
| 2026-09-19 | Scoring implémenté en TypeScript pur (pas en PL/pgSQL), génération de candidats en SQL                                                                             | Le scoring doit être testable unitairement sans base de données (§34) ; la génération de candidats doit rester performante à grande échelle (§24) — deux besoins différents, deux couches différentes                                    |
| 2026-09-19 | `score_breakdown` en jsonb plutôt qu'une table `match_score_details` séparée                                                                                       | Exception assumée au principe "pas de gros JSON" : c'est un artefact d'explication propre à un match, pas une donnée métier filtrée/agrégée entre plusieurs matches                                                                      |
| 2026-09-19 | Écriture de `matches`/`opportunity_matches` réservée à la clé secrète, aucune politique RLS d'insertion pour un client normal                                      | Empêcher qu'un utilisateur puisse fabriquer ou gonfler un score de compatibilité depuis le navigateur                                                                                                                                    |
| 2026-09-19 | Recalcul "à la lecture" (appelé depuis les pages, upserté comme sous-produit) plutôt qu'un déclencheur sur chaque écriture d'offre/besoin/opportunité              | Simplicité et fiabilité pour le MVP (§23) ; évite une file d'attente ou une infrastructure de tâches de fond non nécessaire au volume actuel                                                                                             |
| 2026-09-19 | Incompatibilité fondamentale de type = élimination complète du candidat, pas un score de 0 affiché                                                                 | Un score de 0 laisserait croire qu'un calcul a eu lieu ; l'absence de correspondance dans la matrice signifie que la comparaison n'a pas de sens                                                                                         |
| 2026-09-19 | Donnée manquante sur un critère = ratio neutre (50 % du poids) + réduction de la CONFIANCE globale, jamais du score au-delà de ce ratio                            | Ne pas pénaliser excessivement un profil incomplet (§37) tout en signalant honnêtement la fiabilité du score affiché                                                                                                                     |

---

_Prochaine révision prévue : au démarrage de la Phase 7._
