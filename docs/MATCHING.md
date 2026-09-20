# Moteur de matching (Phase 6)

Ce document explique le fonctionnement du moteur de correspondance
déterministe entre entreprises, et entre opportunités et entreprises.
Aucune IA, aucun embedding, aucune recherche sémantique dans cette
version — voir §Évolutivité pour le point d'entrée déjà réservé pour ça.

## 1. Deux types de matching, un seul moteur

- **Entreprise ↔ entreprise** : compare le **BESOIN** d'une entreprise à
  l'**OFFRE** d'une autre. Jamais besoin↔besoin, jamais offre↔offre.
- **Opportunité ↔ entreprise** : une opportunité `seeking` ("Nous
  recherchons") se comporte comme un besoin et se compare aux **offres**
  d'autres entreprises ; une opportunité `offering` ("Nous proposons") se
  comporte comme une offre et se compare aux **besoins** d'autres
  entreprises.

Ces quatre cas (besoin, offre, opportunité-seeking, opportunité-offering)
sont réduits à une même forme, `MatchableIntent`
(`src/lib/matching/types.ts`), pour qu'**un seul et même moteur de
scoring** (`src/lib/matching/scoring.ts`) les traite tous — voir §3.

## 2. Architecture : génération de candidats, puis scoring

Deux étapes distinctes, jamais mélangées (voir §Performance) :

1. **Génération de candidats** (`src/lib/matching/candidateGeneration.ts`,
   SQL via Supabase) : filtre grossièrement AVANT tout calcul détaillé —
   compatibilité de capacité (table `capability_compatibility`), statut
   actif de l'offre/du besoin/de l'opportunité, statut actif de
   l'entreprise, exclusion de l'entreprise elle-même. Utilise le client
   serveur normal (pas la clé secrète) : les offres/besoins actifs
   d'entreprises actives sont déjà publics par RLS.
2. **Scoring** (`src/lib/matching/scoring.ts`, TypeScript pur, sans accès
   réseau) : calcule le score détaillé de CHAQUE candidat retenu à
   l'étape 1. 100 % testable unitairement (voir
   `tests/unit/matching/scoring.test.ts`), sans dépendre d'une base de
   données — c'est ce qui permet de vérifier les règles métier (§34) vite
   et de façon fiable.

L'orchestration (`src/lib/matching/service.ts`) enchaîne les deux étapes,
persiste le résultat (`src/lib/matching/persistence.ts`) et met en forme
l'affichage.

## 3. Matrice de compatibilité besoin ↔ offre

Table `capability_compatibility` (migration 0016), administrable sans
déploiement de code. Ne contient QUE les correspondances **croisées**
(codes différents mais compatibles) : la règle réflexive (même code =
compatibilité totale) est implicite, appliquée par le moteur plutôt que
dupliquée en 18 lignes redondantes.

Correspondances croisées actuelles (voir la migration pour le détail) :
DISTRIBUTOR↔DISTRIBUTION_CAPACITY, MANUFACTURER↔MANUFACTURING_CAPACITY,
MANUFACTURER↔SUBCONTRACTOR, SUBCONTRACTOR↔MANUFACTURING_CAPACITY,
SALES_AGENT↔COMMERCIAL_PARTNER, TECHNOLOGY_PARTNER↔LICENSING (ratio 0,6).

**Absence de ligne = 0 = incompatibilité fondamentale = ÉLIMINATION**
complète du candidat (pas un score de 0 affiché, voir §5).

## 4. Pondération (somme = 100)

| Critère                        | Poids | Justification courte                                |
| ------------------------------ | ----- | --------------------------------------------------- |
| Type de partenariat (capacité) | 30    | Cœur du besoin exprimé                              |
| Produit / secteur              | 20    | Pertinence commerciale concrète                     |
| Zone géographique              | 15    | Le marché visé doit correspondre                    |
| Capacité opérationnelle        | 10    | Signal de capacité réellement documentée            |
| Taille d'entreprise            | 5     | Préférence secondaire, rarement bloquante           |
| Certifications                 | 5     | Voir limite au §9                                   |
| Langue de travail              | 5     | Facilite la mise en relation, non bloquant          |
| Expérience export              | 5     | Bonus, jamais une pénalité d'absence                |
| Vérification                   | 5     | Confiance dans le profil, pas dans le fond du match |

## 5. Élimination vs score faible

