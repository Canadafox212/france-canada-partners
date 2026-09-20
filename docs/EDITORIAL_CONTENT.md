# Contenu éditorial — règles de rédaction (Phase 8, suite)

Ce document encadre toute description rédigée par l'équipe France-Canada
Partners pour une entreprise **importée** (donc non revendiquée, sans
contenu propre) et marquée `company_translations.content_source =
'EDITORIAL'` (migration `0021_industry_mapping_and_content_source.sql`).
Il ne s'applique jamais à une entreprise revendiquée : un contenu
`COMPANY_PROVIDED` n'est ni modifié ni remplacé par une rédaction
éditoriale.

## 1. Principe — jamais reproduit, jamais inventé

- **Jamais de copie ni de paraphrase** d'un texte trouvé sur le site
  officiel de l'entreprise ou toute autre source tierce. L'objectif
  n'est pas de contourner l'absence de licence sur ces textes (voir
  `docs/IMPORT_PIPELINE.md` §4bis) en les reformulant légèrement, mais
  de rédiger un texte **original**, fondé sur des faits vérifiables.
- **Une donnée inconnue reste inconnue.** Aucune invention de capacité de
  production, activité d'export, marchés desservis, certifications,
  effectif, produits, localisation ou partenariat en l'absence d'une
  source qui le confirme explicitement.
- Ton factuel, B2B, neutre — jamais promotionnel ("leader", "excellence",
  "innovant" sans fait vérifiable derrière). 50 à 100 mots.

## 2. Hiérarchie des sources (corrigée)

Par ordre de priorité, du plus fiable au moins fiable :

1. **Source officielle de l'entreprise** (site institutionnel, pages
   "à propos"/"activités" du groupe — uniquement pour des faits
   vérifiables, jamais pour du texte copié).
2. **SIRENE / source publique officielle** (raison sociale, ville, forme
   juridique, code APE — jamais réécrite, seulement citée).
3. **Autre source institutionnelle fiable** (registre professionnel,
   communiqué officiel, article de presse économique reconnu, publication
   d'une fédération professionnelle).
4. **Wikipédia** : jamais une source institutionnelle, jamais une source
   prioritaire lorsque l'information est vérifiable officiellement.
   Utilisable uniquement comme **piste de recherche éventuelle** — un
   point de départ pour identifier quoi chercher ensuite dans une source
   des rangs 1 à 3, jamais comme référence citée dans la fiche finale.

Un fait qui n'apparaît que sur Wikipédia et nulle part dans les rangs 1
à 3 est traité comme non vérifié et n'est pas publié.

L'URL exacte de chaque source réellement utilisée (rangs 1 à 3) est
conservée comme **référence éditoriale interne** (traçabilité de la
rédaction), sans obligation d'être publiée sur la fiche elle-même.

## 3. Effectifs et données administratives datées

Une tranche d'effectifs (ou toute autre donnée administrative sujette à
mise à jour périodique) provenant de la source SIRENE doit toujours être
présentée comme **la tranche disponible dans la source administrative à
la date de consultation**, jamais comme l'effectif exact actuel de
l'entreprise. Conserver la date de référence de la donnée lorsqu'elle
est accessible (ex. "tranche 2023, source Répertoire Sirene").

## 4. Mapping automatique vs classification éditoriale vérifiée

Deux mécanismes distincts, jamais confondus (voir migration
`0021_industry_mapping_and_content_source.sql`,
`company_industries.classification_source`) :

- **`CODE_MAPPING`** : le secteur d'une entreprise est déduit
  automatiquement, lors d'un import, d'une correspondance
  `industry_code_mappings` à confiance HIGH/MEDIUM pour son code APE/NAF
  déclaré. Rapide, mais seulement fiable quand le code lui-même décrit
  une activité réelle.
- **`EDITORIAL_VERIFIED`** : le secteur est une décision humaine propre
  à CETTE entreprise précise, fondée sur SES sources officielles à elle
  (jamais sur son seul code APE/NAF ni sur celui d'entreprises
  similaires). Utilisé notamment quand le code déclaré est un code de
  holding générique (ex. 70.10Z, "activités des sièges sociaux") qui ne
  permet aucun mapping automatique fiable — c'est le cas de SAFRAN dans
  le lot pilote : son code 70.10Z reste `REQUIRES_REVIEW` dans
  `industry_code_mappings` (aucun mapping global 70.10Z → un secteur
  quelconque), mais l'entreprise SAFRAN reçoit son propre secteur
  "Aéronautique et spatial" en `EDITORIAL_VERIFIED`, sourcé sur les
  pages officielles du groupe.

Cette distinction est structurelle (contrainte de cohérence en base,
`company_industries_classification_consistency`) : un rattachement
`CODE_MAPPING` exige une référence vers la ligne `industry_code_mappings`
qui l'a produit ; un rattachement `EDITORIAL_VERIFIED` n'en a jamais.
Elle sera réutilisée pour tout futur import (France, Québec, ou autre) :
un code générique/ambigu ne doit jamais forcer un secteur pour toutes
les entreprises qui le partagent, alors qu'une classification éditoriale
reste toujours spécifique à une entreprise précise.

## 5. Ce que ce document ne couvre pas

- Le contenu `SOURCE_PROVIDED` (texte repris tel quel d'une source dont
  la licence le permet explicitement) : non utilisé à ce jour, aucune
  source de ce projet ne le permet encore (voir migration 0021).
- Le contenu `COMPANY_PROVIDED` : régi par les conditions d'utilisation
  de la plateforme, pas par ce document.
