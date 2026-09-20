# Sécurité

Vue d'ensemble des principes de sécurité de la plateforme. Le détail produit/architecture est dans `PROJECT_SPEC.md` §9. Les obligations de confidentialité (RGPD/Loi 25) sont documentées séparément dans `docs/PRIVACY.md`.

## Secrets et variables d'environnement

- Aucun secret n'est jamais écrit en dur dans le code.
- `.env.local` (valeurs réelles) n'est jamais versionné — voir `.gitignore`.
- `.env.example` documente les variables attendues, sans valeurs réelles.
- La clé Supabase "secrète" (`SUPABASE_SECRET_KEY`) donne un accès complet à la base (elle contourne la sécurité par ligne) : elle ne doit exister que côté serveur, jamais dans du code exécuté par le navigateur, jamais préfixée par `NEXT_PUBLIC_`.
- Toute variable d'environnement utilisée par l'application passe par `src/lib/env.ts`, qui vérifie sa présence et son format avant utilisation (voir `docs/ARCHITECTURE.md`).
- Aucun jeton d'accès personnel Supabase ni mot de passe de connexion direct à la base n'a été partagé avec l'assistant : les migrations sont appliquées manuellement (voir `docs/DATABASE.md`), par prudence.

## Authentification (en place depuis la Phase 3)

- Gérée par Supabase Auth (mots de passe hashés, jamais stockés en clair).
- Parcours disponibles : inscription, confirmation de courriel, connexion, déconnexion, mot de passe oublié, réinitialisation.
- `src/proxy.ts` rafraîchit la session à chaque requête via `supabase.auth.getClaims()` (jamais `getSession()` seule pour une décision de sécurité : elle ne revalide pas le jeton).
- Les pages privées (`/compte`, `/compte/entreprises/...`) vérifient la session côté serveur (`src/lib/supabase/session.ts`) et redirigent vers `/connexion` si absente — la protection n'est jamais laissée à la seule interface.

## Row Level Security (en place depuis la Phase 2)

Chaque table a sa politique de sécurité au niveau ligne, écrite dans la même migration que la table. Deux fonctions réutilisables portent la logique : `is_platform_admin()` (administration globale) et `has_company_role(company_id, roles[])` (droits dans une entreprise précise). Cette protection est appliquée par PostgreSQL lui-même — elle reste active même en cas d'erreur dans le code applicatif.

## Protection des champs contrôlés par la plateforme (Phase 3)

La RLS protège des **lignes**, pas des colonnes précises à l'intérieur d'une ligne qu'un utilisateur a par ailleurs le droit de modifier. Pour empêcher un `owner` de modifier lui-même `companies.subscription_level`/`verification_status`, ou un utilisateur de modifier son propre `profiles.platform_role` (élévation de privilège), des **déclencheurs** comparent explicitement l'ancienne et la nouvelle valeur et rejettent la modification si l'auteur n'est pas administrateur (voir `supabase/migrations/0009_protect_sensitive_columns.sql`, qui documente aussi pourquoi ce mécanisme a été préféré aux permissions par colonne, à une RPC exclusive ou à une table séparée). Chaque tentative bloquée échoue avec une erreur explicite ; chaque changement légitime par un administrateur est journalisé dans `audit_logs`.

## Offres et besoins (Phase 4)

Aucune nouvelle logique de permission : `company_offers`/`company_needs` et leurs tables de jointure (produits/services, langues) réutilisent exactement le même schéma de droits que le reste du profil d'entreprise (`has_company_role`) — owner/admin/member peuvent gérer, viewer en lecture seule, aucun accès pour un utilisateur extérieur. Aucun champ contrôlé par la plateforme n'a été introduit dans ces tables. Le journal d'audit associé (`offer_created`, `offer_status_changed`, `offer_updated`, `offer_deleted`, et l'équivalent pour les besoins) n'enregistre **jamais** le titre ni la description — seulement les identifiants et la catégorie — pour limiter l'exposition de contenu commercial potentiellement sensible dans un journal technique.

## Opportunités et réponses (Phase 5)

`opportunities` réutilise le même schéma de droits (`has_company_role`) que le reste du profil d'entreprise : owner/admin/member peuvent publier/gérer, viewer en lecture seule, aucune modification possible pour une entreprise tierce.

`opportunity_responses` a des règles plus fines, imposées par déclencheur (pas seulement par la RLS) :

- **auto-réponse interdite** — une entreprise ne peut jamais répondre à sa propre opportunité (`prevent_self_response_trigger`) ;
- **qui peut changer quoi** — l'entreprise répondante peut modifier son message et retirer sa réponse ; seule l'entreprise ayant publié l'opportunité peut faire progresser le statut (mise en examen, acceptation, refus) ; ni l'une ni l'autre ne peut faire ce qui revient à l'autre (`protect_opportunity_response_update_trigger`) ;
- **confidentialité stricte** — une réponse n'est visible que par l'entreprise répondante, l'entreprise ayant publié, et les administrateurs de la plateforme ; jamais par le grand public ni par une entreprise tierce (politiques RLS de `opportunity_responses`).

Le journal d'audit (`opportunity_response_created`, `..._status_changed`) et les notifications automatiques (`create_notification()`) n'exposent jamais le contenu du message.

## Moteur de matching (Phase 6)

`matches`/`opportunity_matches` (voir `docs/MATCHING.md`) sont **écrits
uniquement par la clé secrète** (`service_role`, qui contourne la RLS) :
aucune politique RLS n'autorise un client normal à insérer ou modifier un
score, pour qu'aucun utilisateur ne puisse fabriquer un match ou gonfler
un score depuis le navigateur. Un déclencheur
(`protect_match_score_fields`) referme la seule brèche restante : même
une entreprise autorisée à modifier SA propre ligne (pour changer un
statut comme "vu"/"pas intéressé") ne peut pas toucher au score, à la
confiance ni au détail — seul un administrateur de la plateforme le peut
(diagnostic/correction).

