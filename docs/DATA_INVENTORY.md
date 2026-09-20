# Inventaire des données de sourcing (Phase 8)

Audit réalisé le 2026-09-19 sur le contenu de `data/raw/` (non versionné,
voir `data/README.md`). **Aucun fichier source n'a été modifié, renommé ou
supprimé** — cet inventaire est purement en lecture. Les chiffres ci-dessous
viennent d'une inspection réelle de chaque fichier (comptage de lignes,
lecture des en-têtes, échantillonnage), pas d'une estimation.

## 1. Vue d'ensemble

| Dossier              | Rôle                                   | Fichiers   | Volume total |
| -------------------- | -------------------------------------- | ---------- | ------------ |
| `data/raw/france/`   | Sourcing entreprises françaises        | 6 fichiers | ~646 Ko      |
| `data/raw/quebec/`   | Sourcing entreprises québécoises       | 8 fichiers | ~940 Ko      |
| `data/raw/matching/` | Bases unifiées + prototype de matching | 8 fichiers | ~4,5 Mo      |

**Constat important, à ne pas sous-estimer** : le nom des fichiers
(`entreprises_france_5000.csv`, `master_recherche_quebec_2000_progress.csv`)
fait référence à l'**objectif final**, pas au contenu actuel :

- **France** : 100 entreprises réellement présentes (lot 1 sur 50 lots
  prévus pour atteindre 5 000 — soit 2 % de l'objectif). Voir
  `journal_progression_france.md`/`progression.json`.
- **Québec** : 659 entreprises **candidates** identifiées (33 % de
  l'objectif de 2 000), dont seulement **100** réellement enrichies en
  détail (lot 1). Voir `journal_progression.md`.

Il n'y a donc **pas 7 000 entreprises prêtes à être importées** aujourd'hui,
mais 100 (France) + 100 (Québec, enrichies) + 559 (Québec, candidates
partielles seulement) = un socle de travail réel bien plus modeste, en
cours de constitution.

## 2. France (`data/raw/france/`)

| Fichier                         | Format          | Taille | Lignes de données                      | Colonnes | Rôle                                                                                      |
| ------------------------------- | --------------- | ------ | -------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `entreprises_france_5000.csv`   | CSV (UTF-8 BOM) | 143 Ko | 100                                    | 78       | Jeu de données canonique (lot 1)                                                          |
| `entreprises_france_5000.json`  | JSON            | 321 Ko | 100                                    | 78       | Export identique au CSV (mêmes clés, mêmes valeurs) — redondant, pas une source distincte |
| `entreprises_france_5000.xlsx`  | XLSX            | 159 Ko | 100 (feuille "Toutes les entreprises") | 78       | Même contenu que le CSV + 14 feuilles dérivées (voir §5)                                  |
| `journal_progression_france.md` | Markdown        | 1,5 Ko | —                                      | —        | Journal de méthode et d'avancement, très utile pour l'audit                               |
| `progression.json`              | JSON            | 3,6 Ko | —                                      | —        | État machine du processus de sourcing (listes déjà traitées, SIREN déjà enregistrés)      |
| `sources_recherche_france.csv`  | CSV             | 2,5 Ko | 10                                     | 7        | Registre des sources utilisées, avec droits de réutilisation par source                   |

**Qualité observée (lot de 100)** :

- **Correction (Phase 8, suite)** : contrairement à ce qui était noté
  ici initialement, seules les **13** lignes ayant une identité légale
  confirmée (`V3_Identite_Legale = "Oui"`, `Source_Identite = "Annuaire
  des Entreprises / SIRENE-RNE"`) ont un SIREN/SIRET réellement renseigné.
  Les **87** autres portent la valeur littérale `"Non disponible"` dans
  les colonnes `SIREN`/`SIRET`/`Code_APE` — aucun identifiant officiel
  exploitable. Confirmé par `scripts/verify-siren-87.ts` (lecture seule,
  aucun import), rapport détaillé dans `docs/reports/rapport-siren-87.json` :
  une recherche par nom (moins fiable qu'un SIREN, jamais suffisante pour
  un import) identifie un candidat officiel unique pour 40 des 87
  entreprises, plusieurs candidats homonymes pour 37, et aucun résultat
  plausible pour 10 — dans tous les cas, statut `AMBIGUOUS`, jamais promu
  `CONFIRMED` sans identifiant source pour trancher.
- Aucun doublon de SIREN ni de nom dans le lot.
- Courriel présent pour seulement 1 entreprise sur 100 (99 % `Non
disponible`) — l'essentiel des coordonnées de contact reste à
  compléter, pas à inventer.
- Répartition sectorielle propre et restreinte (5 secteurs, voir
  `docs/DATA_MAPPING.md`).
- Classement de priorité interne (`Classement_ABCD`) : 54 A, 34 B, 12 C, 0 D.

## 3. Québec (`data/raw/quebec/`)

| Fichier                                      | Format   | Taille | Lignes de données                      | Colonnes | Rôle                                                                                                     |
| -------------------------------------------- | -------- | ------ | -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `entreprises_quebec_lot1_100.csv`            | CSV      | 116 Ko | 100                                    | 46       | Sous-ensemble pleinement enrichi (100 sur 659 candidats)                                                 |
| `entreprises_quebec_lot1_100.json`           | JSON     | 227 Ko | 100                                    | 46       | Export identique au CSV — redondant                                                                      |
| `entreprises_quebec_lot1_100.xlsx`           | XLSX     | 93 Ko  | 100 (feuille "Toutes les entreprises") | 46       | Même contenu + 10 feuilles dérivées                                                                      |
| `journal_progression.md`                     | Markdown | 1,8 Ko | —                                      | —        | Journal de méthode et d'avancement                                                                       |
| `master_recherche_quebec_2000_progress.csv`  | CSV      | 397 Ko | 659                                    | 29       | Liste **candidate** complète (identification, pas encore enrichie) — contient les 100 du lot 1           |
| `master_recherche_quebec_2000_progress.xlsx` | XLSX     | 89 Ko  | 659                                    | 29       | Même contenu que le CSV correspondant                                                                    |
| `sources_recherche_lot1.csv`                 | CSV      | 3,5 Ko | 26                                     | 5        | Registre des sources utilisées — **sans colonne de droits de réutilisation** (contrairement à la France) |

**Confirmé par test direct** : les 100 noms d'entreprise de
`entreprises_quebec_lot1_100.csv` sont bien un sous-ensemble exact des 659
de `master_recherche_quebec_2000_progress.csv` (recoupement à 100 %) — ce
sont deux étapes du même travail, pas deux jeux distincts.

**Qualité observée** :

- Aucune ligne (0 sur 659) n'a d'identifiant légal officiel (NEQ) confirmé
  — le champ `Identifiant_Principal` du fichier unifié affiche
  "Non disponible" pour l'échantillon vérifié, et `Type_Identifiant`
  indique explicitement "NEQ (à enrichir)".
- Aucun doublon de nom dans le lot 1.
- Courriel présent pour 14 entreprises sur 100 dans le lot 1, dont au
  moins 5 visiblement **nominatifs** (prénom.nom@...) — donnée
  personnelle potentielle, à traiter avec prudence (§21 du cahier des
  charges, voir `docs/DATA_MAPPING.md` §6).
- Classement de priorité interne (lot 1) : 43 A, 43 B, 14 C, 0 D.

## 4. Matching / bases unifiées (`data/raw/matching/`)

| Fichier                                     | Format | Taille  | Lignes de données               | Colonnes | Rôle                                                                                                                                                              |
| ------------------------------------------- | ------ | ------- | ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `france_quebec_base_uniformisee.csv`        | CSV    | 1,2 Mo  | 759                             | 87       | France (100) + Québec (659) fusionnés dans un schéma commun                                                                                                       |
| `france_quebec_bases_uniformisees.xlsx`     | XLSX   | 561 Ko  | 759                             | 87       | Export du même contenu                                                                                                                                            |
| `france_quebec_bases_uniformisees (1).xlsx` | XLSX   | 561 Ko  | 759                             | 87       | **Copie strictement identique** du fichier précédent (déjà signalé dans `data/README.md`) — à supprimer manuellement si confirmé inutile, aucune action prise ici |
| `france_quebec_besoins.csv`                 | CSV    | 1,05 Mo | 1 999                           | 24       | Besoins **déduits automatiquement** du profil de chaque entreprise — voir avertissement §5                                                                        |
| `france_quebec_offres.csv`                  | CSV    | 1,3 Mo  | 2 509                           | 22       | Offres **déduites automatiquement** — même avertissement                                                                                                          |
| `france_quebec_opportunites_template.csv`   | CSV    | 388 o   | **0** (en-tête seul)            | 26       | Gabarit vide, aucune donnée à traiter                                                                                                                             |
| `france_quebec_matching_prototype.xlsx`     | XLSX   | 214 Ko  | 500 (feuille "Top 500 matches") | 21       | Prototype de scoring **antérieur et distinct** du moteur de matching réel (Phase 6) — voir §5                                                                     |
| `matching_france_quebec_top500.csv`         | CSV    | 330 Ko  | 500                             | 21       | Export CSV du même prototype                                                                                                                                      |

## 5. Avertissements critiques à ne PAS ignorer avant tout mapping/import

1. **`france_quebec_besoins.csv` et `france_quebec_offres.csv` ne sont
   PAS des besoins/offres déclarés par les entreprises.** Chaque ligne
   porte `Statut_Source = "Déduit"` et un commentaire explicite : _"Ne
   constitue pas une demande active tant que l'entreprise ne l'a pas
   confirmée"_ (besoins) / _"À confirmer avec l'entreprise avant
   affichage comme offre déclarée"_ (offres). Les importer tels quels
   dans `company_needs`/`company_offers` violerait directement le §35 du
   cahier des charges Phase 8 ("ne génère pas artificiellement des
   besoins/offres depuis le secteur") — **recommandation : ne pas
   importer ces deux fichiers comme données déclarées**. Piste conservée
   pour une phase d'enrichissement future : les proposer comme
   _suggestions à confirmer_ une fois l'entreprise revendiquée (§36).
2. **`france_quebec_matching_prototype.xlsx`/`matching_france_quebec_top500.csv`
   sont un prototype de scoring antérieur**, avec son propre barème
   (`Score_Secteur`, `Score_Activites`, `Score_Partenariat`,
   `Score_International`, `Score_Signal_Bilateral`,
   `Score_Verification`) — différent et non compatible avec le moteur
   réel construit en Phase 6 (`src/lib/matching/`). À conserver comme
   référence historique uniquement ; **ne pas importer dans
   `matches`/`opportunity_matches`**.
3. **Valeurs "vides" représentées par du texte, pas par des cellules
   vides** : `Non disponible`, `Non applicable`, `à confirmer`, `à
enrichir`, `N/A` apparaissent comme de vraies chaînes de caractères
   dans les colonnes. Un import naïf les traiterait comme des valeurs
   réelles au lieu de `NULL`. Toute normalisation future doit reconnaître
   cette liste de jetons.

## 6. Feuilles supplémentaires des fichiers XLSX

Chaque classeur France/Québec contient, en plus de la feuille "Toutes les
entreprises" (identique au CSV), des feuilles **dérivées** (filtres/vues,
pas de données supplémentaires) : `Potentiel A/B/C/D` (classement),
`Canada`/`Québec`/`France-Europe` (filtres géographiques),
`Exportateurs`, `Secteurs`, `Régions`, `Actualités`, `Sources`,
`Méthodologie`, `Contrôle qualité`, `Plan 5000`. Le classeur de matching
contient des vues similaires (`Top 3 par France`, `Top 2 par Québec`,
`Barème matching`, `Tableau de bord`). Aucune de ces feuilles ne semble
contenir de lignes d'entreprises absentes du CSV correspondant — non
vérifié feuille par feuille de façon exhaustive (hors du périmètre d'un
simple audit), mais les noms de feuilles et les effectifs annoncés dans
les journaux de progression n'indiquent aucune donnée cachée. **Le CSV
reste la source canonique retenue pour tout futur pipeline.**

## 7. Recoupement avec les données déjà en ligne

Aucun chevauchement attendu ni observé entre ces fichiers et les données
actuellement présentes dans le projet Supabase réel : seules les 3
entreprises `[DEMO]` (Phase 4) et des artefacts de test systématiquement
nettoyés par les suites `tests/integration/` y figurent. Le vrai test de
dédoublonnage n'aura de sens qu'au moment d'un import réel.
