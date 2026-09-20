# Pipeline d'import — conception proposée (Phase 8)

**Statut : PROPOSITION, RIEN N'EST ENCORE CONSTRUIT.** Ce document décrit
l'architecture que je propose de construire une fois l'audit
(`docs/DATA_INVENTORY.md`, `docs/DATA_MAPPING.md`, `docs/DATA_SOURCES.md`)
validé et l'autorisation donnée (voir le rapport présenté séparément). Ne
contient ni migration, ni script, ni table réellement créée à ce stade.

## 1. Principe général

```
data/raw/ (immuable)
   ↓ lecture seule
data/staging/ (fichiers intermédiaires, non versionnés)
   ↓ normalisation + validation
staging_companies (table SQL, un batch = un import_batches.id)
   ↓ dédoublonnage + scoring
   ↓ DRY RUN (rapport, aucune écriture dans companies)
   ↓ autorisation explicite
companies (status = 'draft', jamais 'active' directement)
```

Aucune ligne source ne passe jamais directement de `data/raw/` à
`companies` — le passage par `staging_companies` est obligatoire, avec un
`import_batches.id` qui rattache chaque ligne à son origine exacte
(fichier, batch, date).

## 2. Nouvelles tables proposées

### `import_batches`

id, source_id (FK `data_sources`), filename, country_code, started_at,
completed_at, status (`PENDING`/`VALIDATING`/`READY`/`IMPORTING`/
`COMPLETED`/`FAILED`/`CANCELLED`), rows_received, rows_valid,
rows_rejected, rows_created, rows_updated, rows_duplicates,
warnings_count, errors_count, dry_run (boolean), algorithm_version,
created_by (FK `profiles`).

### `staging_companies`

id, batch_id (FK `import_batches`), row_number (position dans le fichier
source, pour retrouver une ligne précise), raw_data (texte des colonnes
sources pertinentes — pas un import direct, juste la trace), mapped_data
(champs déjà normalisés/mappés), validation_status
(`VALID`/`WARNING`/`REJECTED`/`QUARANTINED`), duplicate_status
(`EXACT`/`VERY_LIKELY`/`POSSIBLE`/`UNLIKELY`/`NEW`), duplicate_of_company_id
(FK `companies`, nullable), created_company_id (FK `companies`, rempli
seulement après un import réel, jamais en dry run).

### `import_errors` / `import_warnings`

id, batch_id, staging_company_id (nullable si erreur de niveau fichier),
code, message, field_name (nullable), created_at. Séparés en deux tables
(plutôt qu'un seul niveau de sévérité) pour que les erreurs bloquantes
et les avertissements non bloquants restent faciles à distinguer dans
l'interface admin (§8 ci-dessous).

Toutes ces tables : RLS réservée aux administrateurs de la plateforme
(`is_platform_admin()`), aucun accès pour un utilisateur normal — voir
§39 du cahier des charges Phase 8 et `docs/SECURITY.md`.

## 3. Normalisation (avant tout scoring de doublon)

- **Espaces/casse** : `trim()` systématique, casse conservée pour
  l'affichage (jamais tout en majuscules), comparée en case-insensitive
  pour le dédoublonnage.
- **Jetons "valeur absente"** reconnus et convertis en `NULL` : `Non
disponible`, `Non applicable`, `à confirmer`, `à enrichir`, `N/A`,
  variantes de casse/accents (voir docs/DATA_INVENTORY.md §5, point 3) —
  liste centralisée dans un seul fichier de constantes, jamais dupliquée.
- **Domaine du site web** : `https://www.example.com/` → domaine
  comparable `example.com` pour le dédoublonnage, tout en conservant
  l'URL complète d'origine dans `companies.website` (§11 du cahier des
  charges).
- **Téléphone** : tentative de normalisation E.164 ; en cas d'échec, on
  conserve la valeur source telle quelle plutôt que de rejeter la ligne
  pour ce seul motif (§12).
- **Codes pays** : `France` → `FR`, `Canada - Québec` → `CA` (déjà fait
  dans `france_quebec_base_uniformisee.csv` via `Pays_Origine`, à
  généraliser pour des sources futures).
- Le principe directeur reste **§6 : ne jamais forcer une donnée** — une
  valeur ambiguë reste `NULL` plutôt que d'être devinée.

## 4. Dédoublonnage et score

Signaux, du plus fiable au moins fiable (§13/§14) :

| Signal                                             | Niveau si correspondance                                      |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Numéro d'entreprise officiel identique (SIREN/NEQ) | `EXACT`                                                       |
| Domaine de site web identique                      | `VERY_LIKELY`                                                 |
| Nom (légal ou commercial) + ville + adresse        | `VERY_LIKELY`                                                 |
| Nom + ville seulement                              | `POSSIBLE`                                                    |
| Nom seul                                           | `UNLIKELY` (jamais suffisant à lui seul, conformément au §13) |
| Aucune correspondance                              | `NEW`                                                         |

**Seul `EXACT` fusionnerait automatiquement** (et seulement en mode
non-dry-run, jamais en dry run) ; tout le reste (`VERY_LIKELY` compris)
serait marqué `QUARANTINED` pour arbitrage humain via l'interface admin —
choix délibérément prudent pour un premier pipeline, à assouplir plus
tard si l'expérience le justifie.

## 5. Dry run obligatoire

Une exécution `dry_run = true` :

1. lit le fichier source, applique normalisation + mapping + score de
   doublon, remplit `staging_companies` ;
2. **n'écrit jamais** dans `companies`/`company_locations`/etc. ;
3. produit un rapport (§7 ci-dessous) ;
4. reste consultable tant que le batch n'est pas explicitement relancé en
   mode réel par un administrateur.

Aucun import réel n'est possible sans qu'un dry run correspondant existe
d'abord pour le même fichier (contrainte applicative, pas seulement une
convention).

