# Pipeline d'import — architecture construite (Phase 8)

**Statut : CONSTRUIT et testé (migration `0020_import_pipeline.sql` +
`src/lib/import/` + `scripts/import-companies.ts`).** Le lot pilote (13
entreprises françaises) a été traité en **dry run uniquement** — voir le
rapport livré séparément. Aucun import réel n'a été exécuté sans
autorisation explicite distincte (§12 de la demande).

## 1. Principe général

```
data/raw/ (immuable, jamais modifié)
   ↓ lecture seule (csv-parse)
mapping + normalisation (src/lib/import/columnMapping.ts, normalization.ts)
   ↓ validation (validate.ts) + dédoublonnage (dedup.ts, staging.ts)
staging_companies (un batch = un import_batches.id)
   ↓ DRY RUN : rapport, ARRÊT ICI (aucune écriture dans companies)
   ↓ import réel (--mode=real, séparé, jamais automatique)
companies (status = 'draft', jamais 'active' directement)
```

Aucune ligne source ne passe jamais directement de `data/raw/` à
`companies` — le passage par `staging_companies` est obligatoire.

## 2. Tables (migration 0020)

- **`data_sources`** (Phase 2, étendue) : `license_status`
  (`APPROVED_FOR_IMPORT`/`REVIEW_REQUIRED`/`DO_NOT_IMPORT`/`UNKNOWN`) et
  `commercial_use_allowed` — voir docs/DATA_SOURCES.md pour les sources
  déjà tranchées.
- **`import_batches`** : une exécution = une ligne (dry run et import réel
  sont deux batches SÉPARÉS, jamais le même batch muté — historique
  immuable). Compteurs : `rows_received`, `rows_valid`, `rows_warning`,
  `rows_quarantined`, `rows_rejected`, `rows_new` (aucune correspondance),
  `rows_existing` (EXACT, rattachées sans recréation), `rows_duplicates`
  (VERY_LIKELY/POSSIBLE/UNLIKELY, en quarantaine), `rows_created`,
  `rows_updated`.
- **`staging_companies`** : colonnes `raw_*` (valeur source telle quelle)
  ET `normalized_*` (valeur nettoyée) **séparées et typées**, pas un bloc
  JSON unique — voir §3 pour la justification. `raw_record` (jsonb) fait
  exception assumée : une copie brute complète de la ligne, pour l'audit
  humain d'un cas précis uniquement, jamais lue par une requête
  applicative (même principe que `matches.score_breakdown`, Phase 6).
- **`import_row_issues`** : une seule table avec une colonne `severity`
  (`WARNING`/`ERROR`) plutôt que deux tables séparées — un même code
  (ex. "URL invalide") peut en pratique être un avertissement dans un
  contexte et une erreur dans un autre ; centraliser simplifie le rapport
  sans perdre la distinction (toujours interrogeable par sévérité).
- **`import_duplicate_candidates`** : une ligne par correspondance
  possible trouvée, jamais fusionnée automatiquement sauf `EXACT`.
- **`company_source_records`** (Phase 2, étendue) : `import_batch_id`
  ajouté pour la traçabilité (§14).

## 3. Pourquoi des colonnes structurées, pas un gros JSON

Cohérent avec le principe déjà appliqué à tout le reste du projet (voir
docs/DATABASE.md "Rappels de conception") : chaque champ normalisé doit
pouvoir être filtré, indexé et comparé individuellement — retrouver
« toutes les lignes sans domaine de site », par exemple, ou indexer
`normalized_registration_number` pour le dédoublonnage (fait,
`staging_companies_registration_idx`). Un JSON unique aurait rendu ça
pénible et non indexable proprement. `raw_record` (jsonb) est
l'exception : il ne sert JAMAIS à une requête métier, seulement à un
humain qui inspecte une ligne précise pour comprendre ce qui n'a pas été
mappé — rôle différent, donc traitement différent.

## 4. Normalisation (`src/lib/import/normalization.ts`, pur, testé)

- Jetons de valeur absente (`Non disponible`, `Non applicable`, `à
confirmer`, `à enrichir`, `N/A`...) reconnus indépendamment de la
  casse/des accents et convertis en `NULL` — jamais traités comme une
  vraie valeur.
