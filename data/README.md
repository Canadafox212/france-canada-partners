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

## Ce que ces données deviendront

Elles serviront de matière première au **pipeline d'import** (Phase 10 de `PROJECT_SPEC.md`), qui alimentera les tables `companies`, `company_needs`, `company_offers`, etc. **Ce pipeline n'est pas construit à ce jour** — ces fichiers ne sont ni lus ni importés par l'application pour l'instant.

Avant tout import réel, chaque lot de données devra être :

1. **validé** — cohérence des champs, format, complétude minimale ;
2. **dédoublonné** — par rapprochement (nom légal, pays, code postal, domaine du site web), avec validation manuelle en cas de doute, jamais de fusion automatique (voir `PROJECT_SPEC.md` §12) ;
3. **qualifié** — chaque entreprise importée doit être rattachée à une source tracée (`data_sources`, voir `PROJECT_SPEC.md` §4.8) ;
4. couvert par une **licence ou une base juridique compatible** avec l'usage prévu (revente indirecte de coordonnées d'entreprises sur une plateforme commerciale) — à vérifier source par source avant import, pas après.

## Remarque

Le dossier `data/raw/matching/` contient deux fichiers `france_quebec_bases_uniformisees.xlsx` et `france_quebec_bases_uniformisees (1).xlsx` strictement identiques (même contenu, vérifié par somme de contrôle). Aucun des deux n'a été supprimé par prudence — à nettoyer manuellement si confirmé inutile.
