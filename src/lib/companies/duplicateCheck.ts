import {
  compareForDuplicate,
  type DedupProfile,
  type DuplicateComparisonResult,
} from "@/lib/companies/dedup";
import { normalizeWebsite } from "@/lib/import/normalization";

/**
 * Vérification de doublon avant création en libre-service (Phase 10C,
 * LOT 10C-2). Réutilise compareForDuplicate() (dedup.ts) et
 * normalizeWebsite() (déjà éprouvée pour l'import, src/lib/import/
 * normalization.ts) — jamais une nouvelle logique de comparaison ou
 * d'extraction de domaine.
 *
 * Le RPC find_similar_companies() (migration 0024) ne fait que retourner
 * un jeu restreint de CANDIDATS ; la comparaison fine (niveau/signal) est
 * calculée ici, côté application, pour rester testable sans base de
 * données.
 */

export interface SimilarCompanyCandidate {
  id: string;
  displayName: string;
  legalName: string | null;
  slug: string;
  website: string | null;
  countryCode: string;
  region: string | null;
  city: string | null;
  isClaimed: boolean;
  /**
   * Calculé côté SQL (find_similar_companies, migration 0024) par égalité
   * exacte sur company_registration_number, qualifiée par country_code
   * pour éviter qu'un identifiant français (SIREN/SIRET) et un identifiant
   * étranger numériquement identique ne soient confondus. Jamais la
   * valeur brute du numéro officiel du candidat — seulement ce booléen.
   */
  registrationNumberMatch: boolean;
}

export interface ScoredSimilarCompany extends SimilarCompanyCandidate {
  comparison: DuplicateComparisonResult;
}

const LEVEL_ORDER: Record<DuplicateComparisonResult["level"], number> = {
  EXACT: 0,
  VERY_LIKELY: 1,
  POSSIBLE: 2,
  UNLIKELY: 3,
};

export function scoreSimilarCompanies(
  candidate: {
    displayName: string;
    legalName?: string | null;
    website?: string | null;
    city?: string | null;
  },
  existingCompanies: SimilarCompanyCandidate[],
): ScoredSimilarCompany[] {
  const candidateProfile: DedupProfile = {
    registrationNumber: null,
    websiteDomain: normalizeWebsite(candidate.website ?? null).domain,
    legalName: candidate.legalName ?? null,
    displayName: candidate.displayName,
    city: candidate.city ?? null,
  };

  const scored: ScoredSimilarCompany[] = [];
  for (const existing of existingCompanies) {
    // Le numéro officiel n'est jamais comparé ici : find_similar_companies()
    // (migration 0024) le calcule déjà en SQL, qualifié par pays, et ne
    // transmet qu'un booléen sûr — jamais la valeur brute du candidat.
    // Un match confirmé court-circuite compareForDuplicate() pour ce seul
    // signal, sans jamais lui faire comparer deux numéros bruts.
    if (existing.registrationNumberMatch) {
      scored.push({
        ...existing,
        comparison: { level: "EXACT", signal: "registration_number" },
      });
      continue;
    }

    const existingProfile: DedupProfile = {
      registrationNumber: null,
      websiteDomain: normalizeWebsite(existing.website).domain,
      legalName: existing.legalName,
      displayName: existing.displayName,
      city: existing.city,
    };
    const comparison = compareForDuplicate(candidateProfile, existingProfile);
    if (comparison) scored.push({ ...existing, comparison });
  }

  return scored.sort(
    (a, b) => LEVEL_ORDER[a.comparison.level] - LEVEL_ORDER[b.comparison.level],
  );
}

export function hasBlockingDuplicate(
  scored: ScoredSimilarCompany[] | null,
): boolean {
  if (!scored) return false;
  return scored.some(
    (s) => s.comparison.level === "EXACT" || s.comparison.level === "VERY_LIKELY",
  );
}
