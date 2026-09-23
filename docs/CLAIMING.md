# Revendication d'entreprise (Phase 7)

## 1. Principe

Une entreprise peut exister sur la plateforme sans qu'aucun utilisateur ne
lui soit rattaché — c'est le cas normal d'une entreprise **importée** (une
future Phase 10, ou une entreprise créée directement par un
administrateur). `company_claims` (migration 0018) trace les demandes
d'une personne affirmant représenter cette entreprise, jusqu'à leur
approbation ou leur refus.

**Toute écriture sur `company_claims` passe exclusivement par trois
fonctions SECURITY DEFINER** (`submit_company_claim`,
`cancel_company_claim`, `review_company_claim`) : il n'existe **aucune**
politique RLS d'insertion ou de mise à jour pour un client normal sur cette
table. Ce n'est pas une politique restrictive qu'on pourrait contourner —
il n'y a simplement aucun chemin possible pour modifier `status`
directement, quelle que soit la requête envoyée. Vérifié réellement dans
`tests/integration/directory.test.ts` (la validation locale pglite ne peut
pas le confirmer, elle tourne en superutilisateur — voir docs/SECURITY.md).

## 2. Statuts

`pending` → `verified` (méthode domaine reconnue mais pas encore
suffisante pour auto-approuver) → `approved` / `rejected`, ou `cancelled`
(retrait volontaire par le demandeur). Distinct de
`companies.verification_status` (confiance dans le PROFIL de l'entreprise,
Phase 3) — ne pas confondre les deux échelles.

## 3. Méthode A — domaine professionnel (auto-approbation conditionnelle)

`submit_company_claim()` auto-approuve **immédiatement** (statut
`approved`, rattachement `owner` dans la même transaction) si **toutes**
ces conditions sont réunies :

1. l'entreprise a un `professional_email` (table `company_contacts` depuis
   la Phase 10C/LOT 10C-3, jamais `companies` directement — voir
   `docs/SECURITY.md`) dont le domaine correspond EXACTEMENT à celui
   soumis par le demandeur dans le formulaire ;
2. ce domaine n'est pas un domaine grand public (gmail.com, outlook.com,
   hotmail.com, icloud.com, yahoo.com, live.com, aol.com, protonmail.com —
   liste fixe dans la fonction, à étendre si besoin) ;
3. le domaine de l'adresse de CONNEXION réelle du demandeur
   (`auth.users.email`, déjà confirmée par Supabase à l'inscription)
   correspond **aussi** à ce domaine — le champ soumis dans le formulaire
   n'est, lui, jamais vérifié indépendamment : un utilisateur pourrait y
   taper n'importe quoi. Ce croisement avec l'adresse de compte réelle
   empêche qu'un simple changement de valeur côté client suffise à obtenir
   une approbation (§19 du cahier des charges) ;
4. l'entreprise n'a **encore aucun membre** (`company_members` vide) —
   voir §5 ci-dessous.

Dans tous les autres cas, la demande reste `pending` (avec
`verification_method = 'domain_match'` si le domaine correspondait quand
même, pour information de l'administrateur) et attend un examen manuel.

## 4. Méthode B — vérification manuelle

Un administrateur de la plateforme consulte les demandes en attente sur
`/admin/revendications` (`/admin/claims` en anglais) — entreprise,
demandeur, courriel soumis, méthode, date, statut — et appelle
`review_company_claim(claim_id, 'approved' | 'rejected', notes?)`. Cette
fonction vérifie **elle-même** `is_platform_admin()` en interne (pas
seulement via la permission d'exécution SQL) : un utilisateur normal peut
techniquement appeler la fonction, mais elle échoue immédiatement sans
aucun effet — vérifié réellement en intégration.

## 5. Attribution du rôle (§18) : ne jamais déplacer un owner légitime

- Entreprise **sans membre** au moment de l'approbation (auto ou
  manuelle) : le demandeur devient `owner`.
- Entreprise **déjà membre(s)** : le demandeur approuvé devient `admin`,
  jamais `owner` — l'owner en place n'est **jamais** retiré ni rétrogradé
  par une revendication, qu'elle soit automatique ou manuelle. Une
  entreprise peut ainsi accumuler plusieurs demandeurs légitimes
  (plusieurs personnes de la même entreprise) sans jamais réattribuer la
  propriété d'origine.

## 6. Anti-usurpation (§19) — récapitulatif des garanties

| Scénario                                               | Protection                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Utilisateur A revendique arbitrairement l'entreprise B | Autorisé à SOUMETTRE (`pending`), mais n'obtient AUCUN droit tant qu'un admin (ou la méthode A stricte) n'approuve pas     |
| Domaine différent de celui du compte réel              | Jamais d'auto-approbation (voir §3, condition 3) — testé réellement                                                        |
| Changement de paramètre côté navigateur                | Le formulaire n'envoie que `professional_email`/`justification` ; `status` est calculé côté serveur, jamais reçu du client |
| Auto-approbation par l'utilisateur lui-même            | Aucune politique RLS ne permet une écriture directe (§1)                                                                   |
| Modification directe de `claim_status`                 | Structurellement impossible (§1)                                                                                           |
| Approbation par un non-administrateur                  | `review_company_claim()` vérifie `is_platform_admin()` en interne                                                          |
| Revendication refusée                                  | Aucune ligne `company_members` créée                                                                                       |

## 7. Entreprise importée → revendiquée → protection contre un futur réimport (§23)

`companies.claimed_at` (migration 0018) passe de `null` à la date
d'approbation dès qu'une revendication aboutit — première ou suivante.
Pas de système de versioning complet construit cette phase (aurait été
disproportionné pour le besoin actuel), mais ce marqueur suffit à poser la
règle pour la future Phase 10 (import massif) : **un réimport ne doit
jamais écraser aveuglément une entreprise dont `claimed_at` n'est pas
`null`** — un futur pipeline d'import devra vérifier ce champ et, le cas
échéant, proposer les nouvelles données comme une SUGGESTION à valider
plutôt que les appliquer directement. Cette règle est documentée ici pour
que la Phase 10 la respecte dès sa conception, mais aucun code d'import
n'existe encore pour l'appliquer.

## 8. Ce qui n'a pas été construit cette phase

- Rate limiting sur `submit_company_claim` (voir docs/SECURITY.md, déjà
  noté comme non fait pour les formulaires publics en général).
- Notification automatique à l'administrateur qu'une nouvelle demande
  attend un examen (la page `/admin/revendications` doit être consultée
  activement) — `notifications` existe déjà (Phase 5) mais son usage ici
  est laissé à une itération future si le volume de demandes le justifie.