Une incompatibilité de **capacité** (aucune ligne dans la matrice, ratio 0) élimine le candidat entièrement — il n'apparaît dans aucune liste, même
interne. C'est différent d'un score simplement bas (ex. mauvaise
géographie) : ce candidat reste calculé et persisté, mais sous le seuil
d'affichage (§8). Voir aussi les exclusions absolues au §7.

## 6. Données manquantes : stratégie unifiée

Chaque critère peut être :

- **evaluated** : donnée disponible des deux côtés, score réel (y compris
  0 si réellement incompatible, par exemple deux pays différents) ;
- **missing** : donnée absente ou non exploitable → un **ratio neutre**
  (50 % du poids du critère, sauf cas documentés dans le code où un ratio
  légèrement différent est justifié) est attribué — jamais 0, jamais le
  maximum, pour ne **pas pénaliser excessivement** un profil incomplet
  (§37 du cahier des charges) sans pour autant fabriquer un score qui
  n'existe pas.

Chaque critère "missing" réduit la **CONFIANCE** globale de son poids —
jamais le score au-delà de son ratio neutre. D'où la double lecture
affichée à l'utilisateur : `Compatibilité 82/100 — confiance élevée` vs
`Compatibilité 82/100 — données partielles` (même score, fiabilité
différente). Seuils de confiance : ≥90 % élevée, ≥70 % modérée, sinon
données partielles (`src/lib/matching/config.ts`).

## 7. Exclusions absolues (avant tout calcul)

- Même entreprise des deux côtés.
- Offre/besoin avec `status = 'inactive'`.
- Opportunité non `published`, ou **expirée** (`expires_at < now()`) même
  si son statut affiche encore `published` — l'expiration n'est pas
  recalculée par tâche de fond (voir docs/DATABASE.md, ATTENTION déjà
  documentée en Phase 5). Testé explicitement en intégration (§40).
- Entreprise `suspended`, `draft` ou `archived` (seul `active` est
  candidat).
- Incompatibilité de capacité (§5).

## 8. Niveaux de correspondance et seuil d'affichage

| Score  | Niveau       |
| ------ | ------------ |
| 90-100 | Très forte   |
| 75-89  | Forte        |
| 60-74  | Possible     |
| 40-59  | Faible       |
| 0-39   | Insuffisante |

**Seuil d'affichage : 60/100.** En dessous, un match n'apparaît dans
aucune liste visible par les utilisateurs, mais reste **persisté** en
base pour analyse interne (jamais supprimé) — voir `matches`/
`opportunity_matches`.

## 9. Limites connues (transparence, §43)

- **Certifications requises** : `company_needs` ne permet pas encore
  d'exprimer une certification EXIGÉE ; ce critère est donc toujours
  "missing" pour l'instant. Évolution possible : une table
  `company_need_required_certifications`.
- **Expérience export** : `companies.export_experience` vaut `false` par
  défaut, ce qui rend indiscernable "déclaré sans expérience" de "non
  renseigné" — traité comme non évaluable dans les deux cas, jamais comme
  une incapacité (voir §12 du cahier des charges).
- **Taille d'entreprise** : comparaison textuelle exacte
  (`employee_range`), pas de notion de tranches "proches" (nécessiterait
  de structurer ce champ en valeurs ordonnées).
- **Capacité opérationnelle** (critère 10 pts) : faute d'un signal dédié
  dans le schéma, ce critère utilise la présence de produits/services
  structurés rattachés à l'offre comme indicateur de capacité réellement
  documentée plutôt qu'imaginée — voir `src/lib/matching/scoring.ts`,
  `scoreCapacity`.

## 10. Persistance et version de l'algorithme