- Domaine du site web extrait (`https://www.example.com/` →
  `example.com`) tout en conservant l'URL complète pour affichage.
- Téléphone : tentative E.164 (France/Canada) ; échec → valeur source
  conservée, jamais un rejet pour ce seul motif.
- Codes pays : `France`/`Canada - Québec`/variantes → `FR`/`CA` ; valeur
  non reconnue → `NULL`, jamais devinée.
- La valeur `raw_*` d'origine n'est jamais écrasée par la normalisation —
  les deux colonnes coexistent toujours en staging.

## 5. Classification des courriels (`emailClassification.ts`, §6)

`GENERIC_BUSINESS` (contact@, info@...), `NAMED_BUSINESS`
(prenom.nom@...), `PUBLIC_PROVIDER` (gmail.com et la même liste de
domaines grand public que la revendication d'entreprise, Phase 7),
`INVALID`, `UNKNOWN`. **Seul `GENERIC_BUSINESS` est publié
automatiquement** dans `companies.professional_email` — vérifié dans le
pilote (voir rapport).

## 6. Dédoublonnage (`dedup.ts` + `staging.ts`)

| Signal                                       | Niveau                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| Numéro d'entreprise officiel identique       | `EXACT`                                              |
| Domaine de site web identique                | `VERY_LIKELY`                                        |
| Nom (légal ou commercial) + ville identiques | `POSSIBLE`                                           |
| Nom seul, sans autre corroboration           | `UNLIKELY` (jamais une preuve suffisante à lui seul) |
| Aucune correspondance                        | `NEW`                                                |

Recherche des candidats en 3 requêtes ciblées (numéro, puis domaine, puis
nom) contre `companies` existantes — jamais une requête par ligne pour
chaque candidat existant. Seul `EXACT` est rattaché automatiquement (pas
recréé) ; tout le reste passe en `QUARANTINED`, jamais fusionné
automatiquement (`commit.ts` lève une erreur explicite si on tente de
créer une ligne `VERY_LIKELY`/`POSSIBLE`/`UNLIKELY`).

## 7. Garde-fou de licence (§4 de la demande, §37 de l'original)

Appliqué **au niveau base de données** (déclencheur `before insert` sur
`import_batches`, pas seulement une vérification applicative) : un batch
sur une source `DO_NOT_IMPORT`/`UNKNOWN`/`commercial_use_allowed = false`
est bloqué à la création, dry run compris. Une dérogation exige
`license_override_justification` (texte) ET `license_override_by`
référençant un profil `platform_role = 'admin'` — sinon rejet. Une
dérogation valide est journalisée dans `audit_logs`
(`import_license_override`). **Aucune dérogation n'a été utilisée pour le
pilote** (source déjà `APPROVED_FOR_IMPORT`).

## 8. Politique de priorité des champs (§9 de la demande)

### Identité légale

La source officielle (SIRENE pour la France) peut mettre à jour : nom
légal, numéro d'entreprise officiel, statut légal — **au moment de la
vérification des 87 entreprises restantes** (voir §15 de la demande,
étape suivante, pas construite cette phase). Pour le pilote (import
initial), ces champs sont simplement CRÉÉS, la question de mise à jour ne
se pose pas encore.

### Contenu commercial

Une entreprise **revendiquée** (`companies.claimed_at is not null`,
Phase 7) contrôle : description, tagline, produits/services, offres,
besoins, opportunités, logo. **Un réimport ne doit jamais écraser ces
champs** — non applicable au pilote (aucune des 13 entreprises n'existe
déjà), mais la règle est actée pour toute évolution future du pipeline
(`commit.ts` ne fait aujourd'hui AUCUNE mise à jour de ces champs sur une
entreprise existante, uniquement une création ou un rattachement de
traçabilité sur `EXACT`).

### Contact

Un courriel `NAMED_BUSINESS` ou `PUBLIC_PROVIDER` n'est jamais publié
automatiquement (§5). Les contacts nominatifs (dirigeant, responsable
commercial...) ne sont pas mappés vers une table publique du tout — voir
docs/DATA_MAPPING.md §6.

## 9. Dry run et rapport

`npm run import:dry-run` (voir `scripts/import-companies.ts`) : lit,
normalise, valide, cherche les doublons, écrit `staging_companies` +
`import_row_issues` + `import_duplicate_candidates`, mais **n'appelle
jamais `commit.ts`** — `companies` reste inchangée, vérifié par test
d'intégration réel (voir `tests/integration/import.test.ts`). Produit un
rapport lisible (`report.ts`) : lignes reçues/valides/en
avertissement/en quarantaine/rejetées, nouvelles/existantes/doublons,
détail ligne par ligne, anomalies, doublons candidats.

## 10. Import réel (`npm run import:run`)

Crée un **nouveau batch** (`dry_run = false`), répète le même traitement,
puis commit (`commit.ts`) chaque ligne éligible : `NEW` + statut
`VALID`/`WARNING` → création ; `EXACT` → rattachement de traçabilité sans
recréation ; tout le reste → erreur explicite (ne devrait jamais être
tenté, protection en profondeur). Chaque entreprise créée : `status =
'draft'` (jamais publiée automatiquement, §13/§22), `company_locations`
si adresse disponible, `company_translations` si description disponible,
`company_source_records` avec `import_batch_id` pour la traçabilité
complète (§14).

## 11. Rollback (§30)

Chaque entreprise créée par un import est retrouvable via
`company_source_records.import_batch_id` (ou `staging_companies.created_company_id`
pour le batch d'origine) : un rollback consiste à identifier toutes les
entreprises liées à un batch et à les traiter (suppression si non
revendiquées/non modifiées depuis, signalement manuel sinon). Pas de
commande "rollback" automatique construite cette phase — la traçabilité
est ce qui rend un rollback manuel possible et sûr.

## 12. CLI plutôt qu'interface web (§10 de la demande, §27 de l'original)

`scripts/import-companies.ts` (exécuté via `tsx`, ajouté comme
dépendance de développement) lit un fichier **déjà présent localement**
(`data/raw/france/entreprises_france_5000.csv`) — pas d'upload navigateur,
plus sûr et suffisant pour ce volume. Aucune interface `/admin/imports`
construite cette phase (contrairement à `/admin/revendications`, Phase 7)
— le CLI suffit pour un pilote de 13 lignes ; à reconsidérer si le volume
de batches futurs le justifie.

## 13. Lot pilote : allowlist explicite, pas un filtre générique

Le CLI restreint le traitement aux 13 numéros SIREN classés
`APPROVED_FOR_IMPORT` lors de l'audit (liste figée dans
`scripts/import-companies.ts`, reprise de `progression.json`) — un choix
FAIT PAR VOUS (Décision 1), pas déduit automatiquement d'une colonne du
fichier. Les 87 autres lignes du fichier ne sont jamais traitées par ce
batch, quel que soit leur contenu.

## 14. Performance (§42)

Recherche de doublons en requêtes groupées par signal (pas une requête
par entreprise existante), index dédiés sur les colonnes de
dédoublonnage. Le volume du pilote (13 lignes) ne justifie aucune
optimisation supplémentaire — à mesurer avant d'en ajouter si un futur
batch atteint plusieurs milliers de lignes (§42 : ne pas sur-optimiser
avant mesure).

## 15. Ce qui n'est pas construit cette phase (limites documentées)

- Vérification des 87 entreprises françaises restantes contre la SIRENE
  (§15 de la demande) — conçue (statuts `CONFIRMED`/`NOT_FOUND`/
  `AMBIGUOUS`/`IDENTIFIER_MISMATCH`/`SOURCE_ERROR`), pas implémentée :
  nécessite d'appeler l'API officielle en conditions réelles, prévu pour
  une étape séparée après ce livrable.
- Table de correspondance secteur source → `industries.id` (texte libre
  conservé dans `staging_companies.raw_sector_code`/`raw_sector_label`,
  jamais copié vers `company_industries`).
- Rapprochement produits/services vers la taxonomie structurée.
- Interface web `/admin/imports` (voir §12).
- Détection de doublons ENTRE deux lignes d'un même batch (la colonne
  `other_staging_company_id` existe, non utilisée — sans objet pour un
  pilote déjà vérifié sans doublon interne).
- Stratégie Québec : voir `docs/QUEBEC_SOURCING_STRATEGY.md` (documentée
  uniquement, aucun code, conformément à la Décision 2).
