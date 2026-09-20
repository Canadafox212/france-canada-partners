import type { DuplicateLevel, DuplicateMatch } from "./types";

/**
 * Comparateur PUR (aucun accès DB) : étant donné deux profils déjà
 * normalisés, détermine le niveau de correspondance. La recherche des
 * CANDIDATS (quelles entreprises existantes comparer) reste une
 * responsabilité de la couche service (staging.ts, avec accès DB) — ce
 * fichier ne fait que la comparaison elle-même, pour rester testable
 * unitairement (tests/unit/import/dedup.test.ts).
 *
 * Ordre de confiance (§7 de la demande, jamais le nom seul comme preuve) :
 * numéro officiel > domaine du site > nom+localisation > nom seul.
 */
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
): {
  level: Exclude<DuplicateLevel, "NEW">;
  signal: DuplicateMatch["signal"];
} | null {
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
    // (§7 de la demande) sous un même signal : les deux comparent un nom
    // à une localisation, avec un niveau de confiance intermédiaire,
    // moins fiable qu'un domaine identique (deux entreprises différentes
    // peuvent partager un nom générique dans une même ville).
    return { level: "POSSIBLE", signal: "name_location" };
  }
  if (nameMatches) {
    // Le nom seul n'est JAMAIS une preuve suffisante (§13) : signalé pour
    // arbitrage humain, jamais fusionné automatiquement (voir la
    // hiérarchie des niveaux dans pipeline.ts).
    return { level: "UNLIKELY", signal: "name_only" };
  }
  return null;
}

/** Le niveau le plus élevé parmi plusieurs correspondances trouvées pour une même ligne. */
export function highestDuplicateLevel(
  matches: DuplicateMatch[],
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