## 6. Protection d'une entreprise déjà revendiquée (§15/§16)

Si `staging_companies.duplicate_status` pointe vers une entreprise dont
`companies.claimed_at is not null` (voir Phase 7,
`docs/CLAIMING.md` §7) :

- **aucune mise à jour automatique** des champs modifiables par
  l'entreprise (description, offres, besoins, produits, coordonnées) ;
- seule une mise à jour de champs **officiels** clairement du ressort
  d'un registre (ex. `legal_name` si le SIREN/NEQ officiel diffère) reste
  candidate, et seulement signalée pour validation admin, jamais
  appliquée automatiquement ;
- documenté comme "priorité à la donnée revendiquée" : une donnée saisie
  par l'entreprise elle-même prime sur une donnée d'import, à l'exception
  de l'identité légale officielle qui reste mieux servie par le registre
  (§16 du cahier des charges — distinction explicitement demandée).

## 7. Rapport de dry run / import

Gabarit (voir §25 du cahier des charges) :

```
# Batch <identifiant>
Source : <nom de la source>
Lignes reçues : N
Valides : N (dont N avec avertissement)
Rejetées : N — principales causes : ...
Doublons EXACT (fusionnés) : N
Doublons VERY_LIKELY/POSSIBLE (mis en quarantaine) : N
Nouvelles entreprises candidates : N
Avertissements : N — principales causes : ...
```

## 8. Interface admin minimale (`/admin/imports`)

Même esprit que `/admin/revendications` (Phase 7) : liste des batches,
création d'un batch (choix de la source + du fichier **déjà présent
localement**, pas d'upload navigateur — voir §27 : plus sûr, les fichiers
existent déjà sur cette machine), lancement d'un dry run, consultation du
rapport/erreurs/doublons, autorisation d'import réel, annulation. Pas
d'outil ETL visuel complet.

## 9. Garde-fou de licence (§37)

Le lancement d'un batch (dry run compris, pour rester cohérent avec
`docs/DATA_SOURCES.md`) vérifierait le statut de la `data_sources`
rattachée : `commercial_use_allowed = false` ou statut `UNKNOWN`/
`REVIEW_REQUIRED` **bloquerait le batch par défaut**. Un override
resterait possible mais réservé à un administrateur, avec une raison
obligatoire consignée dans `audit_logs` — jamais silencieux.

## 10. Rollback (§30)

Chaque entreprise créée par un import porte son `import_batches.id`
d'origine (via `company_source_records` ou une colonne dédiée) : un
rollback consiste à identifier toutes les entreprises/`company_source_records`
liées à un batch donné et à les traiter (suppression si non revendiquées
et non modifiées depuis, ou signalement pour traitement manuel sinon).
Pas de bouton "rollback" automatique complexe cette phase — la
traçabilité du batch est ce qui rend un rollback manuel possible et sûr.

## 11. Performance (§42)

Insertion par lots (transactions groupées, pas une requête par ligne),
index sur les colonnes de dédoublonnage (numéro d'entreprise officiel,
domaine du site), toujours dans le respect du principe "ne
sur-optimise pas avant mesure" déjà appliqué dans ce projet — pas de
tuning spéculatif avant d'avoir un vrai volume à traiter.

## 12. Ce que cette proposition ne couvre pas encore

- Choix définitif des tranches `employee_range` pour la normalisation des
  effectifs (à faire une fois le mapping validé).
- Table de correspondance secteur source → `industries.id` (à construire
  manuellement, petit volume actuel).
- Rapprochement produits/services vers la taxonomie structurée
  (`products_services`) — texte libre conservé en staging en attendant.
- Interface d'upload s'il fallait un jour accepter des fichiers apportés
  par un tiers (hors périmètre : §27 privilégie explicitement les
  fichiers déjà locaux pour ce MVP).