Lecture : réservée aux deux entreprises concernées par un match (jamais
une entreprise tierce), et aux administrateurs de la plateforme. Aucun
accès public/anonyme aux scores internes, même pour une opportunité
publique.

## Annuaire public et revendication (Phase 7)

`search_companies()` (voir `docs/DIRECTORY.md`) est `SECURITY INVOKER`
(par défaut) : elle s'exécute avec les droits de l'appelant, la RLS de
`companies` et de chaque table jointe continue donc de s'appliquer
normalement en plus du filtre explicite `status = 'active'` déjà présent
dans la fonction — défense en profondeur, pas une confiance aveugle dans
un seul filtre. Aucune donnée personnelle (courriel de connexion, contenu
privé) n'est exposée par cette fonction : seules les colonnes déjà
publiques de `companies` sont retournées.

`company_claims` suit le même principe que `matches`/`opportunity_matches`
(Phase 6), en plus strict : **aucune** politique RLS d'insertion ni de
mise à jour, pour un client normal comme pour un administrateur — toute
écriture passe par `submit_company_claim()`, `cancel_company_claim()` ou
`review_company_claim()` (toutes `SECURITY DEFINER`). `review_company_claim()`
vérifie `is_platform_admin()` **à l'intérieur** de la fonction (pas
seulement via la permission d'exécution SQL, accordée à `authenticated`
en général) : un appel par un non-administrateur échoue proprement, sans
aucun effet. Voir `docs/CLAIMING.md` pour le détail des garanties
anti-usurpation (§19 du cahier des charges Phase 7) et la raison de
chaque condition d'auto-approbation.

La compatibilité affichée sur une fiche publique (`getCompatibilityBetweenCompanies`)
réutilise `computeMatchScore` et `upsertMatch` tels quels (Phase 6) : les
mêmes règles de sécurité s'appliquent, sans code parallèle à auditer
séparément.

## Tests de sécurité réels (Phases 3 à 7)

Fichiers dans `tests/integration/` (`npm run test:integration`) exécutent des scénarios réels contre le vrai projet Supabase — pas de simulation locale, pas de mock : création de vrais utilisateurs de test, vraies tentatives d'action autorisée/interdite, vérification du résultat, puis suppression de toutes les données créées.

- `rls.test.ts` : comptes, entreprises, protection des champs sensibles.
- `offers-needs.test.ts` : offres/besoins par rôle (owner/admin/member/viewer/extérieur/visiteur), contraintes de données (catégorie invalide, pays invalide, produit inexistant), statut actif/inactif, contenu du journal d'audit.
- `opportunities.test.ts` : publication par rôle, visibilité des brouillons, réponse au nom d'une entreprise (jamais en son nom propre, jamais pour une entreprise inexistante ou étrangère), auto-réponse interdite, unicité de la réponse active, confidentialité des réponses (tiers/visiteur exclus), qui peut accepter/refuser/retirer, notifications, expiration administrable.
- `matching.test.ts` : cohérence métier (candidat compatible proposé, incompatibilité fondamentale éliminée, offre inactive exclue, opportunité expirée exclue malgré un statut encore `published`, persistance avec version d'algorithme), et sécurité (visibilité d'un match par les deux entreprises concernées, exclusion d'une entreprise tierce, accès administrateur, aucun accès anonyme, impossibilité pour une entreprise de modifier elle-même un score).
- `directory.test.ts` : recherche publique réelle (nom, accents, exclusion des entreprises non actives, pagination), revendication (auto-approbation à domaine fort, échec d'un courriel usurpé ne correspondant pas au compte réel, impossibilité de modifier `claim_status` directement, appel de `review_company_claim` par un non-administrateur sans effet, attribution correcte owner/admin selon l'historique de l'entreprise, refus n'accordant aucun droit), et compatibilité ciblée sur la fiche publique (persistée, invisible à un tiers).

pgTAP aurait nécessité une instance Postgres locale via Docker, indisponible dans cet environnement ; ces suites jouent le même rôle de preuve en frappant directement le projet distant.

**C'est la suite de la Phase 3 qui a permis de découvrir deux bugs réels** (voir `docs/DATABASE.md`, migrations 0011 et 0012) : la validation locale (base Postgres embarquée) ne pouvait pas les révéler, car elle s'exécute avec des droits complets et ne peut pas simuler l'application réelle de la RLS. Leçon retenue, appliquée dès la conception des Phases 4 et 5 : une politique de sécurité n'est vérifiée que lorsqu'elle a été testée avec de vraies requêtes, dans un vrai contexte d'authentification.

## Validation des entrées

Toute donnée fournie par un utilisateur (formulaire, import) doit être validée par un schéma Zod avant d'être utilisée — voir `src/validations/`.

## Gestion des erreurs affichées à l'utilisateur

Aucune page ne montre de trace technique, de message SQL brut ou de détail interne : `src/app/[locale]/error.tsx` capture les erreurs inattendues et n'affiche qu'un message générique (le détail est uniquement journalisé côté serveur, `console.error`, jamais envoyé au navigateur). Les erreurs de formulaire (identifiants invalides, courriel non confirmé...) sont traduites en messages compréhensibles, jamais renvoyées telles quelles.

## Ce qui n'est pas encore fait (attendu, pas un oubli)

- Limitation de fréquence (anti-abus) sur les formulaires publics (inscription, mot de passe oublié) : pas encore en place.
- Connexion sociale (Google/LinkedIn/Microsoft) : reportée, comme demandé.
- Invitations de membres par courriel : structure en place (`company_members.status = 'invited'`), envoi non implémenté.
