import {
  CONCRETE_CAPACITY_CODES,
  CRITERION_WEIGHTS,
  NEUTRAL_RATIO,
} from "./config";
import type {
  CandidateCompanyProfile,
  CriterionResult,
  MatchableIntent,
  MatchScoreInput,
  MatchScoreResult,
} from "./types";

/**
 * Toutes les fonctions ci-dessous sont PURES (aucun accès réseau/DB) pour
 * rester testables unitairement (voir tests/unit/matching/scoring.test.ts,
 * qui couvre les règles métier du §34 du cahier des charges Phase 6).
 * La génération des candidats (SQL, avec accès DB) vit dans
 * candidateGeneration.ts — jamais mélangée à ce fichier.
 */

function neutral(
  criterion: CriterionResult["criterion"],
  max: number,
): CriterionResult {
  return {
    criterion,
    points: Math.round(max * NEUTRAL_RATIO),
    maxPoints: max,
    status: "missing",
  };
}

export function scoreCapability(compatibilityRatio: number): CriterionResult {
  const max = CRITERION_WEIGHTS.capability;
  return {
    criterion: "capability",
    points: Math.round(max * compatibilityRatio),
    maxPoints: max,
    status: "evaluated",
  };
}

export function scoreProductSector(
  seeker: Pick<MatchableIntent, "productServiceIds" | "industryId">,
  provider: Pick<MatchableIntent, "productServiceIds" | "industryId">,
): CriterionResult {
  const max = CRITERION_WEIGHTS.productSector;
  const sharedProduct = seeker.productServiceIds.some((id) =>
    provider.productServiceIds.includes(id),
  );
  if (sharedProduct) {
    return {
      criterion: "productSector",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  if (seeker.industryId && provider.industryId) {
    if (seeker.industryId === provider.industryId) {
      return {
        criterion: "productSector",
        points: Math.round(max * 0.6),
        maxPoints: max,
        status: "evaluated",
      };
    }
    return {
      criterion: "productSector",
      points: 0,
      maxPoints: max,
      status: "evaluated",
    };
  }
  return neutral("productSector", max);
}

export function scoreGeography(
  seeker: Pick<MatchableIntent, "targetCountryCode" | "targetRegion">,
  provider: Pick<MatchableIntent, "targetCountryCode" | "targetRegion">,
): CriterionResult {
  const max = CRITERION_WEIGHTS.geography;
  const evaluated = (points: number): CriterionResult => ({
    criterion: "geography",
    points,
    maxPoints: max,
    status: "evaluated",
  });

  if (!seeker.targetCountryCode) return evaluated(max);
  if (!provider.targetCountryCode) return evaluated(Math.round(max * 0.8));
  if (
    seeker.targetCountryCode.toLowerCase() !==
    provider.targetCountryCode.toLowerCase()
  ) {
    return evaluated(0);
  }
  if (!seeker.targetRegion) return evaluated(max);
  if (!provider.targetRegion) return evaluated(Math.round(max * 0.8));
  if (
    seeker.targetRegion.trim().toLowerCase() ===
    provider.targetRegion.trim().toLowerCase()
  ) {
    return evaluated(max);
  }
  return evaluated(0);
}

export function scoreCapacity(
  providerCapabilityTypeCode: string,
  providerHasLinkedProductsServices: boolean,
): CriterionResult {
  const max = CRITERION_WEIGHTS.capacity;
  if (!CONCRETE_CAPACITY_CODES.has(providerCapabilityTypeCode)) {
    return neutral("capacity", max);
  }
  if (providerHasLinkedProductsServices) {
    return {
      criterion: "capacity",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  return neutral("capacity", max);
}

export function scoreSize(
  soughtEmployeeRange: string | null | undefined,
  actualEmployeeRange: string | null,
): CriterionResult {
  const max = CRITERION_WEIGHTS.size;
  if (!soughtEmployeeRange) {
    return {
      criterion: "size",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  if (!actualEmployeeRange) {
    return {
      criterion: "size",
      points: Math.round(max * 0.6),
      maxPoints: max,
      status: "missing",
    };
  }
  if (
    soughtEmployeeRange.trim().toLowerCase() ===
    actualEmployeeRange.trim().toLowerCase()
  ) {
    return {
      criterion: "size",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  return { criterion: "size", points: 0, maxPoints: max, status: "evaluated" };
}

/**
 * company_needs ne permet pas encore d'exprimer des certifications
 * REQUISES (voir docs/MATCHING.md §Limites) : ce critère est donc toujours
 * "missing" pour l'instant, en attendant une éventuelle évolution de
 * schéma (company_need_required_certifications). Ne pas sur-pénaliser en
 * attendant : ratio neutre, comme tout autre critère non évaluable.
 */
export function scoreCertifications(): CriterionResult {
  return neutral("certifications", CRITERION_WEIGHTS.certifications);
}

export function scoreLanguages(
  seekerLanguageCodes: string[],
  providerLanguageCodes: string[],
): CriterionResult {
  const max = CRITERION_WEIGHTS.languages;
  if (seekerLanguageCodes.length === 0 || providerLanguageCodes.length === 0) {
    return neutral("languages", max);
  }
  const shared = seekerLanguageCodes.some((code) =>
    providerLanguageCodes.includes(code),
  );
  if (shared) {
    return {
      criterion: "languages",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  return {
    criterion: "languages",
    points: Math.round(max * 0.2),
    maxPoints: max,
    status: "evaluated",
  };
}

export function scoreExportExperience(
  seekerCountryCode: string,
  providerCountryCode: string,
  providerExportExperience: boolean,
): CriterionResult {
  const max = CRITERION_WEIGHTS.exportExperience;
  const crossBorder =
    seekerCountryCode.toLowerCase() !== providerCountryCode.toLowerCase();
  if (crossBorder && providerExportExperience) {
    return {
      criterion: "exportExperience",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  // export_experience=false est aussi la valeur par défaut : impossible de
  // distinguer "déclaré sans expérience" de "non renseigné" avec le schéma
  // actuel — traité comme non évaluable pour ne pas pénaliser à tort
  // (voir §12 du cahier des charges Phase 6).
  return neutral("exportExperience", max);
}

export function scoreVerification(
  verificationStatus: CandidateCompanyProfile["verificationStatus"],
): CriterionResult {
  const max = CRITERION_WEIGHTS.verification;
  if (verificationStatus === "verified") {
    return {
      criterion: "verification",
      points: max,
      maxPoints: max,
      status: "evaluated",
    };
  }
  if (verificationStatus === "pending") {
    return {
      criterion: "verification",
      points: Math.round(max * 0.4),
      maxPoints: max,
      status: "evaluated",
    };
  }
  return {
    criterion: "verification",
    points: 0,
    maxPoints: max,
    status: "evaluated",
  };
}

/**
 * Point d'entrée unique du moteur : calcule le score d'UN candidat pour
 * UNE intention, quel que soit le contexte (entreprise↔entreprise ou
 * opportunité↔entreprise, dans un sens ou l'autre — voir MatchableIntent).
 * Une incompatibilité de capacité (compatibilityRatio = 0) élimine le
 * candidat entièrement plutôt que de produire un score de 0 : voir §5/§18.
 */
export function computeMatchScore(input: MatchScoreInput): MatchScoreResult {
  const {
    seekerIntent,
    seekerCompany,
    providerIntent,
    providerCompany,
    compatibilityRatio,
  } = input;

  if (compatibilityRatio <= 0) {
    return {
      score: 0,
      confidence: 0,
      eliminated: true,
      eliminationReason: "capability_incompatible",
      breakdown: [],
    };
  }

  const breakdown: CriterionResult[] = [
    scoreCapability(compatibilityRatio),
    scoreProductSector(seekerIntent, providerIntent),
    scoreGeography(seekerIntent, providerIntent),
    scoreCapacity(
      providerIntent.capabilityTypeCode,
      providerCompany.hasLinkedProductsServices,
    ),
    scoreSize(seekerIntent.soughtEmployeeRange, providerCompany.employeeRange),
    scoreCertifications(),
    scoreLanguages(
      seekerIntent.languageCodes.length
        ? seekerIntent.languageCodes
        : seekerCompany.languageCodes,
      providerIntent.languageCodes.length
        ? providerIntent.languageCodes
        : providerCompany.languageCodes,
    ),
    scoreExportExperience(
      seekerCompany.countryCode,
      providerCompany.countryCode,
      providerCompany.exportExperience,
    ),
    scoreVerification(providerCompany.verificationStatus),
  ];

  const rawScore = breakdown.reduce((sum, c) => sum + c.points, 0);
  const missingWeight = breakdown
    .filter((c) => c.status === "missing")
    .reduce((sum, c) => sum + c.maxPoints, 0);

  return {
    score: Math.min(100, Math.max(0, rawScore)),
    confidence: Math.min(100, Math.max(0, 100 - missingWeight)),
    eliminated: false,
    breakdown,
  };
}
