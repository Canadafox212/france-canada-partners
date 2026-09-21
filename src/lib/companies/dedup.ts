/**
 * Détection de doublon entre deux profils d'entreprise déjà normalisés —
 * logique GÉNÉRIQUE, partagée entre le pipeline d'import (Phase 8,
 * src/lib/import/staging.ts) et la vérification avant création en
 * libre-service (Phase 10C, LOT 10C-2). Déplacée depuis
 * src/lib/import/dedup.ts : cette logique n'a jamais été conceptuellement
 * propre à l'import, seul son PREMIER usage l'était.
 *
 * Comparateur PUR (aucun accès DB) : étant donné deux profils, détermine
 * le niveau de correspondance. La recherche des CANDIDATS (quelles
 * entreprises existantes comparer) reste une responsabilité de la couche
 * appelante (staging.ts pour l'import, une fonction RPC dédiée pour la
 * création en libre-service) — ce fichier ne fait que la comparaison
 * elle-même, pour rester testable unitairement sans base de données.
 *
 * Ordre de confiance (jamais le nom seul comme preuve) : numéro officiel
 * > domaine du site > nom+localisation > nom seul. Comportement identique
 * à l'origine (Phase 8) — ce déplacement ne change aucune règle.
 */

export type DuplicateLevel =
  "EXACT" | "VERY_LIKELY" | "POSSIBLE" | "UNLIKELY" | "NEW";

export type DuplicateSignal =
  "registration_number" | "website_domain" | "name_location" | "name_only";

export interface DuplicateComparisonResult {
  level: Exclude<DuplicateLevel, "NEW">;
  signal: DuplicateSignal;
}

export interface DedupProfile {
  registrationNumber: string | null;
  websiteDomain: string | null;
  legalName: string | null;
  displayName: string | null;
  city: string | null;
}

function sameText(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function compareForDuplicate(
  candidate: DedupProfile,
  existing: DedupProfile,
): DuplicateComparisonResult | null {
  if (
    candidate.registrationNumber &&
    sameText(candidate.registrationNumber, existing.registrationNumber)
  ) {
    return { level: "EXACT", signal: "registration_number" };
  }
  if (
    candidate.websiteDomain &&
    sameText(candidate.websiteDomain, existing.websiteDomain)
  ) {
    return { level: "VERY_LIKELY", signal: "website_domain" };
  }
  const nameMatches =
    sameText(candidate.legalName, existing.legalName) ||
    sameText(candidate.displayName, existing.displayName);
  if (
    nameMatches &&
    candidate.city &&
    sameText(candidate.city, existing.city)
  ) {
    // Regroupe "nom légal + localisation" et "nom commercial + adresse"
    // sous un même signal : les deux comparent un nom à une localisation,
    // avec un niveau de confiance intermédiaire, moins fiable qu'un domaine
    // identique (deux entreprises différentes peuvent partager un nom
    // générique dans une même ville).
    return { level: "POSSIBLE", signal: "name_location" };
  }
  if (nameMatches) {
    // Le nom seul n'est JAMAIS une preuve suffisante : signalé pour
    // arbitrage humain (import) ou simple information (création en
    // libre-service), jamais bloquant à lui seul.
    return { level: "UNLIKELY", signal: "name_only" };
  }
  return null;
}

/** Le niveau le plus élevé parmi plusieurs correspondances trouvées pour un même candidat. */
export function highestDuplicateLevel(
  matches: DuplicateComparisonResult[],
): DuplicateLevel {
  const order: DuplicateLevel[] = [
    "EXACT",
    "VERY_LIKELY",
    "POSSIBLE",
    "UNLIKELY",
    "NEW",
  ];
  if (matches.length === 0) return "NEW";
  let best: DuplicateLevel = "NEW";
  for (const match of matches) {
    if (order.indexOf(match.level) < order.indexOf(best)) best = match.level;
  }
  return best;
}
