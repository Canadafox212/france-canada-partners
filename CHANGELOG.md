# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

## [Non publié]

### Phase 0 — Plans de retour arrière 0024/0025/0026 testés sur fcp-preprod (2026-09-24)

- **Dette Phase 10C résolue** (voir entrée Phase 10C ci-dessous, section « Dette ») : aucun plan de retour arrière n'existait pour `0024`/`0025`, et celui de `0026` était partiel. Trois nouveaux scripts écrits (`docs/rollback/0024-dedup-et-anti-rafale.sql`, `0025-protection-coordonnees.sql`, `0026-complet.sql`), chacun avec en-tête explicite : ordre d'exécution obligatoire, données perdues, failles de sécurité rouvertes. `0026-fonctions-avant.sql` (plan partiel préexistant) conservé tel quel à côté de `0026-complet.sql`.
- **Ordre de retour arrière déterminé par analyse, pas supposé** : `create_partnership_request()` n'a qu'une seule version vivante en base (`CREATE OR REPLACE FUNCTION`) — la chaîne réelle est 0023 → 0024 → 0026, donc 0026 doit être défaite avant 0024 (sinon une partie de 0026 serait silencieusement écrasée). Aucune dépendance technique trouvée entre 0025 et 0024/0026 ; l'ordre 0026 → 0025 → 0024 est néanmoins suivi par prudence (ordre chronologique inverse de l'application réelle).
- **`0025-protection-coordonnees.sql` corrigé avant écriture** : l'ordre naïf (supprimer les contraintes CHECK puis recopier) a été inversé — suppression des 2 contraintes d'abord (elles bloqueraient toute écriture sinon), recopie `company_contacts` → `companies` avec vérification ligne par ligne (transaction annulée au moindre écart, même discipline que la migration 0025 elle-même à l'envers), restauration de `create_company()` (version 0012) et `submit_company_claim()` (version 0018), puis suppression de `company_contacts`. Conçu pour zéro perte de données.
- **Testé réellement de bout en bout contre `fcp-preprod`** (jamais la production) : 3 entreprises fictives créées via `create_company()` avec contacts professionnels ; retours arrière exécutés dans l'ordre 0026 → 0025 → 0024 (via psql, session pooler du projet — l'agent n'a pas de chaîne de connexion Postgres directe, seulement des clés REST/PostgREST) ; schéma exposé comparé à l'état post-0023 reconstruit depuis les migrations 0001-0023 : **zéro écart** (40 tables, 16 fonctions RPC propres au projet, le reste étant des fonctions trigger jamais exposées par PostgREST) ; les 3 contacts recopiés dans `companies.professional_email`/`phone` confirmés identiques caractère pour caractère aux valeurs d'origine ; migrations originales réappliquées dans l'ordre 0024 → 0025 → 0026 ; schéma revenu identique à l'état de départ (42 tables, 23 fonctions RPC + `unaccent`) ; les 3 contacts confirmés revenus dans `company_contacts`, `companies.professional_email`/`phone` revenus à `NULL` ; **suite d'intégration complète relancée : 224/224 verts**. Les 3 entreprises fictives, leurs contacts et l'utilisateur de test jetable supprimés après coup — `companies`/`company_contacts` confirmés vides sur `fcp-preprod` (état identique au point de départ).
- `docs/rollback/README.md` (nouveau) : ordre d'exécution obligatoire, où exécuter (SQL Editor Supabase du projet visé, avec rappel explicite de vérifier la référence de projet dans l'adresse avant de coller quoi que ce soit — table des deux références connues, préprod et production), requête de vérification des contacts, procédure de sortie (réapplication des migrations originales + suite d'intégration). Autoportant : utilisable en urgence sans accès à la conversation qui a produit ces fichiers.
- **`.gitignore`** : bloc excluant `/docs/rollback/` retiré. La raison invoquée (« définitions SQL sensibles à l'état exact du projet Supabase du moment ») ne résistait pas à l'examen — les 4 scripts de ce dossier, comme leur propre en-tête le dit, sont reconstruits depuis le texte des migrations déjà commitées, jamais depuis une introspection de la production, et ne contiennent aucun secret ni identifiant propre à un projet. Aucun document du dépôt ne prétendait le contraire (vérifié : `CHANGELOG.md`, l'en-tête même de `0026-fonctions-avant.sql`, et une recherche du mot « introspection » dans tout le dépôt disent tous la même chose — reconstruction, jamais introspection).

### Phase 10C — Corrections de sécurité issues d'un audit indépendant (2026-09-20/21)

> **Note sur cette entrée** : rédigée le 2026-09-23, après coup — contrairement à toutes les phases précédentes, les 4 commits ci-dessous (`d8d884f`..`32cf1cb`) n'avaient mis à jour aucun fichier de documentation au moment de leur application. Le contenu qui suit a été reconstitué à partir des migrations, du code et des commentaires réels (jamais inventé), puis les faits d'application ont été **revérifiés en lecture seule** avant rédaction — voir la distinction de statut par migration ci-dessous, volontairement différente d'une migration à l'autre.

#### LOT 10C-1 — Préparation à l'activation, checklist et page Québec (2026-09-20)

- `src/lib/companies/completeness.ts` (fonctions pures, sans accès base) : deux notions volontairement distinctes, jamais fusionnées — **complétude** (pourcentage informatif 0/25/50/75/100 sur 4 critères) et **préparation au matching** (booléen strict, incluant « revendiquée » = a un owner/admin actif, jamais `companies.claimed_at` qui reste `null` indéfiniment pour une entreprise auto-créée via `create_company()`).
- Checklist d'activation (`ActivationChecklist.tsx`) sur `/compte/entreprises/[id]` : 6 étapes non bloquantes, chacune pointant vers une section déjà existante de la même page (profil, produits/services, offre, besoin, marchés cibles, partenaires potentiels) — aucun nouveau formulaire dupliqué.
- Nouveau formulaire « Marchés cibles » (`CompanyMarketsForm.tsx`, `company_markets.market_type = 'target'` uniquement — `'current'` non couvert, aucun usage produit identifié) ; aucune migration requise, `company_markets` existe depuis la Phase 2.
- Nouvelle page de recrutement `/quebec` (contenu statique, même segment d'URL en FR/EN), ajoutée au sitemap — canal d'acquisition pour la stratégie Québec (Phase 10B), qui repose sur l'inscription volontaire faute de source de données québécoise commercialement réutilisable.
- 12 nouveaux tests unitaires (`tests/unit/companies/completeness.test.ts`).
- **Limite identifiée dans ce lot, corrigée seulement en LOT 10C-4** : le libellé « Activée » affiché ici provenait uniquement de ce calcul de préparation de profil, indépendant de `companies.status` — une entreprise `draft` au profil complet pouvait donc afficher « Activée » sans être publiée.

#### LOT 10C-2 — Détection de doublon et limitation anti-rafale (2026-09-20)

- Migration `0024_dedup_search_and_rate_limit.sql`. **Statut de vérification** : appliquée sur Supabase, objets confirmés présents et fonctionnels par un appel réel en lecture seule le 2026-09-23 (`extract_website_domain()` répond correctement, `find_similar_companies()`/`get_company_claim_preview()` répondent avec l'exception attendue plutôt qu'une erreur « fonction introuvable ») — **pas** de suite d'intégration réexécutée avec succès à ce jour contre l'état actuel de la base (voir « Dette » ci-dessous).
- `find_similar_companies()` (`SECURITY DEFINER`, réservée aux utilisateurs connectés) : recherche de candidats avant création d'entreprise ; la comparaison fine reste côté application (`src/lib/companies/dedup.ts`, déplacé depuis `src/lib/import/dedup.ts` pour être réutilisé par la création manuelle ET l'import). Durcissements appliqués après revue de sécurité avant application : recherche par sous-chaîne réécrite avec `position()` (jamais `ilike` avec un joker fourni par l'utilisateur, qui aurait permis un dump de toutes les entreprises via `'%'`) ; longueur minimale de 3/4 caractères ; une entreprise `draft`/non active n'est retournée que sur un signal **fort** (numéro officiel + pays, domaine exact, ou nom exact + pays + ville) — jamais par simple sous-chaîne — pour ne jamais servir d'annuaire de fiches non publiques.
- `get_company_claim_preview()` : prévisualisation minimale (nom + statut de revendication uniquement) d'une fiche non publique trouvée par la recherche de doublon, pour permettre sa revendication sans exposer le reste de son contenu.
- `DuplicateWarning.tsx` intégré à `CreateCompanyForm.tsx` : avertit avant création si une entreprise similaire existe déjà.
- Limitation anti-rafale ajoutée à `create_partnership_request()` (redéfinition de la fonction 0023, fichier 0023 non modifié) : 20 demandes maximum par **entreprise demandeuse** (jamais par utilisateur — plusieurs membres de la même entreprise partagent la limite) sur une heure glissante, sérialisée par `pg_advisory_xact_lock()` pour éviter une course entre deux appels concurrents (sans ce verrou, deux requêtes simultanées pourraient toutes deux lire « 19 » et produire 21 lignes). Erreur renvoyée sous forme de code stable (`RATE_LIMIT_EXCEEDED`), traduit côté interface plutôt qu'un texte figé dans une langue.
- 27 + 9 nouveaux tests d'intégration (`tests/integration/duplicateSearch.test.ts`, `tests/integration/partnershipRequestsRateLimit.test.ts`) et 8 nouveaux tests unitaires (`tests/unit/companies/duplicateCheck.test.ts`) — préparés en même temps que la migration, comme pour chaque phase précédente, mais non réexécutés depuis contre l'état actuel de la base (voir « Dette »).

#### LOT 10C-3 — Protection des coordonnées professionnelles (2026-09-20)

- Migration `0025_protect_company_contacts.sql`. **Statut de vérification** : appliquée sur Supabase, objets confirmés présents le 2026-09-23 (table `company_contacts` interrogeable avec des lignes réelles ; plus aucune ligne `companies` avec `professional_email`/`phone` non nul) — **pas** de suite d'intégration réexécutée avec succès à ce jour contre l'état actuel de la base.
- **Constat corrigé** : `companies` reste lisible publiquement au niveau ligne pour toute entreprise `active` (la RLS PostgreSQL ne filtre jamais par colonne) — `professional_email`/`phone` y résidaient donc en clair, et étaient jusqu'ici **réellement affichées sur la fiche publique** (`/entreprises/[slug]`). Nouvelle table `company_contacts`, RLS réservée en lecture aux membres de l'entreprise et aux administrateurs de plateforme, en écriture à owner/admin — aucune politique de suppression (mise à `null` via `UPDATE` uniquement, même principe que `companies`).
- Migration séquencée pour ne jamais laisser de fenêtre où les vraies valeurs resteraient lisibles en clair dans `companies` : création de la table → copie des données existantes → **vérification réelle ligne par ligne** (pas un simple `COUNT`, comparaison stricte des deux valeurs) → si un seul écart, `RAISE EXCEPTION` annule toute la migration → seulement alors, mise à `null` des anciennes colonnes, verrouillées par une contrainte `CHECK` empêchant toute future écriture (suppression physique des colonnes différée à une migration future, après validation en production).
- `create_company()` et `submit_company_claim()` redéfinies pour lire/écrire depuis `company_contacts` au lieu de `companies` (signatures publiques inchangées, aucune rupture pour les formulaires appelants).
- Fiche publique d'entreprise : `professional_email`/`phone` ne sont plus jamais sélectionnés ni affichés — seul le site web reste une coordonnée publique.
- 20 nouveaux tests d'intégration (`tests/integration/companyContacts.test.ts`) ; tests existants (`directory.test.ts`, `import.test.ts`, `partnershipRequests.test.ts`, `rls.test.ts`) mis à jour pour refléter le déplacement des coordonnées — non réexécutés depuis contre l'état actuel de la base (voir « Dette »).

#### LOT 10C-4 — Publication/activation sécurisée des entreprises (2026-09-21)

- Migration `0026_secure_company_publication.sql`, appliquée en production le 2026-09-21. **Seule migration de ce lot avec des tests d'intégration réellement réexécutés avec succès après application** : 24/24 nouveaux tests (`tests/integration/companyPublication.test.ts`), suites existantes 100/100, scénario de limitation anti-rafale 19+5 confirmé.
- **Faille corrigée, signalée par un audit indépendant Cowork** : `companies_update_owner_admin` (migration 0002) n'a pas de `WITH CHECK` — un owner/admin autorisé à modifier sa propre fiche pouvait écrire n'importe quelle valeur de `companies.status`, y compris `'active'`, en un seul `UPDATE`, sans passer par aucune validation. Symptôme côté interface : le libellé « Activée » (LOT 10C-1) provenait exclusivement du calcul de préparation de profil, jamais de `companies.status`.
- Nouvelle table `company_publication_requests` (`draft` → `pending` → `approved`/`rejected`), même principe que `company_claims` (Phase 7) et `partnership_requests` (Phase 9) : **aucune** politique RLS d'insertion/mise à jour/suppression pour `authenticated`/`anon`, écriture exclusivement via deux fonctions `SECURITY DEFINER`.
- `request_company_publication()` (réservée owner/admin de l'entreprise) et `review_company_publication_request()` (réservée administrateur de plateforme) : critères de préparation centralisés dans une seule fonction interne (`is_company_ready_for_publication()`, jamais dupliquée en TypeScript), recalculés au moment de la demande **et** revalidés au moment de l'approbation — un profil redevenu incomplet entre les deux ne déclenche jamais un rejet automatique, la demande reste `pending` et peut être réessayée après correction (le refus reste une décision humaine explicite). Verrous `FOR UPDATE` contre deux décisions administratives concurrentes ; index unique partiel empêchant deux demandes `pending` simultanées pour la même entreprise.
- `protect_companies_platform_fields()` (fonction de la migration 0009, redéfinie — fichier 0009 non modifié) étendue pour couvrir aussi `status`, en plus de `subscription_level`/`verification_status` déjà protégés. Compromis validé par le propriétaire du projet : un administrateur de plateforme peut toujours modifier `status` par un `UPDATE` direct (mécanisme de secours, notamment utilisé par les scripts d'import/seed via la clé de service), mais jamais silencieusement — chaque changement reste journalisé dans `audit_logs`.
- Politique `companies_insert_authenticated` (définie en 0011, redéfinie ici) resserrée pour contraindre aussi les **valeurs** insérées (`status`/`verification_status`/`subscription_level`), pas seulement l'authentification de l'auteur — un utilisateur connecté ne peut plus insérer directement une ligne `companies` avec `status = 'active'`.
- `create_partnership_request()` (redéfinie une seconde fois depuis 0024) : quatre messages d'erreur destinés à l'interface convertis en codes stables (`NOT_AUTHORIZED`, `REQUESTER_NOT_ACTIVE`, `TARGET_NOT_ACTIVE`, `DUPLICATE_ACTIVE_REQUEST`) — aucun changement de comportement métier, diff vérifié caractère pour caractère. Une entreprise demandeuse doit désormais être publiée (`status = 'active'`), plus seulement au profil complet, pour envoyer une demande de mise en relation.
- Interface `/compte/entreprises/[id]` : `companies.status` décide **en premier** de l'affichage (publiée / en attente de validation / prête à publier / à compléter) — la checklist et le pourcentage de complétude ne réapparaissent plus jamais pour une entreprise déjà publiée, même si son profil redevient incomplet après coup. Nouveau bouton « Demander la publication » (`RequestPublicationButton.tsx`) et nouvelle page d'administration `/admin/publications` (calquée sur `/admin/revendications`, Phase 7 : gardée par `platform_role`, pas seulement par la RLS) pour approuver/refuser avec motif optionnel.

#### Dette documentée à l'issue de la Phase 10C

- Les suites d'intégration de 10C-1/10C-2/10C-3 ont été écrites au moment de chaque migration mais **n'ont pas été réexécutées avec succès contre l'état actuel de la base** après l'application ultérieure de 0025 et 0026 (qui redéfinissent des fonctions dont elles dépendent). Seule la suite de 10C-4 (`companyPublication.test.ts`) a un résultat vert confirmé après application. À faire avant toute nouvelle migration touchant ces zones : créer d'abord une base Supabase de préproduction, y faire pointer `test:integration`, puis relancer la suite en entier contre cette préproduction — jamais contre la production.
- Aucun plan de retour arrière écrit pour 0024/0025 à ce jour. Pour 0026, un plan **partiel** existe désormais (`docs/rollback/0026-fonctions-avant.sql`, non versionné — voir `.gitignore` — **reconstitué depuis les fichiers de migration 0009/0011/0024, jamais une introspection de la production**) : il restaure les 3 objets redéfinis par 0026 vers leur état pré-10C-4, mais ne supprime pas la table `company_publication_requests` ni les 4 fonctions qu'elle introduit : un retour arrière complet resterait une décision destructive séparée, jamais automatisée.
- **Mise à jour du 2026-09-23** : préproduction créée (projet Supabase `fcp-preprod`, identifiant `eowveslvhbufomsdkhzt`, région `eu-west-3`) ; les 26 migrations (`0001` à `0026`) appliquées avec succès (`scripts/preprod/apply-all-migrations.sql`, non versionné). `tests/integration/setup.ts` repointé vers `.env.preprod.local` (jamais `.env.local`/production, jamais lu par l'assistant) : refuse de démarrer si l'URL pointe vers la production ou ne pointe pas vers ce projet de préproduction précis. **Suite d'intégration exécutée contre `fcp-preprod` : 223/224 tests verts en une passe séquentielle complète, puis `import.test.ts` (le seul test en échec — une erreur réseau générique `fetch failed`, aucun code d'erreur Postgres/RLS) vert 14/14 en relançant ce seul fichier isolément.** Deux mesures se sont révélées nécessaires ensemble pour éliminer les échecs par limite de débit observés pendant le diagnostic : la limite de débit Auth de `fcp-preprod` a été relevée de 30 à 300 (**uniquement sur ce projet de préproduction, jamais en production**), et l'exécution des fichiers de test a été rendue systématiquement séquentielle (`fileParallelism: false` dans `vitest.integration.config.mts`, confirmé d'abord via `--no-file-parallelism` en ligne de commande ; tests unitaires non affectés). **La dette de tests décrite ci-dessus (suites 10C-1/10C-2/10C-3 non retestées) est résolue.** La dette sur les plans de retour arrière décrite ci-dessus (aucun pour `0024`/`0025`, plan seulement partiel pour `0026`) reste ouverte et n'est pas concernée par ce travail.

### Phase 9 — Mise en relation commerciale entre entreprises (2026-09-20)

- Migration `0023_partnership_requests.sql` (validée localement via pglite avec un harnais renforcé utilisant de vrais `SET ROLE` pour vérifier la RLS/les permissions réelles ; **appliquée sur Supabase** après trois tours de revue explicite) : table `partnership_requests` (mécanisme dédié, distinct de `opportunity_responses`/`company_offers`/`company_needs`) ; RLS lecture seule (membre d'une des deux entreprises ou administrateur) ; toute écriture passe par 4 fonctions SECURITY DEFINER — `create_partnership_request()`, `accept_partnership_request()`, `decline_partnership_request()`, `withdraw_partnership_request()` — aucune politique RLS d'insertion/mise à jour, même principe que `company_claims` (Phase 7).
- Validation serveur de la provenance : pour une demande `MATCH`, le match référencé doit réellement relier le besoin et l'offre des deux entreprises de la demande (dans un sens ou dans l'autre) ; pour `OPPORTUNITY`, l'opportunité référencée doit appartenir à l'entreprise cible. Jamais de recalcul ni de copie du score.
- Entreprise cible non revendiquée : statut `pending_unclaimed`, aucune notification automatique. Visibilité gérée par un **nouveau déclencheur découplé** sur `companies.claimed_at` (`companies_claimed_at_promote_requests` → `promote_unclaimed_partnership_requests()`) plutôt qu'en modifiant `submit_company_claim()`/`review_company_claim()` (0018, laissées strictement intactes) — alternative proposée en revue puis retenue pour éliminer tout risque de régression sur le parcours de revendication.
- Interface : CTA « Demander une mise en relation » sur les partenaires potentiels (`MatchCard`, nouveau slot `actions`) et sur la fiche publique d'une entreprise (visiteur anonyme redirigé vers la connexion avec retour automatique à la fiche) ; « Mes mises en relation » (`/compte/mises-en-relation`, REÇUES/ENVOYÉES + page de détail avec actions Accepter/Refuser/Retirer) ; « Mes notifications » (`/compte/notifications`, pagination, marquer comme lu) ; compteur de notifications non lues sur la page de compte. `upsertMatch()` renvoie désormais l'id du match pour permettre au CTA de le référencer sans le recalculer.
- Acceptation d'une demande ne révèle que le statut « acceptée » — jamais de coordonnée personnelle. Sujet et message restent des champs libres saisis par l'utilisateur, jamais générés depuis le matching. Journal d'audit (`partnership_request_created`/`accepted`/`declined`/`withdrawn`) sans jamais copier le contenu libre.
- **Vérification factuelle demandée avant toute construction** : une entreprise sans offre ni besoin ne peut recevoir aucun score de matching — confirmé **impossible** par lecture du code ET par un nouveau test de régression (`tests/integration/matching.test.ts`), aucun code de scoring/seuil/génération de candidats modifié.
- 28 nouveaux tests d'intégration (`tests/integration/partnershipRequests.test.ts`) : création valide, auto-demande/demandeur non membre/`viewer`/entreprise `draft` interdits, provenance MATCH/OPPORTUNITY falsifiée rejetée (réelle acceptée dans les deux sens pour un match), doublon de demande active interdit, visibilité en lecture stricte, qui peut accepter/refuser/retirer, notification et audit réellement créés, entreprise non revendiquée sans notification puis visibilité après revendication. Suite complète : 87 tests unitaires, 144 tests d'intégration, tous verts (exécution serialisée — la parallélisation par défaut déclenche parfois une limite de débit transitoire de l'API Auth Supabase sous forte charge, caractéristique connue de ce projet partagé, non liée au code de cette phase).
- Vérification réelle en conditions live (entreprises et comptes jetables, jamais les 5 entreprises pilotes réelles) : demande créée depuis la fiche publique, visible dans les deux listes ENVOYÉES/REÇUES, notification reçue, acceptation confirmée sans fuite de coordonnée personnelle, notification d'acceptation reçue — données de test entièrement supprimées après vérification.
- `PROJECT_SPEC.md`, `docs/DATABASE.md`, `docs/SECURITY.md` mis à jour ; nouveau `docs/PARTNERSHIP_REQUESTS.md` (explication en langage clair : qui peut contacter qui, différence avec une réponse à une opportunité, gestion revendiquée/non revendiquée, confidentialité, statuts). Aucune migration 0001-0022 modifiée.

#### Validation manuelle de bout en bout + corrections visuelles/i18n (2026-09-20)

- **Parcours complet validé manuellement** par le propriétaire du projet avec deux comptes/entreprises jetables : demande envoyée depuis la fiche publique d'une entreprise revendiquée → reçue par la cible → notification reçue → acceptée → notification d'acceptation reçue par le demandeur. Un test complémentaire vers une entreprise `[DEMO]` non revendiquée (Métallerie du Rhône) a confirmé le statut « En attente (fiche non revendiquée) » sans notification. Toutes les données de test (2 utilisateurs, 2 entreprises `[TEST]`, 2 demandes, 2 notifications) supprimées après vérification ; les `audit_logs` correspondants sont conservés (voir docs/SECURITY.md — même politique que toutes les suites de tests d'intégration du projet, qui ne suppriment jamais leurs propres lignes d'audit).
- **Bug réel corrigé** : `Company.profileSectionTitle` manquait dans `messages/fr.json`/`messages/en.json`, provoquant une erreur `MISSING_MESSAGE` sur `/compte/entreprises/[id]`. Clé ajoutée aux deux fichiers (« Informations de l'entreprise » / « Company information »).
- **Bug réel corrigé** : le fil d'Ariane de `/compte/mises-en-relation` et `/compte/notifications` répétait deux fois le même libellé (« Mises en relation / Mises en relation », « Notifications / Notifications ») au lieu de remonter vers « Mon compte ».
- **Bug réel corrigé** : le bouton « Se déconnecter » apparaissait deux fois sur `/compte` — une fois dans l'en-tête du site (affiché sur toutes les pages), une fois dans le corps de la page elle-même. Le second, redondant, a été retiré ; celui de l'en-tête suffit.
- Vérifié réellement (compte jetable temporaire, supprimé aussitôt après) sur `/compte`, `/compte/mises-en-relation`, `/compte/notifications` et leurs équivalents `/account/*` : plus aucune erreur `MISSING_MESSAGE`, un seul titre par page, un seul bouton de déconnexion, sélecteur FR/EN fonctionnel. 144 tests d'intégration et 87 tests unitaires toujours verts. Aucune migration, aucune règle RLS, aucun code de matching ou du workflow `partnership_requests` modifié.

### Phase 8 — Audit des données de sourcing + pipeline d'import (2026-09-19/20)

#### Étape 1 — Audit (2026-09-19, docs seulement, aucun code/migration/import)

- `docs/DATA_INVENTORY.md` : inventaire réel de `data/raw/` (formats, tailles, nombre de lignes/colonnes, feuilles Excel, relations entre fichiers). Constat clé : 100 entreprises françaises réellement disponibles (sur l'objectif de 5 000, lot 1/50) et ~659 candidates québécoises dont 100 enrichies (sur l'objectif de 2 000) — pas 7 000 entreprises prêtes à l'import.
- `docs/DATA_SOURCES.md` : statut de provenance/licence par source (`APPROVED_FOR_IMPORT`/`REVIEW_REQUIRED`/`DO_NOT_IMPORT`/`UNKNOWN`). 13 entreprises françaises couvertes par une source ouverte de bout en bout (SIRENE, Licence Ouverte 2.0) ; **aucune source québécoise approuvée pour un usage commercial** à ce jour.
- `docs/DATA_MAPPING.md` : correspondance colonne par colonne vers le modèle existant, avec les cas qui ne se rattachent à aucun champ (à conserver en staging, jamais forcés).
- Constats : `france_quebec_besoins.csv`/`_offres.csv` contiennent des besoins/offres **déduits automatiquement**, jamais déclarés par une entreprise — exclus de tout mapping ; `france_quebec_matching_prototype.xlsx`/`matching_france_quebec_top500.csv` : prototype de scoring antérieur, incompatible avec le moteur réel (Phase 6) — jamais importé dans `matches`.

#### Étape 2 — Pipeline construit et testé (2026-09-20)

- Migration `0020_import_pipeline.sql` : `data_sources.license_status`/`commercial_use_allowed` (+ 3 sources tranchées), `import_batches`, `staging_companies` (colonnes `raw_*`/`normalized_*` structurées, pas un JSON unique), `import_row_issues`, `import_duplicate_candidates`, `company_source_records.import_batch_id`, déclencheur `enforce_import_license_gate` (bloque un batch sur une source non approuvée sauf dérogation admin justifiée et auditée).
- `src/lib/import/` : normalisation (jetons de valeur absente, domaine de site, téléphone, pays), classification des courriels (`GENERIC_BUSINESS`/`NAMED_BUSINESS`/`PUBLIC_PROVIDER`/`INVALID`/`UNKNOWN` — seul le premier publié automatiquement), validation (nom absent → rejeté, pays inconnu → quarantaine, URL invalide → avertissement), dédoublonnage (numéro officiel > domaine > nom+ville > nom seul, seul `EXACT` rattaché automatiquement), lecture CSV (`csv-parse`), commit (jamais de mise à jour du contenu commercial d'une entreprise existante), rapport lisible.
- `scripts/import-companies.ts` (CLI via `tsx`, ajouté en dépendance de développement) : `npm run import:dry-run` / `npm run import:run`, restreint par une allowlist explicite des 13 numéros SIREN approuvés — jamais les 100 lignes du fichier.
- `docs/QUEBEC_SOURCING_STRATEGY.md` : pistes alternatives pour une future source Québec compatible (Corporations Canada, sources partenaires, inscriptions volontaires, profils revendiqués), architecture déjà prête pour plusieurs sources par entreprise, démarche recommandée auprès du Registraire — documentation uniquement, aucun code.
- **Dry run réel exécuté** sur les 13 entreprises françaises approuvées : 13 lignes valides, 0 avertissement, 0 rejet, 0 quarantaine, 0 doublon — aucune écriture dans `companies`, confirmé par vérification directe. **Aucun import réel exécuté.**
- 40 nouveaux tests unitaires (`tests/unit/import/`) et 13 nouveaux tests d'intégration réels (`tests/integration/import.test.ts` : garde-fou de licence, dry run sans écriture, dédoublonnage EXACT/POSSIBLE, idempotence, protection d'une entreprise revendiquée, courriel nominatif jamais publié, valeur source conservée, RLS). Toutes les suites précédentes continuent de passer (93 tests d'intégration au total).
- `PROJECT_SPEC.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/IMPORT_PIPELINE.md` (réécrit pour refléter l'état réellement construit) mis à jour.

#### Étape 3 — Import réel du lot pilote (2026-09-20)

- Ajout d'un indicateur `includeDescription` (`commitStagingRow()`) : le statut `APPROVED_FOR_IMPORT` de la source française couvre l'identité légale (SIRENE), pas nécessairement le champ `Description` du fichier (probablement issu du site propre de chaque entreprise) — exclu par précaution pour ce pilote, conservé en staging pour traçabilité. Vérifié par un nouveau test d'intégration.
- **Import réel exécuté** (batch `FRANCE_PILOT_001`) : 13 entreprises créées, toutes en statut `draft`, non revendiquées, sans offre/besoin/opportunité, sans donnée personnelle publiée, chacune reliée à sa source SIRENE (identifiant, batch, date, licence). Vérifié : invisibles à la recherche publique et à la lecture anonyme directe ; secteur (code APE) conservé en staging, pas encore relié à `industries` (décision documentée, pas un oubli).
- Workflow de revendication vérifié techniquement sur une entreprise importée (FIGEAC AERO) : soumission d'une demande réelle (statut `pending`, aucune auto-approbation), puis annulée — aucune trace laissée.
- Méthode de rollback confirmée : chaque entreprise du batch est retrouvable via `company_source_records.import_batch_id`/`staging_companies.created_company_id` — pas exécuté, seulement vérifié comme possible.
- 1 nouveau test d'intégration réel (exclusion de la description). 94 tests d'intégration au total, tous verts.

#### Étape 4 — Mapping sectoriel, contenu éditorial, vérification des 87 restantes (2026-09-20)

- Migration `0021_industry_mapping_and_content_source.sql` (validée localement via pglite ; **appliquée sur Supabase**, schéma réel revérifié avant toute écriture, aucune entreprise publiée) : table `industry_code_mappings` (code officiel APE/NAF ou futur NAICS/SCIAN → secteur interne, niveau de confiance explicite, jamais de rapprochement par mot-clé) remplie pour les 8 codes APE réellement présents dans le lot pilote ; colonne `company_translations.content_source` (`COMPANY_PROVIDED`/`EDITORIAL`/`SOURCE_PROVIDED`) pour ne jamais confondre un contenu rédigé par la plateforme avec une saisie d'entreprise ou une donnée SIRENE ; colonne `company_industries.classification_source` (`COMPANY_DECLARED`/`CODE_MAPPING`/`EDITORIAL_VERIFIED`, avec contrainte de cohérence) pour distinguer un secteur déduit automatiquement d'un secteur établi par une classification éditoriale vérifiée propre à une entreprise. Code APE 70.10Z (Safran, Thales, CLAYENS — "activités des sièges sociaux") volontairement classé `REQUIRES_REVIEW`, sans mapping global vers un secteur — Safran reçoit néanmoins un secteur `EDITORIAL_VERIFIED` propre à l'entreprise, fondé sur ses sources officielles, jamais déduit du code. Nouveau sous-secteur `Équipements agricoles et agro-industriels` (sous Agroalimentaire et AgTech) pour distinguer un fabricant de machines (MAF AGROBOTIC) d'un producteur/transformateur agroalimentaire.
- `docs/EDITORIAL_CONTENT.md` (nouveau) : règles de rédaction du contenu `EDITORIAL` — jamais de copie/paraphrase d'un site tiers, jamais d'invention d'un fait non vérifiable.
- **Correction de `docs/DATA_INVENTORY.md`** : l'affirmation initiale "100 % des lignes ont un SIREN/SIRET renseigné" était inexacte — seules les 13 entreprises déjà importées ont un SIREN réel ; les 87 autres portent la valeur littérale "Non disponible".
- `scripts/verify-siren-87.ts` (nouveau, lecture seule, aucune écriture en base) : vérifie les 87 entreprises restantes contre l'API officielle `recherche-entreprises.api.gouv.fr`. Exécuté réellement le 2026-09-20 (rapport dans `docs/reports/rapport-siren-87.json`) : 0 SIREN exploitable trouvé dans la source pour ces 87 lignes ; recherche de secours par nom (jamais promue au rang `CONFIRMED`) : 40 candidats uniques, 37 lots d'homonymes, 10 sans résultat. **Aucune des 87 n'est importée.**
- `src/lib/import/pilotAllowlist.ts` (nouveau) : extraction de la liste des 13 SIREN approuvés en source de vérité unique, partagée par `scripts/import-companies.ts` et `scripts/verify-siren-87.ts`.
- Nouveaux tests d'intégration réels (`tests/integration/sector-mapping.test.ts`, 17 tests, exécutés avec succès contre la base réelle après application de la migration 0021) : correspondances APE du lot pilote, non-déduction pour 70.10Z, RLS de `industry_code_mappings` (lecture publique, écriture admin), cohérence `classification_source`/`source_code_mapping_id`, provenance `content_source`, et préparation à la publication (bascule `draft` → `active` sur une entreprise jetable de test — jamais une des 13 réelles — confirmant l'absence d'offres/besoins inférés). Suite d'intégration complète : 111 tests, tous verts.
- **Secteur et description éditoriale écrits réellement pour les 5 fiches pilotes** (FIGEAC AERO, Safran, Airbus Atlantic, STMicroelectronics Rousset SAS, MAF AGROBOTIC), après revue et corrections du propriétaire du projet (sources officielles vérifiées, Wikipédia écartée, effectifs Sirene datés, description STMicroelectronics Rousset corrigée sur le 200 mm) : `company_industries` (4 en `CODE_MAPPING`, Safran en `EDITORIAL_VERIFIED`) et `company_translations` (`content_source = EDITORIAL`, locale `fr`). MAF AGROBOTIC relié en plus au sous-secteur `Équipements agricoles et agro-industriels`.
- **Publication réelle de 3 des 5 fiches** (FIGEAC AERO, Airbus Atlantic, MAF AGROBOTIC — `companies.status` `draft` → `active`, sur autorisation explicite et sélective) ; **Safran et STMicroelectronics Rousset SAS restent en `draft`**, non publiques. Vérifié après publication, dev server réel (pas seulement les tests) : apparition dans `/fr/entreprises` et `/en/companies`, recherche par nom/ville/secteur (y compris négative : "Safran"/"Rousset" ne retournent aucun résultat), fiche publique FR/EN, données structurées `schema.org` (aucune donnée personnelle), présence dans `sitemap.xml` pour les 3 publiées et absence pour les 2 restées `draft`, titre/meta description SEO, CTA "Revendiquer cette fiche" visible, absence d'offre/besoin (affichage "Aucune offre/besoin publié pour l'instant", rien d'inféré). Les 2 fiches non publiées retournent 404 sur toutes les URLs publiques testées (FR, EN, recherche). Suite complète (79 tests unitaires + 111 tests d'intégration) et build relancés, tous verts.

#### Étape 5 — Correction du bilinguisme des fiches publiques (2026-09-20)

- **Bug réel corrigé** : `generateMetadata()` de la fiche entreprise (titre/description/OpenGraph) utilisait la locale `"fr"` codée en dur, quelle que soit la page réellement consultée — la version anglaise affichait donc toujours des métadonnées SEO françaises. Utilise maintenant la locale réelle de la page ; l'URL canonique est également corrigée pour respecter le préfixe de langue (`/fr/entreprises/...` vs `/en/companies/...`), au lieu d'un chemin sans préfixe.
- **Bug réel corrigé** : `pickCompanyTranslation()` se repliait sur la traduction française dès qu'aucune traduction anglaise n'existait — comportement voulu pour un contenu `COMPANY_PROVIDED` (§11), mais jamais souhaitable pour un contenu `EDITORIAL` (rédigé pour une langue précise). Le repli inter-langue est désormais désactivé spécifiquement pour `EDITORIAL` (`src/lib/companies.ts`).
- **Sous-secteur non affiché du tout sur la fiche publique** (`company_subindustries` n'était même pas sélectionné) : corrigé — le sous-secteur est désormais chargé et affiché à côté du secteur, traduit par locale (`name_fr`/`name_en`), pour les deux langues.
- Libellé anglais du sous-secteur "Équipements agricoles et agro-industriels" corrigé (`Agricultural and agro-industrial equipment`, au lieu d'un premier essai "agri-industrial" non demandé) — corrigé à la fois dans la migration source et sur la ligne déjà appliquée en base.
- Traduction anglaise réelle ajoutée dans `company_translations` (`content_source = EDITORIAL`, fidèle au texte français approuvé, aucun fait nouveau) pour les 3 entreprises publiées (FIGEAC AERO, Airbus Atlantic, MAF AGROBOTIC). Le français existant n'a pas été modifié.
- Quatre libellés d'interface anglais corrigés dans `messages/en.json` uniquement (`messages/fr.json` non touché) : `Header.login` ("Log in" → "Sign in"), `CompanyPublic.backToDirectory` ("Directory" → "Companies", pour correspondre au segment d'URL `/en/companies`), `CompanyPublic.claimCta` ("Claim this listing" → "Claim this profile"), `CompanyPublic.noActiveOpportunities` ("No active opportunities yet." → "No active opportunities at the moment.").
- Vérifié en conditions réelles (dev server) sur les 3 fiches anglaises publiées : tous les libellés demandés sont bien traduits via next-intl et la locale courante, aucun texte français codé en dur trouvé dans les composants publics de la fiche, secteur/sous-secteur traduits, description anglaise réelle affichée (plus de repli français), SEO/OpenGraph/canonical anglais, annuaire `/en/companies`, recherche, filtres et fil d'Ariane cohérents. Pages françaises non modifiées (vérifié par comparaison avant/après). Suite complète (79 unitaires + 111 intégration), typecheck, lint et build relancés, tous verts.

#### Étape 6 — Sélecteur de langue, audit SEO bilingue, documentation obsolète (2026-09-20)

- **`src/components/layout/LocaleSwitcher.tsx`** (nouveau) : sélecteur FR/EN visible dans le `Header`, générique pour toute route de `src/i18n/routing.ts` (`usePathname()`/`useParams()` next-intl + Next.js, sans logique par page) — conserve la page courante, ses paramètres dynamiques et sa query string. Vérifié sur l'accueil, l'annuaire (avec filtres), une fiche entreprise, une page géographique, les opportunités et les pages d'authentification.
- **`src/lib/seo/alternates.ts`** (nouveau) : source unique de `alternates.canonical`/`alternates.languages` (fr/en/x-default) pour toutes les pages publiques indexables — corrige une classe de bugs présente sur PLUSIEURS pages (canonical sans préfixe de langue, parfois même absente). Appliqué à l'annuaire, aux pages géographiques (avec et sans secteur), à la fiche entreprise, aux opportunités (liste et fiche), et par défaut à la page d'accueil (`src/app/[locale]/layout.tsx`).
- **Bug réel corrigé** : `robots.ts` ne bloquait que `/*/compte` (français) — les pages de compte anglaises (`/en/account/**`) restaient indexables faute d'un motif équivalent. Ajout de `/*/account`.
- **Bug réel corrigé** : titres et fils d'Ariane des pages géographiques et géo+secteur utilisaient systématiquement `geo.labelFr`/`industry.name_fr`, y compris sur la version anglaise (ex. "Québec" au lieu de "Quebec").
- Nouveaux tests ciblés : `tests/unit/seo/alternates.test.ts` (structure canonical/hreflang, sans dépendre d'un texte éditorial précis) et `tests/integration/seo.test.ts` (le filtre de statut du sitemap exclut bien une entreprise `draft`). Suite complète : 87 tests unitaires (+8), 114 tests d'intégration (+3), tous verts.
- **Documentation corrigée** (contenu réel vérifié avant modification) : `PROJECT_SPEC.md` (statut, roadmap, journal — l'import réel et la publication de 3 entreprises étaient déjà faits mais encore décrits comme "en attente" à plusieurs endroits) ; `docs/PRIVACY.md` (table `users` inexistante → `auth.users`/`profiles.full_name` ; section "Import de données de sourcing" entièrement réécrite pour refléter le pipeline réel : provenance, licence, staging, statut `draft`, revendication, publication sélective) ; `data/README.md` (pipeline avancé de la Phase 10 à la Phase 8 ; cycle de vie réel raw → `staging_companies` → `companies` → `docs/reports/` ; rappel explicite `DO_NOT_IMPORT` pour les fichiers besoins/offres historiques déduits) ; `docs/DATABASE.md` (migrations 0021/0022 ajoutées au tableau, nouvelle règle explicite "une migration appliquée est immuable", statut d'import mis à jour).
- Aucune nouvelle table, aucun nouveau système de traduction, aucun back-office, aucune logique d'import ou de matching introduits — lot de correction/consolidation uniquement, comme demandé.

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
