import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMatchScore } from "./scoring";
import {
  getConfidenceLevel,
  getMatchLevel,
  DISPLAY_SCORE_THRESHOLD,
} from "./config";
import { upsertMatch, upsertOpportunityMatch } from "./persistence";
import {
  fetchCompanyProfile,
  fetchNeedCandidatesForOffer,
  fetchOfferCandidatesForNeed,
  fetchOfferingOpportunityCandidatesForNeed,
  fetchPublishedOpportunity,
  fetchSeekingOpportunityCandidatesForOffer,
  loadCompatibilityLookup,
  opportunityToIntent,
} from "./candidateGeneration";
import type { CriterionResult, MatchableIntent } from "./types";

/**
 * Orchestration : génération de candidats → scoring → persistance → mise
 * en forme pour l'affichage. Stratégie de recalcul choisie pour cette
 * phase : "à la lecture" (voir docs/MATCHING.md §Recalcul) — appelé
 * directement depuis les Server Components des pages concernées, jamais
 * depuis un déclencheur SQL lourd sur chaque écriture. Simple et fiable
 * pour le MVP, conforme au §23 du cahier des charges.
 */

export interface MatchDisplayItem {
  score: number;
  confidence: number;
  level: ReturnType<typeof getMatchLevel>;
  confidenceLevel: ReturnType<typeof getConfidenceLevel>;
  breakdown: CriterionResult[];
  companyId: string;
  companyName: string;
  companyCountryCode: string;
  /** Slug de la fiche publique — null si l'entreprise n'a pas de fiche (ne devrait pas arriver pour un candidat actif, gardé optionnel par prudence). */
  companySlug: string | null;
  /** Identifie la paire à l'origine du match, pour l'explication contextuelle. */
  sourceLabel: string;
  /** Ligne `matches` correspondant à CE match précis — voir Phase 9, "Demander une mise en relation" référence sa provenance sans jamais recopier le score. */
  matchId: string | null;
}

async function attachCompanyDisplayInfo(
  supabase: SupabaseClient,
  companyIds: string[],
): Promise<
  Map<string, { display_name: string; country_code: string; slug: string | null }>
> {
  if (companyIds.length === 0) return new Map();
  const { data } = await supabase
    .from("companies")
    .select("id, display_name, country_code, slug")
    .in("id", [...new Set(companyIds)]);
  return new Map((data ?? []).map((c) => [c.id, c]));
}

function toDisplayItem(
  score: number,
  confidence: number,
  breakdown: CriterionResult[],
  companyId: string,
  names: Map<string, { display_name: string; country_code: string; slug: string | null }>,
  sourceLabel: string,
  matchId: string | null = null,
): MatchDisplayItem {
  const info = names.get(companyId);
  return {
    score,
    confidence,
    level: getMatchLevel(score),
    confidenceLevel: getConfidenceLevel(confidence),
    breakdown,
    companyId,
    companyName: info?.display_name ?? "",
    companyCountryCode: info?.country_code ?? "",
    companySlug: info?.slug ?? null,
    sourceLabel,
    matchId,
  };
}

/**
 * "VOS PARTENAIRES POTENTIELS" (§19/§26) : compare chaque besoin actif de
 * l'entreprise aux offres compatibles d'autres entreprises, ET chaque
 * offre active aux besoins compatibles d'autres entreprises (les deux
 * sens — voir §2 du cahier des charges).
 */
