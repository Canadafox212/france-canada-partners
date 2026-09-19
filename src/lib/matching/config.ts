/**
 * Paramètres centralisés du moteur de matching (Phase 6). Tout ce qui est
 * "réglage" (poids, seuils, version) vit ici et nulle part ailleurs, pour
 * rester administrable plus tard (voir docs/MATCHING.md §Évolutivité)
 * sans avoir à chercher des constantes éparpillées dans plusieurs fichiers.
 */

export const ALGORITHM_VERSION = "MATCH_V1";

/** Somme = 100. Voir docs/MATCHING.md §Pondération pour la justification de chaque poids. */
export const CRITERION_WEIGHTS = {
  capability: 30,
  productSector: 20,
  geography: 15,
  capacity: 10,
  size: 5,
  certifications: 5,
  languages: 5,
  exportExperience: 5,
  verification: 5,
} as const;

export type Criterion = keyof typeof CRITERION_WEIGHTS;

export const MATCH_LEVELS = [
  "very_strong",
  "strong",
  "possible",
  "weak",
  "insufficient",
] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

/** Seuils centralisés (§16/§17 du cahier des charges) : premier seuil atteint gagne. */
const MATCH_LEVEL_THRESHOLDS: { min: number; level: MatchLevel }[] = [
  { min: 90, level: "very_strong" },
  { min: 75, level: "strong" },
  { min: 60, level: "possible" },
  { min: 40, level: "weak" },
  { min: 0, level: "insufficient" },
];

export function getMatchLevel(score: number): MatchLevel {
  return (
    MATCH_LEVEL_THRESHOLDS.find((t) => score >= t.min)?.level ?? "insufficient"
  );
}

/**
 * Seuil d'affichage aux utilisateurs (§17) : en dessous, un match n'est
 * normalement pas proposé dans les listes visibles, mais reste PERSISTÉ
 * pour analyse interne (jamais supprimé).
 */
export const DISPLAY_SCORE_THRESHOLD = 60;

export const CONFIDENCE_LEVELS = ["high", "moderate", "partial"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

const CONFIDENCE_LEVEL_THRESHOLDS: { min: number; level: ConfidenceLevel }[] = [
  { min: 90, level: "high" },
  { min: 70, level: "moderate" },
  { min: 0, level: "partial" },
];

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  return (
    CONFIDENCE_LEVEL_THRESHOLDS.find((t) => confidence >= t.min)?.level ??
    "partial"
  );
}

/**
 * Ratio attribué à un critère quand la donnée nécessaire pour l'évaluer est
 * absente des deux côtés (ou d'un seul, selon le critère) : ni pénalité
 * totale, ni crédit total — voir docs/MATCHING.md §Données manquantes.
 * Chaque critère marqué "missing" réduit la CONFIANCE globale de son poids,
 * jamais le SCORE au-delà de ce ratio neutre.
 */
export const NEUTRAL_RATIO = 0.5;

/**
 * Codes de business_capability_types représentant une capacité
 * opérationnelle concrète (par opposition aux rôles relationnels/financiers
 * comme INVESTOR ou JOINT_VENTURE, pour lesquels la notion de "capacité
 * industrielle" ne s'applique pas). Utilisé par le critère "capacity" —
 * voir docs/MATCHING.md §Capacité pour la justification de cette liste.
 */
export const CONCRETE_CAPACITY_CODES = new Set([
  "MANUFACTURER",
  "DISTRIBUTOR",
  "SUBCONTRACTOR",
  "SUPPLIER",
  "IMPORTER",
  "EXPORTER",
  "MANUFACTURING_CAPACITY",
  "DISTRIBUTION_CAPACITY",
  "SERVICES",
]);
