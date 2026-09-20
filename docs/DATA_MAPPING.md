# Correspondance des colonnes sources → modèle interne (Phase 8)

Ce document ne présuppose aucun import réel — il documente comment CHAQUE
colonne source se rattacherait au modèle existant (`PROJECT_SPEC.md` §4),
et ce qui ne se rattache PAS proprement (§6 du cahier des charges Phase 8 :
"ne pas forcer les données"). Basé sur `entreprises_france_5000.csv` (78
colonnes) et `entreprises_quebec_lot1_100.csv` (46 colonnes) — le fichier
unifié `france_quebec_base_uniformisee.csv` combine les deux schémas sans
en changer la substance.

## 1. Identité et coordonnées (`companies`)

| Colonne source (FR) | Colonne source (QC)                   | Champ cible                                                | Note                                                                                                                                                                                     |
| ------------------- | ------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Nom_Entreprise`    | `Nom_Entreprise`                      | `companies.display_name`                                   | Direct                                                                                                                                                                                   |
| `Raison_Sociale`    | — (absent)                            | `companies.legal_name`                                     | Québec : à défaut, repli sur `display_name` (déjà la règle utilisée par `create_company()`)                                                                                              |
| `SIREN`/`SIRET`     | —                                     | `companies.company_registration_number`                    | Voir §5 (normalisation) ; Québec attend un NEQ, actuellement non renseigné (voir docs/DATA_INVENTORY.md §3)                                                                              |
| `Site_Web`          | `Site_Web`                            | `companies.website`                                        | Normalisation domaine, voir §4                                                                                                                                                           |
| `Telephone`         | `Telephone`                           | `companies.phone`                                          | Normalisation, voir §5                                                                                                                                                                   |
| `Email`             | `Email`                               | `companies.professional_email` **si générique uniquement** | Voir §6 — jamais une adresse nominative                                                                                                                                                  |
| `Pays`              | (déduit du pays d'origine du fichier) | `companies.country_code`                                   | `France` → `FR`, `Canada - Québec` → `CA` (table `france_quebec_base_uniformisee.csv` a déjà ce mapping fait via `Pays_Origine`)                                                         |
| `Effectifs`         | `Employes`                            | `companies.employee_range`                                 | Format texte libre côté source ; à normaliser vers les tranches déjà utilisées ailleurs dans l'app (ex. "10-49") — valeurs sources à inspecter avant de fixer la table de correspondance |
| `Exportateur`       | `Exportateur`                         | `companies.export_experience`                              | Booléen à déduire (`Oui`/`Non`/valeur absente → laisser `false` par défaut, ne jamais déduire `true` d'une absence)                                                                      |
| —                   | —                                     | `companies.status`                                         | **Toujours `draft`** à l'import (voir §22 du cahier des charges : `IMPORTED_DRAFT`), jamais `active` directement                                                                         |
| —                   | —                                     | `companies.verification_status`                            | Reste `unverified` — la Phase 9 (vérification) est explicitement hors périmètre ici                                                                                                      |
| `Chiffre_Affaires`  | `Chiffre_Affaires`                    | _(pas de champ cible actuel)_                              | Aucune colonne `companies.revenue_range` alimentée par un import automatique n'est prévue cette phase ; conserver en `staging` uniquement                                                |

## 2. Localisation (`company_locations`)

| Colonne source (FR) | Colonne source (QC) | Champ cible                                                                                                                               |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Adresse`           | `Adresse`           | `address_line_1`                                                                                                                          |
| `Code_Postal`       | `Code_Postal`       | `postal_code`                                                                                                                             |
| `Ville`             | `Ville`             | `city`                                                                                                                                    |
| `Region`            | `Region_Quebec`     | `region`                                                                                                                                  |
| `Pays`              | (déduit)            | `country_code`                                                                                                                            |
| —                   | —                   | `location_type = 'headquarters'`, `is_primary = true` (une seule adresse par fichier source, pas d'établissements secondaires documentés) |

`Departement` (France uniquement) n'a pas de colonne cible dédiée — pas
d'équivalent dans `company_locations` aujourd'hui ; à conserver en
`staging` pour ne pas perdre l'information, sans l'inventer côté
application.

## 3. Description (`company_translations`)

| Colonne source | Champ cible                                                                                                | Note                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Description`  | `company_translations.description` (locale `fr` pour la France, `fr` également pour le Québec francophone) | **Uniquement si la source du fait est autorisée** (§20 : jamais généré, jamais reformulé par IA) ; si absente, laisser vide — ne jamais synthétiser depuis le secteur |

Aucune colonne `tagline` distincte dans les fichiers sources — resterait
vide à l'import.

## 4. Secteur (`company_industries` / `industries`)

| Colonne source (FR)       | Colonne source (QC)       | Situation                                                                                                                           |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Secteur`, `Sous_Secteur` | `Secteur`, `Sous_Secteur` | Texte libre, **pas encore rattaché** à la table `industries` existante                                                              |
| `Code_APE` (France)       | `SCIAN` (Québec)          | Codes de nomenclature **officielle mais différente** (NAF/APE vs SCIAN/NAICS) — §18 du cahier des charges : ne jamais les confondre |

**Réalisé (migration `0021_industry_mapping_and_content_source.sql`)** :
`Code_APE`/`SCIAN` sont conservés tels quels dans
`staging_companies.raw_sector_code`, et une table de correspondance
`industry_code_mappings` (code officiel `NAF_APE`/`NAICS_SCIAN` →
`industries.id`, avec un niveau de confiance explicite) a été construite
**validée manuellement**, jamais par simple rapprochement de mot-clé.
Remplie à ce stade uniquement pour les 8 codes APE du lot pilote (13
entreprises françaises) — pas une généralisation à toute la nomenclature.

Un code trop générique pour être fiable pour toutes les entreprises qui
le partagent (ex. `70.10Z`, "activités des sièges sociaux") ne reçoit
JAMAIS de mapping global vers un secteur : il reste `REQUIRES_REVIEW`
dans `industry_code_mappings`, quelle que soit l'entreprise. Une
entreprise concernée peut néanmoins recevoir un secteur qui lui est
**propre**, via `company_industries.classification_source =
'EDITORIAL_VERIFIED'` (fondé sur les sources officielles de CETTE
entreprise, jamais sur le code seul) — voir `docs/EDITORIAL_CONTENT.md`
§4 pour la distinction complète entre mapping automatique de code et
classification éditoriale vérifiée par entreprise.

## 5. Produits/services, technologies, spécialités

| Colonne source                                                     | Situation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Produits`, `Services` (FR/QC), `Technologies`, `Specialites` (FR) | Texte libre, non structuré. Conformément au §19 du cahier des charges ("ne crée pas automatiquement des milliers de catégories uniques provenant de textes libres"), ces champs resteraient en **texte source non mappé** (`staging_companies`, jamais copiés directement dans `company_products_services`, qui exige un `product_service_id` référencé) tant qu'un travail de rapprochement vers la taxonomie `products_services` n'a pas été fait — hors périmètre de cette phase d'audit. |

## 6. Contacts nominatifs — jamais publiés automatiquement

| Colonne source                                                                                                                                 | Situation                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dirigeant`, `Responsable_Commercial`, `Responsable_Export`, `Responsable_International`, `Responsable_Developpement`, `Contact_Professionnel` | **Données personnelles potentielles.** Aucun champ `companies`/`company_locations` ne les accueille aujourd'hui, et aucun ne devrait le faire sans un mécanisme de consentement/visibilité dédié (voir `docs/PRIVACY.md`). Recommandation : ne jamais importer ces colonnes dans une table publique — au mieux, les conserver dans `staging_companies` pour un usage interne (ex. contacter l'entreprise pour lui proposer de revendiquer sa fiche), jamais affichées publiquement. |
| `Email` avec forme nominative (`prenom.nom@...`)                                                                                               | Même traitement — voir §21 du cahier des charges : distinguer générique (`info@`, `contact@`) de nominatif, et ne jamais publier ce dernier automatiquement. Observé sur au moins 5 lignes du lot Québec (voir docs/DATA_INVENTORY.md §3).                                                                                                                                                                                                                                          |