`matches` (entreprise↔entreprise) et `opportunity_matches`
(opportunité↔entreprise) stockent : score, confiance, détail du score
(`score_breakdown`, JSON — exception documentée au principe "pas de gros
JSON" du projet, car c'est un artefact d'explication propre à CE match,
pas une donnée métier qu'on filtre/agrège), `algorithm_version`
(`MATCH_V1` actuellement) et `calculated_at`. Une contrainte unique par
paire (need_id, offer_id) / (opportunity_id, candidate_company_id) fait
qu'un recalcul **remplace** l'ancien résultat (upsert), jamais n'empile de
doublons.

Écriture réservée à la clé secrète (`service_role`) : aucune politique RLS
n'autorise un client normal à insérer/modifier un score, pour qu'un score
ne puisse jamais être fabriqué depuis le navigateur. Un déclencheur
(`protect_match_score_fields`) bloque aussi toute tentative de modifier
score/confiance/détail via une simple mise à jour de ligne (seuls
statut/feedback restent modifiables par les entreprises concernées, ou
tout par un administrateur de la plateforme).

## 11. Stratégie de recalcul : à la lecture

Choix pour le MVP (§23 du cahier des charges — simplicité et fiabilité
priment) : **pas de déclencheur lourd sur chaque écriture**. Le moteur est
appelé directement par les Server Components des pages concernées
(profil entreprise, détail d'opportunité) à chaque consultation, et le
résultat est upserté comme sous-produit — toujours frais quand un
utilisateur regarde, sans infrastructure de file d'attente. Un coût
raisonnable pour le volume actuel ; à revoir si le nombre d'entreprises
actives grandit fortement (voir §12).

## 12. Performance à grande échelle

La génération de candidats filtre par capacité compatible (table
indexée), statut actif et exclusion de l'entreprise AVANT tout scoring
détaillé — jamais de comparaison exhaustive entreprise × entreprise.
Index dédiés sur `company_offers`/`company_needs`
(capability_type_code, status, target_country_code, industry_id) posés
dès la Phase 4. Au-delà de quelques dizaines de milliers d'entreprises
actives, il faudra probablement ajouter une limite de résultats
(`LIMIT`) et/ou pré-filtrer aussi par géographie côté SQL — non fait ici
tant que le volume réel ne le justifie pas (over-engineering évité).

## 13. Explication du score (jamais générée par IA)

Chaque match affiché propose "Pourquoi ce score ?" : le détail
critère-par-critère (`score_breakdown`), avec un indicateur visuel (✓
évalué positif, ✕ évalué à 0, △ donnée manquante). Entièrement dérivé du
calcul déterministe — aucun texte généré par un modèle de langage.

## 14. Vocabulaire imposé

**"Score de compatibilité"**, jamais "Probabilité de réussite" : ce score
mesure une adéquation structurelle entre profils déclarés, pas une
prédiction de succès commercial. Ce choix de mot est appliqué dans
`messages/fr.json`/`messages/en.json` (`Matching.scoreLabel`) et doit être
respecté dans tout futur ajout d'écran.

## 15bis. Utilisation depuis l'annuaire public (Phase 7)

`getCompatibilityBetweenCompanies()` (`src/lib/matching/service.ts`) ajoute
un troisième point d'entrée au moteur : une comparaison CIBLÉE entre deux
entreprises précises (utilisée sur la fiche publique d'une entreprise,
voir docs/DIRECTORY.md §8), en plus de `getPartnersForCompany` et
`getCompaniesForOpportunity`/`getOpportunitiesForCompany`. Elle réutilise
`computeMatchScore()` et `upsertMatch()` sans aucune divergence — le
résultat est persisté dans `matches` exactement comme n'importe quel autre
calcul du moteur, avec les mêmes règles de confidentialité. Volontairement
PAS utilisée dans la liste de résultats de l'annuaire (calculer un score
pour chaque carte d'une page de résultats répéterait le problème de
performance que le calcul ciblé cherche justement à éviter) — voir
docs/DIRECTORY.md §8/§9 pour la justification complète.

## 15. Évolutivité prévue (non construite dans cette phase)

- **Retour utilisateur sur un match** (`matches.feedback`,
  `opportunity_matches.feedback` : pertinent / pas pertinent / déjà en
  contact / pas intéressé) : colonnes déjà présentes, aucune UI ni logique
  d'ajustement automatique de l'algorithme — un retour utilisateur ne doit
  JAMAIS modifier silencieusement un poids ou un seuil.
- **Poids/seuils administrables** : déjà centralisés dans un seul fichier
  (`src/lib/matching/config.ts`) plutôt que dispersés — prêt pour une
  future interface d'administration sans refactoring.
- **Matching sémantique (IA)** : `companies.embedding vector(1536)`
  existe déjà depuis la Phase 2, réservé à un futur critère
  `SEMANTIC_SIMILARITY` — non utilisé dans cette phase, aucune donnée n'y
  est écrite.
- **Statistiques internes** (comptes, moyennes de scores) : non
  construites cette phase (§30 du cahier des charges : pas de tableau de
  bord requis pour le MVP) ; les données sont déjà interrogeables
  directement dans `matches`/`opportunity_matches` par un administrateur.