export async function getPartnersForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<MatchDisplayItem[]> {
  const lookup = await loadCompatibilityLookup(supabase);
  const selfProfile = await fetchCompanyProfile(supabase, companyId);

  const [{ data: needs }, { data: offers }] = await Promise.all([
    supabase
      .from("company_needs")
      .select(
        "id, capability_type_code, industry_id, target_country_code, target_region, sought_employee_range, products:company_need_products_services(product_service_id), langs:company_need_languages(language_code)",
      )
      .eq("company_id", companyId)
      .eq("status", "active"),
    supabase
      .from("company_offers")
      .select(
        "id, capability_type_code, industry_id, target_country_code, target_region, products:company_offer_products_services(product_service_id), langs:company_offer_languages(language_code)",
      )
      .eq("company_id", companyId)
      .eq("status", "active"),
  ]);

  const results: {
    score: number;
    confidence: number;
    breakdown: CriterionResult[];
    companyId: string;
    sourceLabel: string;
    matchId: string | null;
  }[] = [];

  for (const need of needs ?? []) {
    const needIntent: MatchableIntent = {
      id: need.id,
      kind: "need",
      companyId,
      capabilityTypeCode: need.capability_type_code,
      industryId: need.industry_id,
      targetCountryCode: need.target_country_code,
      targetRegion: need.target_region,
      productServiceIds: (need.products ?? []).map((p) => p.product_service_id),
      languageCodes: (need.langs ?? []).map((l) => l.language_code),
      soughtEmployeeRange: need.sought_employee_range,
    };
    const candidates = await fetchOfferCandidatesForNeed(
      supabase,
      lookup,
      { capabilityTypeCode: need.capability_type_code },
      companyId,
    );
    for (const candidate of candidates) {
      const result = computeMatchScore({
        seekerIntent: needIntent,
        seekerCompany: selfProfile,
        providerIntent: candidate.intent,
        providerCompany: candidate.company,
        compatibilityRatio: candidate.compatibilityRatio,
      });
      const matchId = await upsertMatch({
        companyId,
        needId: need.id,
        candidateCompanyId: candidate.company.companyId,
        offerId: candidate.offerId,
        result,
      });
      if (!result.eliminated) {
        results.push({
          score: result.score,
          confidence: result.confidence,
          breakdown: result.breakdown,
          companyId: candidate.company.companyId,
          sourceLabel: `need:${need.capability_type_code}`,
          matchId,
        });
      }
    }
  }

  for (const offer of offers ?? []) {
    const offerIntent: MatchableIntent = {
      id: offer.id,
      kind: "offer",
      companyId,
      capabilityTypeCode: offer.capability_type_code,
      industryId: offer.industry_id,
      targetCountryCode: offer.target_country_code,
      targetRegion: offer.target_region,
      productServiceIds: (offer.products ?? []).map(
        (p) => p.product_service_id,
      ),
      languageCodes: (offer.langs ?? []).map((l) => l.language_code),
    };
    const candidates = await fetchNeedCandidatesForOffer(
      supabase,
      lookup,
      { capabilityTypeCode: offer.capability_type_code },
      companyId,
    );
    for (const candidate of candidates) {
      const result = computeMatchScore({
        seekerIntent: candidate.intent,
        seekerCompany: candidate.company,
        providerIntent: offerIntent,
        providerCompany: selfProfile,
        compatibilityRatio: candidate.compatibilityRatio,
      });
      const matchId = await upsertMatch({
        companyId: candidate.company.companyId,
        needId: candidate.needId,
        candidateCompanyId: companyId,
        offerId: offer.id,
        result,
      });
      if (!result.eliminated) {
        results.push({
          score: result.score,
          confidence: result.confidence,
          breakdown: result.breakdown,
          companyId: candidate.company.companyId,
          sourceLabel: `offer:${offer.capability_type_code}`,
          matchId,
        });
      }
    }
  }

  const names = await attachCompanyDisplayInfo(
    supabase,
    results.map((r) => r.companyId),
  );

  return results
    .filter((r) => r.score >= DISPLAY_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((r) =>
      toDisplayItem(
        r.score,
        r.confidence,
        r.breakdown,
        r.companyId,
        names,
        r.sourceLabel,
        r.matchId,
      ),
    );
}

/**
 * "ENTREPRISES COMPATIBLES" (§20/§27) : pour une opportunité publiée et
 * non expirée, compare aux offres (direction seeking) ou aux besoins
 * (direction offering) d'autres entreprises actives.
 */
export async function getCompaniesForOpportunity(
  supabase: SupabaseClient,
  opportunityId: string,
): Promise<MatchDisplayItem[]> {
  const opportunity = await fetchPublishedOpportunity(supabase, opportunityId);
  if (!opportunity) return [];

  const lookup = await loadCompatibilityLookup(supabase);
  const ownerProfile = await fetchCompanyProfile(
    supabase,
    opportunity.company_id,
  );
  const opportunityIntent = opportunityToIntent(opportunity);

  const results: {
    score: number;
    confidence: number;
    breakdown: CriterionResult[];
    companyId: string;
  }[] = [];

  if (opportunity.direction === "seeking") {
    const candidates = await fetchOfferCandidatesForNeed(
      supabase,
      lookup,
      { capabilityTypeCode: opportunity.capability_type_code },
      opportunity.company_id,
    );
    for (const candidate of candidates) {
      const result = computeMatchScore({
        seekerIntent: opportunityIntent,
        seekerCompany: ownerProfile,
        providerIntent: candidate.intent,
        providerCompany: candidate.company,
        compatibilityRatio: candidate.compatibilityRatio,
      });
      await upsertOpportunityMatch({
        opportunityId,
        candidateCompanyId: candidate.company.companyId,
        candidateOfferId: candidate.offerId,
        result,
      });
      if (!result.eliminated) {
        results.push({
          score: result.score,
          confidence: result.confidence,
          breakdown: result.breakdown,
          companyId: candidate.company.companyId,
        });
      }
    }
  } else {
    const candidates = await fetchNeedCandidatesForOffer(
      supabase,
      lookup,
      { capabilityTypeCode: opportunity.capability_type_code },
      opportunity.company_id,
    );
    for (const candidate of candidates) {
      const result = computeMatchScore({
        seekerIntent: candidate.intent,
        seekerCompany: candidate.company,
        providerIntent: opportunityIntent,
        providerCompany: ownerProfile,
        compatibilityRatio: candidate.compatibilityRatio,
      });
      await upsertOpportunityMatch({
        opportunityId,
        candidateCompanyId: candidate.company.companyId,
        candidateNeedId: candidate.needId,
        result,
      });
      if (!result.eliminated) {
        results.push({
          score: result.score,
          confidence: result.confidence,
          breakdown: result.breakdown,
          companyId: candidate.company.companyId,
        });
      }
    }
  }

  const names = await attachCompanyDisplayInfo(
    supabase,
    results.map((r) => r.companyId),
  );
  return results
    .filter((r) => r.score >= DISPLAY_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((r) =>
      toDisplayItem(r.score, r.confidence, r.breakdown, r.companyId, names, ""),
    );
}

const NEED_SELECT =
  "id, capability_type_code, industry_id, target_country_code, target_region, sought_employee_range, products:company_need_products_services(product_service_id), langs:company_need_languages(language_code)";
const OFFER_SELECT =
  "id, capability_type_code, industry_id, target_country_code, target_region, products:company_offer_products_services(product_service_id), langs:company_offer_languages(language_code)";

type NeedRow = {
  id: string;
  capability_type_code: string;
  industry_id: string | null;
  target_country_code: string | null;
  target_region: string | null;
  sought_employee_range: string | null;
  products: { product_service_id: string }[] | null;
  langs: { language_code: string }[] | null;
};
type OfferRow = Omit<NeedRow, "sought_employee_range">;

function needRowToIntent(row: NeedRow, companyId: string): MatchableIntent {
  return {
    id: row.id,
    kind: "need",
    companyId,
    capabilityTypeCode: row.capability_type_code,
    industryId: row.industry_id,
    targetCountryCode: row.target_country_code,
    targetRegion: row.target_region,
    productServiceIds: (row.products ?? []).map((p) => p.product_service_id),
    languageCodes: (row.langs ?? []).map((l) => l.language_code),
    soughtEmployeeRange: row.sought_employee_range,
  };
}

function offerRowToIntent(row: OfferRow, companyId: string): MatchableIntent {
  return {
    id: row.id,
    kind: "offer",
    companyId,
    capabilityTypeCode: row.capability_type_code,
    industryId: row.industry_id,
    targetCountryCode: row.target_country_code,
    targetRegion: row.target_region,
    productServiceIds: (row.products ?? []).map((p) => p.product_service_id),
    languageCodes: (row.langs ?? []).map((l) => l.language_code),
  };
}

export interface CompanyCompatibilityResult {
  score: number;
  confidence: number;
  level: ReturnType<typeof getMatchLevel>;
  confidenceLevel: ReturnType<typeof getConfidenceLevel>;
  breakdown: CriterionResult[];
}

/**
 * Compatibilité CIBLÉE entre deux entreprises précises (§10/§28 du cahier
 * des charges Phase 7 : "ne recalcule pas un autre score pour l'annuaire",
 * "calcul ciblé" plutôt que d'évaluer des centaines de candidats). Utilisée
 * par la fiche publique d'une entreprise — jamais par la liste de
 * résultats (qui resterait alors bornée à un nombre de calculs non
 * maîtrisé). Réutilise scoring.ts telle quelle, et persiste le meilleur
 * résultat trouvé dans `matches` comme n'importe quel autre calcul du
 * moteur Phase 6 — pas un score parallèle.
 */
export async function getCompatibilityBetweenCompanies(
  supabase: SupabaseClient,
  viewerCompanyId: string,
  targetCompanyId: string,
): Promise<CompanyCompatibilityResult | null> {
  if (viewerCompanyId === targetCompanyId) return null;

  const lookup = await loadCompatibilityLookup(supabase);
  const [viewerProfile, targetProfile] = await Promise.all([
    fetchCompanyProfile(supabase, viewerCompanyId),
    fetchCompanyProfile(supabase, targetCompanyId),
  ]);

  const [
    { data: viewerNeeds },
    { data: viewerOffers },
    { data: targetNeeds },
    { data: targetOffers },
  ] = await Promise.all([
    supabase
      .from("company_needs")
      .select(NEED_SELECT)
      .eq("company_id", viewerCompanyId)
      .eq("status", "active"),
    supabase
      .from("company_offers")
      .select(OFFER_SELECT)
      .eq("company_id", viewerCompanyId)
      .eq("status", "active"),
    supabase
      .from("company_needs")
      .select(NEED_SELECT)
      .eq("company_id", targetCompanyId)
      .eq("status", "active"),
    supabase
      .from("company_offers")
      .select(OFFER_SELECT)
      .eq("company_id", targetCompanyId)
      .eq("status", "active"),
  ]);

  let best: CompanyCompatibilityResult | null = null;

  for (const need of (viewerNeeds ?? []) as NeedRow[]) {
    const needIntent = needRowToIntent(need, viewerCompanyId);
    for (const offer of (targetOffers ?? []) as OfferRow[]) {
      const offerIntent = offerRowToIntent(offer, targetCompanyId);
      const ratio =
        need.capability_type_code === offer.capability_type_code
          ? 1
          : (lookup
              .get(need.capability_type_code)
              ?.get(offer.capability_type_code) ?? 0);
      const result = computeMatchScore({
        seekerIntent: needIntent,
        seekerCompany: viewerProfile,
        providerIntent: offerIntent,
        providerCompany: targetProfile,
        compatibilityRatio: ratio,
      });
      await upsertMatch({
        companyId: viewerCompanyId,
        needId: need.id,
        candidateCompanyId: targetCompanyId,
        offerId: offer.id,
        result,
      });
      if (!result.eliminated && (!best || result.score > best.score)) {
        best = {
          score: result.score,
          confidence: result.confidence,
          level: getMatchLevel(result.score),
          confidenceLevel: getConfidenceLevel(result.confidence),
          breakdown: result.breakdown,
        };
      }
    }
  }

  for (const need of (targetNeeds ?? []) as NeedRow[]) {
    const needIntent = needRowToIntent(need, targetCompanyId);
    for (const offer of (viewerOffers ?? []) as OfferRow[]) {
      const offerIntent = offerRowToIntent(offer, viewerCompanyId);
      const ratio =
        need.capability_type_code === offer.capability_type_code
          ? 1
          : (lookup
              .get(need.capability_type_code)
              ?.get(offer.capability_type_code) ?? 0);
      const result = computeMatchScore({
        seekerIntent: needIntent,
        seekerCompany: targetProfile,
        providerIntent: offerIntent,
        providerCompany: viewerProfile,
        compatibilityRatio: ratio,
      });
      await upsertMatch({
        companyId: targetCompanyId,
        needId: need.id,
        candidateCompanyId: viewerCompanyId,
        offerId: offer.id,
        result,
      });
      if (!result.eliminated && (!best || result.score > best.score)) {
        best = {
          score: result.score,
          confidence: result.confidence,
          level: getMatchLevel(result.score),
          confidenceLevel: getConfidenceLevel(result.confidence),
          breakdown: result.breakdown,
        };
      }
    }
  }

  return best;
}

export interface OpportunityDisplayItem {
  score: number;
  confidence: number;
  level: ReturnType<typeof getMatchLevel>;
  confidenceLevel: ReturnType<typeof getConfidenceLevel>;
  breakdown: CriterionResult[];
  opportunityId: string;
  title: string;
  slug: string | null;
  companyName: string;
}

/**
 * "OPPORTUNITÉS POUR VOUS" (§21/§28) : pour chaque besoin actif de
 * l'entreprise, les opportunités 'offering' compatibles d'autres
 * entreprises ; pour chaque offre active, les opportunités 'seeking'
 * compatibles.
 */
export async function getOpportunitiesForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<OpportunityDisplayItem[]> {
  const lookup = await loadCompatibilityLookup(supabase);
  const selfProfile = await fetchCompanyProfile(supabase, companyId);

  const [{ data: needs }, { data: offers }] = await Promise.all([
    supabase
      .from("company_needs")
      .select(
        "id, capability_type_code, industry_id, target_country_code, target_region, sought_employee_range, products:company_need_products_services(product_service_id), langs:company_need_languages(language_code)",
      )
      .eq("company_id", companyId)
      .eq("status", "active"),
    supabase
      .from("company_offers")
      .select(
        "id, capability_type_code, industry_id, target_country_code, target_region, products:company_offer_products_services(product_service_id), langs:company_offer_languages(language_code)",
      )
      .eq("company_id", companyId)
      .eq("status", "active"),
  ]);

  const results: {
    score: number;
    confidence: number;
    breakdown: CriterionResult[];
    opportunityId: string;
    ownerCompanyId: string;
  }[] = [];

  for (const need of needs ?? []) {
    const needIntent: MatchableIntent = {
      id: need.id,
      kind: "need",
      companyId,
      capabilityTypeCode: need.capability_type_code,
      industryId: need.industry_id,
      targetCountryCode: need.target_country_code,
      targetRegion: need.target_region,
      productServiceIds: (need.products ?? []).map((p) => p.product_service_id),
      languageCodes: (need.langs ?? []).map((l) => l.language_code),
      soughtEmployeeRange: need.sought_employee_range,
    };
    const candidates = await fetchOfferingOpportunityCandidatesForNeed(
      supabase,
      lookup,
      { capabilityTypeCode: need.capability_type_code },
      companyId,
    );
    for (const candidate of candidates) {
      const ownerProfile = await fetchCompanyProfile(
        supabase,
        candidate.intent.companyId,
      );
      const result = computeMatchScore({
        seekerIntent: needIntent,
        seekerCompany: selfProfile,
        providerIntent: candidate.intent,
        providerCompany: ownerProfile,
        compatibilityRatio: candidate.compatibilityRatio,
      });
      await upsertOpportunityMatch({
        opportunityId: candidate.opportunityId,
        candidateCompanyId: companyId,
        candidateNeedId: need.id,
        result,
      });
      if (!result.eliminated) {
        results.push({
          score: result.score,
          confidence: result.confidence,
          breakdown: result.breakdown,
          opportunityId: candidate.opportunityId,
          ownerCompanyId: candidate.intent.companyId,
        });
      }
    }
  }

  for (const offer of offers ?? []) {
    const offerIntent: MatchableIntent = {
      id: offer.id,
      kind: "offer",
      companyId,
      capabilityTypeCode: offer.capability_type_code,
      industryId: offer.industry_id,
      targetCountryCode: offer.target_country_code,
      targetRegion: offer.target_region,
      productServiceIds: (offer.products ?? []).map(
        (p) => p.product_service_id,
      ),
      languageCodes: (offer.langs ?? []).map((l) => l.language_code),
    };
    const candidates = await fetchSeekingOpportunityCandidatesForOffer(
      supabase,
      lookup,
      { capabilityTypeCode: offer.capability_type_code },
      companyId,
    );
    for (const candidate of candidates) {
      const ownerProfile = await fetchCompanyProfile(
        supabase,
        candidate.intent.companyId,
      );
      const result = computeMatchScore({
        seekerIntent: candidate.intent,
        seekerCompany: ownerProfile,
        providerIntent: offerIntent,
        providerCompany: selfProfile,
        compatibilityRatio: candidate.compatibilityRatio,
      });
      await upsertOpportunityMatch({
        opportunityId: candidate.opportunityId,
        candidateCompanyId: companyId,
        candidateOfferId: offer.id,
        result,
      });
      if (!result.eliminated) {
        results.push({
          score: result.score,
          confidence: result.confidence,
          breakdown: result.breakdown,
          opportunityId: candidate.opportunityId,
          ownerCompanyId: candidate.intent.companyId,
        });
      }
    }
  }

  const displayed = results
    .filter((r) => r.score >= DISPLAY_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (displayed.length === 0) return [];

  const { data: opportunityRows } = await supabase
    .from("opportunities")
    .select("id, title, slug, company_id")
    .in(
      "id",
      displayed.map((r) => r.opportunityId),
    );
  const names = await attachCompanyDisplayInfo(
    supabase,
    displayed.map((r) => r.ownerCompanyId),
  );
  const opportunityInfo = new Map(
    (opportunityRows ?? []).map((o) => [o.id, o]),
  );

  return displayed.map((r) => {
    const info = opportunityInfo.get(r.opportunityId);
    return {
      score: r.score,
      confidence: r.confidence,
      level: getMatchLevel(r.score),
      confidenceLevel: getConfidenceLevel(r.confidence),
      breakdown: r.breakdown,
      opportunityId: r.opportunityId,
      title: info?.title ?? "",
      slug: info?.slug ?? null,
      companyName: names.get(r.ownerCompanyId)?.display_name ?? "",
    };
  });
}
