# data/ — données brutes de sourcing

## Rôle de `data/raw/`

Ce dossier contient les fichiers issus d'un travail de sourcing et de structuration d'entreprises réalisé **avant** l'initialisation du dépôt applicatif (recherche d'entreprises françaises et québécoises, uniformisation, prototype de matching, journaux de progression). Ce sont des **données métier sources**, pas du code.

```
data/raw/
  france/     sourcing des entreprises françaises (objectif 5 000), sources et journal associés
  quebec/     sourcing des entreprises québécoises (objectif 2 000), sources et journal associés
  matching/   bases uniformisées France-Québec, prototype de matching, gabarits besoins/offres/opportunités
```

## Ces fichiers ne sont PAS versionnés dans Git

`data/raw/` est exclu via `.gitignore`. Raisons :

- volume (fichiers CSV/Excel pouvant contenir plusieurs milliers de lignes) ;
- contenu potentiellement sensible (coordonnées d'entreprises, parfois nominatives) ;
- nature de brouillon de travail, appelée à changer fréquemment sans intérêt à en garder l'historique dans le code.

Seul ce fichier `data/README.md` est versionné, pour que la présence et le rôle de ce dossier restent documentés même si son contenu n'est pas dans Git.

## Ce que ces données sont devenues (état réel, Phase 8 — plus "Phase 10")

Le **pipeline d'import est construit** (`src/lib/import/`, voir
`docs/IMPORT_PIPELINE.md`) et a déjà servi à un import réel et contrôlé.
Ce chantier a été avancé de la Phase 10 initialement prévue à la Phase 8,
sur décision explicite du propriétaire du projet — toute mention d'une
« Phase 10 » pour ce pipeline ailleurs dans la documentation est
obsolète.

`data/raw/` reste la source **immuable** : jamais modifiée, renommée ni
lue en écriture par le pipeline. Le cycle de vie réel d'une ligne
source :

1. **`data/raw/`** (ce dossier) — immuable, jamais lu autrement qu'en
   lecture seule par le pipeline.
2. **Zone de préparation** — contrairement à un dossier `data/staging/`
   sur le système de fichiers, la préparation se fait dans une table
   Supabase, `staging_companies` (une ligne source normalisée + ses
   éventuels problèmes de validation/doublons), jamais directement dans
   `companies`. Voir `docs/IMPORT_PIPELINE.md`.
3. **Import réel** — seules les lignes validées, non dupliquées et
   couvertes par une source dont la licence autorise l'usage commercial
   deviennent des lignes `companies` (toujours en statut `draft`,
   jamais publiques par défaut — voir `docs/PRIVACY.md`).
4. **Produits dérivés (rapports)** — les rapports d'audit ou de
   vérification (ex. `docs/reports/rapport-siren-87.json`, la
   vérification SIRENE des entreprises non importées) vivent sous
   `docs/reports/`, pas sous `data/` : ce sont des documents de suivi du
   projet, versionnés, distincts des données sources brutes.

Chaque lot importé a été, avant import :

1. **validé** — cohérence des champs, format, complétude minimale ;
2. **dédoublonné** — par rapprochement (nom légal, pays, code postal, domaine du site web), avec validation manuelle en cas de doute, jamais de fusion automatique (voir `PROJECT_SPEC.md` §12) ;
3. **qualifié** — chaque entreprise importée est rattachée à une source tracée (`data_sources`, `company_source_records` — voir `docs/DATA_SOURCES.md`) ;
4. couvert par une **licence ou une base juridique compatible** avec l'usage prévu (revente indirecte de coordonnées d'entreprises sur une plateforme commerciale) — vérifiée source par source avant import, jamais après (garde-fou technique en base, pas seulement une procédure).

**État réel au 2026-09-20** : 13 entreprises françaises importées
(lot pilote `FRANCE_PILOT_001`), 3 publiées. Les 87 entreprises
françaises restantes du fichier `france/entreprises_france_5000.csv`
n'ont pas été importées, faute d'identification suffisamment fiable
(aucun SIREN exploitable dans la source). Aucune entreprise québécoise
n'a été importée, faute de source dont la licence couvre explicitement
un usage commercial (voir `docs/QUEBEC_SOURCING_STRATEGY.md`).

## Fichiers historiques de besoins/offres — jamais des intentions réelles

`data/raw/matching/france_quebec_besoins.csv` et `_offres.csv` (voir
`docs/DATA_INVENTORY.md` §5) contiennent des besoins/offres **déduits
automatiquement** (données inférées, jamais confirmées) du profil de
chaque entreprise lors du travail de sourcing antérieur — jamais déclarés
par l'entreprise elle-même. Ils restent classés `DO_NOT_IMPORT` dans le
registre des sources (`docs/DATA_SOURCES.md`, le seul statut réellement
utilisé pour ces deux fichiers) et ne sont mappés vers aucune table
applicative (`company_offers`, `company_needs`). Ils ne représentent
**jamais** une intention commerciale réelle d'une entreprise, quel que
soit leur contenu.

## Remarque

Le dossier `data/raw/matching/` contient deux fichiers `france_quebec_bases_uniformisees.xlsx` et `france_quebec_bases_uniformisees (1).xlsx` strictement identiques (même contenu, vérifié par somme de contrôle). Aucun des deux n'a été supprimé par prudence — à nettoyer manuellement si confirmé inutile.
