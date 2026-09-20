# Stratégie alternative de sourcing Québec (Phase 8 — documentation uniquement)

**Aucun code n'accompagne ce document.** Conformément à la Décision 2, les
659 entreprises actuellement dans `data/raw/quebec/` ne sont pas
importées, et ce document ne prépare que la RÉFLEXION pour une future
source légalement compatible — jamais un remplacement immédiat.

## 1. Pourquoi les 659 lignes actuelles restent bloquées

Voir `docs/DATA_SOURCES.md` : `REQ_Statut` = _"Non intégré à
licence/autorisation commerciale — à clarifier"_ pour la totalité des 659
lignes, et le registre des sources Québec ne documente aucun droit de
réutilisation (contrairement au registre français). Le garde-fou de
licence (migration 0020, voir docs/IMPORT_PIPELINE.md §7) bloque
techniquement tout batch sur cette source tant que ce statut n'a pas
changé.

## 2. Pistes à étudier (aucune évaluée juridiquement ici)

| Piste                                               | Couverture réelle                                 | Limite connue                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corporations Canada (registre fédéral)              | Entreprises constituées sous juridiction FÉDÉRALE | **Ne couvre pas les entreprises constituées uniquement sous juridiction québécoise** — ne jamais présenter comme un remplacement complet du Registraire des entreprises du Québec (REQ) |
| Canadian Importers Database (Statistique Canada)    | Entreprises important des marchandises au Canada  | Sous-ensemble seulement (import), pas un registre général d'entreprises québécoises                                                                                                     |
| Sources partenaires autorisées                      | Variable                                          | À négocier au cas par cas (ex. association sectorielle avec un accord explicite de réutilisation commerciale)                                                                           |
| Inscriptions volontaires                            | Auto-déclaratif                                   | Fiable pour ce qui est déclaré, mais ne construit pas une base large sans effort de sollicitation                                                                                       |
| Entreprises revendiquant leur propre profil         | Auto-déclaratif, très fiable une fois revendiqué  | Suppose que l'entreprise existe déjà dans l'annuaire (voir §3) — ne résout pas le problème initial de constitution de la base                                                           |
| Autre Open Data sous licence commerciale compatible | Variable                                          | À rechercher explicitement — rien d'identifié à ce jour au-delà du registre fédéral                                                                                                     |

**Aucune de ces pistes n'est, à elle seule, un équivalent du REQ.** Une
base Québec fiable nécessitera probablement une **combinaison** de
plusieurs sources plutôt qu'une source unique de remplacement.

## 3. Architecture déjà prête pour des sources multiples

`company_source_records` permet déjà à une entreprise d'avoir **plusieurs
sources** (`company_id` non unique dans cette table — voir
`supabase/migrations/0006_data_sources.sql`) : une entreprise pourrait par
exemple cumuler une source "Corporations Canada" (si applicable), une
source "membre d'une association partenaire", et une source "profil
revendiqué" (Phase 7), sans qu'aucune de ces trois n'ait besoin d'être
exhaustive à elle seule. Aucune modification de schéma n'est nécessaire
pour cela : l'architecture le permet déjà.

## 4. Action externe recommandée : contacter le Registraire

Avant d'investir davantage dans une source alternative partielle, il
serait utile de demander directement au **Registraire des entreprises du
Québec** :

- s'il existe une licence commerciale pour la réutilisation de ses
  données sur une plateforme B2B comme celle-ci ;
- une autorisation spécifique, même limitée (ex. par secteur ou par
  volume) ;
- une entente de réutilisation adaptée à un usage commercial ;
- une API avec des conditions différentes de celles déjà documentées
  dans les fichiers de sourcing actuels.

**Cette possibilité n'est pas supposée exister** — c'est une démarche à
entreprendre, pas un droit déjà acquis. Le résultat de cette démarche
déterminera si le Québec peut un jour disposer d'une source
`APPROVED_FOR_IMPORT` comparable à SIRENE pour la France.

## 5. Ce que ce document ne fait PAS

- Il ne recommande pas d'importer quoi que ce soit du Québec maintenant.
- Il ne construit aucune table, migration ou code pour une source future.
- Il ne présente aucune des pistes ci-dessus comme suffisante à elle
  seule.
