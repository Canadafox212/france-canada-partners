# Provenance et statut de licence des sources (Phase 8)

Statuts utilisés (voir §3 du cahier des charges Phase 8) :

- **APPROVED_FOR_IMPORT** — licence ou base légale claire et compatible
  avec un usage commercial, attribution possible.
- **REVIEW_REQUIRED** — source plausible mais droits non confirmés ; ne
  jamais importer automatiquement, nécessite une vérification humaine
  (juridique ou éditoriale) au cas par cas.
- **DO_NOT_IMPORT** — usage commercial explicitement non couvert, ou
  donnée déduite/synthétique ne représentant pas un fait déclaré.
- **UNKNOWN** — provenance non tracée dans les fichiers actuels.

**Aucune décision juridique définitive n'est prise ici** — ce tableau
signale ce qui doit être vérifié, il ne remplace pas un avis juridique.

## France

| Source                                                               | URL                               | Type                           | Statut                  | Justification                                                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------- | ------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annuaire des Entreprises / API Recherche d'entreprises               | recherche-entreprises.api.gouv.fr | Registre officiel (SIRENE/RNE) | **APPROVED_FOR_IMPORT** | Le fichier source lui-même documente "Licence Ouverte 2.0", réutilisation commerciale autorisée avec attribution — cadre légal explicite (`etalab.gouv.fr/licence-ouverte-open-licence/`)            |
| GIFAS / NAFAN                                                        | gifas.fr                          | Répertoire sectoriel           | **REVIEW_REQUIRED**     | Marqué "vérification uniquement / droits à confirmer" dans le fichier source lui-même                                                                                                                |
| Minalogic, Polymeris, Medicen, Eurobiomed, Agri Sud-Ouest Innovation | (pôles de compétitivité)          | Répertoires sectoriels         | **REVIEW_REQUIRED**     | Même mention "droits à confirmer" pour chacun                                                                                                                                                        |
| Sites officiels des entreprises                                      | (variable)                        | Source primaire                | **REVIEW_REQUIRED**     | Le fichier source précise "réutiliser les faits, pas recopier textes/images sans droit" — utilisable pour des FAITS (adresse, activité) mais jamais pour copier une description commerciale verbatim |

**Conséquence pratique** : sur les 100 entreprises du lot 1, seules les
**13** dont `Source_Identite = "Annuaire des Entreprises / SIRENE-RNE"`
et `V3_Identite_Legale = "Oui"` sont couvertes par une source
`APPROVED_FOR_IMPORT` de bout en bout. Les 87 autres ont un SIREN/SIRET
renseigné mais une provenance non confirmée pour l'identité légale —
`REVIEW_REQUIRED`, pas `DO_NOT_IMPORT` (rien n'indique un problème de
droits, seulement une vérification non encore faite).

## Québec

| Source                                        | URL                  | Type                       | Statut              | Justification                                                                                                                                       |
| --------------------------------------------- | -------------------- | -------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| REAI (répertoire des membres)                 | reai.ca              | Répertoire sectoriel       | **REVIEW_REQUIRED** | Aucune mention de licence dans le registre des sources ; statut d'organisme/répertoire à clarifier                                                  |
| Aéro Montréal                                 | aeromontreal.ca      | Grappe sectorielle         | **REVIEW_REQUIRED** | Idem                                                                                                                                                |
| Gouvernement du Québec (portrait aérospatial) | quebec.ca            | Source gouvernementale     | **REVIEW_REQUIRED** | Gouvernementale mais licence de réutilisation non documentée dans le fichier (à la différence de la Licence Ouverte française, explicitement citée) |
| Québec Tech                                   | quebectech.com       | Écosystème technologique   | **REVIEW_REQUIRED** | Idem                                                                                                                                                |
| Aliments du Québec                            | alimentsduquebec.com | Répertoire sectoriel       | **REVIEW_REQUIRED** | Idem                                                                                                                                                |
| Investissement Québec                         | investquebec.com     | Source économique publique | **REVIEW_REQUIRED** | Idem                                                                                                                                                |
| Registraire des entreprises du Québec (REQ)   | —                    | Registre officiel          | **UNKNOWN**         | Jamais consulté à ce stade : `REQ_Statut` = _"Non intégré à licence/autorisation commerciale — à clarifier"_ pour les 659 lignes, sans exception    |

**Conséquence pratique, sans ambiguïté** : **aucune ligne québécoise
n'est `APPROVED_FOR_IMPORT` aujourd'hui.** Les 659 lignes du fichier
maître portent toutes exactement la même mention de blocage
(`REQ_Statut`), et le registre des sources Québec ne contient, à la
différence du registre français, aucune colonne de droits de
réutilisation. C'est précisément le risque anticipé par le cahier des
charges (§4 : _"ne suppose pas que toutes les données des ~2 000
entreprises québécoises sont légalement réutilisables commercialement"_)
— confirmé par les données elles-mêmes, pas seulement par prudence
générale.

## Fichiers "matching" (besoins/offres/prototype de score)

| Fichier                                                                       | Statut                        | Justification                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `france_quebec_besoins.csv` / `_offres.csv`                                   | **DO_NOT_IMPORT** (en l'état) | Données **déduites automatiquement**, jamais déclarées par une entreprise — le fichier source dit lui-même qu'elles ne constituent pas des demandes/offres actives. Les importer comme si elles étaient réelles créerait de fausses données commerciales. |
| `france_quebec_matching_prototype.xlsx` / `matching_france_quebec_top500.csv` | **DO_NOT_IMPORT**             | Prototype de scoring antérieur, incompatible avec le moteur réel (Phase 6). Conserver comme référence historique seulement.                                                                                                                               |
| `france_quebec_opportunites_template.csv`                                     | Sans objet                    | Fichier vide (gabarit), rien à statuer.                                                                                                                                                                                                                   |

## Prochaine étape recommandée (pas de décision juridique prise ici)

1. Faire confirmer par une personne compétente (vous, ou un conseil
   juridique si besoin) le statut réel des sources marquées
   `REVIEW_REQUIRED`, en particulier les répertoires sectoriels québécois
   et le statut du REQ.
2. Tant qu'aucune source québécoise n'est `APPROVED_FOR_IMPORT`, ne
   construire/exécuter aucun import réel pour le Québec — seul l'audit
   est fait cette phase, conformément à votre demande (§31 du cahier des
   charges Phase 8).
