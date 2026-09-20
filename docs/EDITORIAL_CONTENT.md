# Contenu éditorial — règles de rédaction (Phase 8, suite)

Ce document encadre toute description rédigée par l'équipe France-Canada
Partners pour une entreprise **importée** (donc non revendiquée, sans
contenu propre) et marquée `company_translations.content_source =
'EDITORIAL'` (migration `0021_industry_code_mappings.sql`). Il ne
s'applique jamais à une entreprise revendiquée : un contenu
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

## 2. Sources acceptées

Par ordre de fiabilité :

1. Donnée officielle déjà en base (SIRENE : raison sociale, ville,
   forme juridique, code APE — jamais réécrite, seulement citée).
2. Site officiel de l'entreprise (uniquement pour des faits vérifiables
   — activité, implantation — jamais pour du texte copié).
3. Publication institutionnelle fiable (registre professionnel,
   communiqué officiel, article de presse économique reconnu).

Les URL consultées sont conservées comme **référence éditoriale
interne** (traçabilité de la rédaction), sans obligation d'être
publiées sur la fiche elle-même.

## 3. Ce que ce document ne couvre pas

- Le contenu `SOURCE_PROVIDED` (texte repris tel quel d'une source dont
  la licence le permet explicitement) : non utilisé à ce jour, aucune
  source de ce projet ne le permet encore (voir migration 0021).
- Le contenu `COMPANY_PROVIDED` : régi par les conditions d'utilisation
  de la plateforme, pas par ce document.
