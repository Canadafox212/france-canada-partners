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
  /** Identifie la paire à l'origine du match, pour l'explication contextuelle. */
  sourceLabel: string;
}

async function attachCompanyDisplayInfo(
  supabase: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, { display_name: string; country_code: string }>> {
  if (companyIds.length === 0) return new Map();
  const { data } = await supabase
    .from("companies")
    .select("id, display_name, country_code")
    .in("id", [...new Set(companyIds)]);
  return new Map((data ?? []).map((c) => [c.id, c]));
}

function toDisplayItem(
  score: number,
  confidence: number,
  breakdown: CriterionResult[],
  companyId: string,
  names: Map<string, { display_name: string; country_code: string }>,
  sourceLabel: string,
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
    sourceLabel,
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
      await upsertMatch({
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
      await upsertMatch({
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
