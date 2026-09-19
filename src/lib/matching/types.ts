import type { Criterion } from "./config";

/**
 * Une "intention" est soit un BESOIN, soit une OFFRE, soit une OPPORTUNITÉ
 * lue dans l'un ou l'autre sens (seeking = se comporte comme un besoin,
 * offering = se comporte comme une offre). Réduire les quatre cas à une
 * même forme permet au moteur de scoring de rester UNIQUE et testable sans
 * dupliquer la logique par type — voir docs/MATCHING.md §Architecture.
 */
export type MatchIntentKind =
  "need" | "offer" | "opportunity_seeking" | "opportunity_offering";

export interface MatchableIntent {
  id: string;
  kind: MatchIntentKind;
  companyId: string;
  capabilityTypeCode: string;
  industryId: string | null;
  targetCountryCode: string | null;
  targetRegion: string | null;
  productServiceIds: string[];
  /** Langues déclarées pour CETTE offre/besoin/opportunité précise (peut être vide). */
  languageCodes: string[];
  /** Taille de partenaire recherchée — n'a de sens que côté "seeker" (besoin). */
  soughtEmployeeRange?: string | null;
}

export interface CandidateCompanyProfile {
  companyId: string;
  countryCode: string;
  verificationStatus: "unverified" | "pending" | "verified";
  exportExperience: boolean;
  employeeRange: string | null;
  /** Langues de travail générales de l'entreprise (repli si l'intention n'en déclare pas). */
  languageCodes: string[];
  /**
   * Vrai si l'offre/le besoin/l'opportunité évalué(e) a au moins un
   * produit/service structuré rattaché — utilisé par le critère "capacity"
   * comme signal de capacité réellement documentée plutôt qu'imaginée.
   */
  hasLinkedProductsServices: boolean;
}

export type CriterionStatus = "evaluated" | "missing";

export interface CriterionResult {
  criterion: Criterion;
  points: number;
  maxPoints: number;
  status: CriterionStatus;
}

export interface MatchScoreResult {
  score: number;
  confidence: number;
  eliminated: boolean;
  eliminationReason?: "capability_incompatible";
  breakdown: CriterionResult[];
}

export interface MatchScoreInput {
  seekerIntent: MatchableIntent;
  seekerCompany: CandidateCompanyProfile;
  providerIntent: MatchableIntent;
  providerCompany: CandidateCompanyProfile;
  /**
   * 0 si aucune ligne de compatibilité (incompatibilité fondamentale) ;
   * 1.0 pour un même code (règle réflexive implicite) ; sinon le ratio
   * défini dans la table capability_compatibility.
   */
  compatibilityRatio: number;
}