## 7. Score, classement, actualités, sources — non mappés au modèle métier

Colonnes `Score_International`, `Score_France_Quebec_Canada`,
`Classement_ABCD`, `Priorite`, `Actualite_1/2/3` (+ dates/sources),
`Type_Partenariat`, `Partenariat_*_Potentiel` : propres au travail de
sourcing lui-même (aide à la priorisation humaine), sans équivalent dans
le modèle applicatif actuel. À conserver dans `staging`/les fichiers
sources pour référence, jamais copiées dans une table métier — **ne pas
transformer un score de sourcing interne en un signal affiché aux
utilisateurs** (à ne pas confondre avec le score de compatibilité du
moteur de matching, Phase 6, qui répond à une logique entièrement
différente — voir aussi §35 du cahier des charges Phase 8).

## 8. Traçabilité de la source (`data_sources` / `company_source_records`)

| Colonne source                                                                                                | Champ cible                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Source_Principale`, `Sources_Secondaires`, `Source_Identite`, `Source_Sectorielle`, `URL_Source_Sectorielle` | `company_source_records.raw_reference` (texte simple, pas de JSON — cohérent avec la contrainte déjà en place) + rattachement à une ligne `data_sources` par source nommée (à créer : "Annuaire des Entreprises / API Recherche d'entreprises", "GIFAS", "REAI", etc. — voir docs/DATA_SOURCES.md pour la liste et leur statut) |
| `Date_Verification`                                                                                           | `company_source_records.last_verified_at`                                                                                                                                                                                                                                                                                       |
| `Niveau_Verification` (FR, échelle 1/5 à 5/5)                                                                 | Pas d'équivalent direct — à documenter comme métadonnée de confiance interne, distincte de `companies.verification_status` (qui répond à une logique de vérification propre à la plateforme, pas à celle du sourcing d'origine)                                                                                                 |
| (identifiant de lot)                                                                                          | `company_source_records.source_record_id` + futur `import_batches.id` (voir docs/IMPORT_PIPELINE.md)                                                                                                                                                                                                                            |

## 9. Ce qui NE serait PAS importé (rappel, voir docs/DATA_INVENTORY.md §5)

- `france_quebec_besoins.csv`/`_offres.csv` : déduits automatiquement, pas
  des données déclarées — aucun mapping vers `company_needs`/`company_offers`
  proposé cette phase.
- `france_quebec_matching_prototype.xlsx`/`matching_france_quebec_top500.csv` :
  prototype de score antérieur, aucun mapping vers `matches`.
- Toutes les colonnes de priorisation interne du sourcing (§7 ci-dessus).
