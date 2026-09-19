import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateCompanyProfile, MatchableIntent } from "./types";

/**
 * Génération de candidats (SQL) — étape PRÉALABLE au calcul de score
 * (TypeScript, voir scoring.ts). Toute l'optimisation de performance (§24
 * du cahier des charges Phase 6 : ne jamais comparer une entreprise à
 * l'ensemble de la base) vit ici : les filtres SQL (compatibilité,
 * statut actif, entreprise exclue) réduisent l'ensemble à comparer AVANT
 * que le scoring détaillé ne s'exécute, jamais après.
 *
 * Utilise le client serveur "normal" (pas la clé secrète) : les offres et
 * besoins actifs d'entreprises actives sont déjà publics par RLS, donc
 * aucun privilège élevé n'est nécessaire pour LIRE les candidats — seule
 * l'ÉCRITURE des résultats dans matches/opportunity_matches exige la clé
 * secrète (voir persistence.ts).
 */

type CompatibilityLookup = Map<string, Map<string, number>>;

/**
 * Charge la matrice de compatibilité croisée une seule fois par exécution
 * du moteur (petite table, jamais des dizaines de milliers de lignes).
 * La règle réflexive (même code = 1.0) N'EST PAS stockée en base : elle
 * est appliquée ici, au moment de la lecture — voir getCompatibilityRatio.
 */
export async function loadCompatibilityLookup(
  supabase: SupabaseClient,
): Promise<CompatibilityLookup> {
  const { data } = await supabase
    .from("capability_compatibility")
    .select("need_code, offer_code, compatibility_ratio");

  const lookup: CompatibilityLookup = new Map();
  for (const row of data ?? []) {
    if (!lookup.has(row.need_code)) lookup.set(row.need_code, new Map());
    lookup
      .get(row.need_code)!
      .set(row.offer_code, Number(row.compatibility_ratio));
  }
  return lookup;
}

export function getCompatibilityRatio(
  lookup: CompatibilityLookup,
  needCode: string,
  offerCode: string,
): number {
  if (needCode === offerCode) return 1;
  return lookup.get(needCode)?.get(offerCode) ?? 0;
}

/** Codes d'offre compatibles avec un code de besoin donné (même code + table croisée). */
function compatibleOfferCodes(
  lookup: CompatibilityLookup,
  needCode: string,
): string[] {
  const codes = new Set<string>([needCode]);
  for (const code of lookup.get(needCode)?.keys() ?? []) codes.add(code);
  return [...codes];
}

/** Codes de besoin compatibles avec un code d'offre donné (symétrique de la fonction ci-dessus). */
function compatibleNeedCodes(
  lookup: CompatibilityLookup,
  offerCode: string,
): string[] {
  const codes = new Set<string>([offerCode]);
  for (const [needCode, offers] of lookup.entries()) {
    if (offers.has(offerCode)) codes.add(needCode);
  }
  return [...codes];
}

type OfferCandidateRow = {
  id: string;
  company_id: string;
  capability_type_code: string;
  industry_id: string | null;
  target_country_code: string | null;
  target_region: string | null;
  products: { product_service_id: string }[] | null;
  langs: { language_code: string }[] | null;
  companies: {
    id: string;
    country_code: string;
    verification_status: "unverified" | "pending" | "verified";
    export_experience: boolean;
    employee_range: string | null;
    status: string;
    company_languages: { language_code: string }[] | null;
  } | null;
};

function toCandidateCompanyProfile(
  company: OfferCandidateRow["companies"],
  hasLinkedProductsServices: boolean,
): CandidateCompanyProfile {
  return {
    companyId: company?.id ?? "",
    countryCode: company?.country_code ?? "",
    verificationStatus: company?.verification_status ?? "unverified",
    exportExperience: company?.export_experience ?? false,
    employeeRange: company?.employee_range ?? null,
    languageCodes: (company?.company_languages ?? []).map(
      (l) => l.language_code,
    ),
    hasLinkedProductsServices,
  };
}

export interface OfferCandidate {
  offerId: string;
  intent: MatchableIntent;
  company: CandidateCompanyProfile;
  compatibilityRatio: number;
}

/**
 * Offres actives compatibles avec un besoin donné, hors entreprises
 * appartenant à `excludeCompanyId` (jamais une entreprise avec elle-même —
 * §18) et hors entreprises non actives (suspendues/brouillon/archivées).
 */
export async function fetchOfferCandidatesForNeed(
  supabase: SupabaseClient,
  lookup: CompatibilityLookup,
  need: {
    capabilityTypeCode: string;
  },
  excludeCompanyId: string,
): Promise<OfferCandidate[]> {
  const codes = compatibleOfferCodes(lookup, need.capabilityTypeCode);
  const { data } = await supabase
    .from("company_offers")
    .select(
      "id, company_id, capability_type_code, industry_id, target_country_code, target_region, " +
        "products:company_offer_products_services(product_service_id), langs:company_offer_languages(language_code), " +
        "companies!inner(id, country_code, verification_status, export_experience, employee_range, status, company_languages(language_code))",
    )
    .eq("status", "active")
    .in("capability_type_code", codes)
    .eq("companies.status", "active")
    .neq("company_id", excludeCompanyId)
    .returns<OfferCandidateRow[]>();

  return (data ?? []).map((row) => {
    const productServiceIds = (row.products ?? []).map(
      (p) => p.product_service_id,
    );
    return {
      offerId: row.id,
      intent: {
        id: row.id,
        kind: "offer",
        companyId: row.company_id,
        capabilityTypeCode: row.capability_type_code,
        industryId: row.industry_id,
        targetCountryCode: row.target_country_code,
        targetRegion: row.target_region,
        productServiceIds,
        languageCodes: (row.langs ?? []).map((l) => l.language_code),
      },
      company: toCandidateCompanyProfile(
        row.companies,
        productServiceIds.length > 0,
      ),
      compatibilityRatio: getCompatibilityRatio(
        lookup,
        need.capabilityTypeCode,
        row.capability_type_code,
      ),
    };
  });
}

type NeedCandidateRow = {
  id: string;
  company_id: string;
  capability_type_code: string;
  industry_id: string | null;
  target_country_code: string | null;
  target_region: string | null;
  sought_employee_range: string | null;
  products: { product_service_id: string }[] | null;
  langs: { language_code: string }[] | null;
  companies: OfferCandidateRow["companies"];
};

export interface NeedCandidate {
  needId: string;
  intent: MatchableIntent;
  company: CandidateCompanyProfile;
  compatibilityRatio: number;
}

/** Symétrique de fetchOfferCandidatesForNeed : besoins actifs compatibles avec une offre donnée. */
export async function fetchNeedCandidatesForOffer(
  supabase: SupabaseClient,
  lookup: CompatibilityLookup,
  offer: {
    capabilityTypeCode: string;
  },
  excludeCompanyId: string,
): Promise<NeedCandidate[]> {
  const codes = compatibleNeedCodes(lookup, offer.capabilityTypeCode);
  const { data } = await supabase
    .from("company_needs")
    .select(
      "id, company_id, capability_type_code, industry_id, target_country_code, target_region, sought_employee_range, " +
        "products:company_need_products_services(product_service_id), langs:company_need_languages(language_code), " +
        "companies!inner(id, country_code, verification_status, export_experience, employee_range, status, company_languages(language_code))",
    )
    .eq("status", "active")
    .in("capability_type_code", codes)
    .eq("companies.status", "active")
    .neq("company_id", excludeCompanyId)
    .returns<NeedCandidateRow[]>();

  return (data ?? []).map((row) => {
    const productServiceIds = (row.products ?? []).map(
      (p) => p.product_service_id,
    );
    return {
      needId: row.id,
      intent: {
        id: row.id,
        kind: "need",
        companyId: row.company_id,
        capabilityTypeCode: row.capability_type_code,
        industryId: row.industry_id,
        targetCountryCode: row.target_country_code,
        targetRegion: row.target_region,
        productServiceIds,
        languageCodes: (row.langs ?? []).map((l) => l.language_code),
        soughtEmployeeRange: row.sought_employee_range,
      },
      company: toCandidateCompanyProfile(
        row.companies,
        productServiceIds.length > 0,
      ),
      compatibilityRatio: getCompatibilityRatio(
        lookup,
        row.capability_type_code,
        offer.capabilityTypeCode,
      ),
    };
  });
}

type OpportunityRow = {
  id: string;
  company_id: string;
  capability_type_code: string;
  direction: "seeking" | "offering";
  industry_id: string | null;
  target_country_code: string | null;
  target_region: string | null;
  language_code: string;
  products: { product_service_id: string }[] | null;
};

/**
 * Adapte une opportunité à la forme commune MatchableIntent, pour que le
 * même moteur de scoring (scoring.ts) traite entreprise↔entreprise et
 * opportunité↔entreprise sans logique dupliquée. `direction` détermine si
 * l'opportunité se comporte comme un besoin (seeking) ou une offre (offering).
 */
export function opportunityToIntent(row: OpportunityRow): MatchableIntent {
  return {
    id: row.id,
    kind:
      row.direction === "seeking"
        ? "opportunity_seeking"
        : "opportunity_offering",
    companyId: row.company_id,
    capabilityTypeCode: row.capability_type_code,
    industryId: row.industry_id,
    targetCountryCode: row.target_country_code,
    targetRegion: row.target_region,
    productServiceIds: (row.products ?? []).map((p) => p.product_service_id),
    languageCodes: [row.language_code],
  };
}

const OPPORTUNITY_SELECT =
  "id, company_id, capability_type_code, direction, industry_id, target_country_code, target_region, language_code, " +
  "products:opportunity_products_services(product_service_id)";

/**
 * Charge une opportunité publiée et NON EXPIRÉE (§40 : expires_at < now()
 * exclut même si status affiche encore 'published' — l'expiration n'est
 * pas recalculée par tâche de fond, voir docs/DATABASE.md ATTENTION).
 */
export async function fetchPublishedOpportunity(
  supabase: SupabaseClient,
  opportunityId: string,
): Promise<OpportunityRow | null> {
  const { data } = await supabase
    .from("opportunities")
    .select(OPPORTUNITY_SELECT)
    .eq("id", opportunityId)
    .eq("status", "published")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<OpportunityRow>();
  return data ?? null;
}

export interface OpportunityCandidate {
  opportunityId: string;
  intent: MatchableIntent;
  compatibilityRatio: number;
}

/**
 * Opportunités publiées, non expirées, en direction 'offering' (elles se
 * comportent comme une offre) compatibles avec un BESOIN donné — utilisé
 * pour "OPPORTUNITÉS POUR VOUS" côté entreprise (§21/§28).
 */
export async function fetchOfferingOpportunityCandidatesForNeed(
  supabase: SupabaseClient,
  lookup: CompatibilityLookup,
  need: { capabilityTypeCode: string },
  excludeCompanyId: string,
): Promise<OpportunityCandidate[]> {
  const codes = compatibleOfferCodes(lookup, need.capabilityTypeCode);
  const { data } = await supabase
    .from("opportunities")
    .select(OPPORTUNITY_SELECT)
    .eq("status", "published")
    .eq("direction", "offering")
    .gt("expires_at", new Date().toISOString())
    .in("capability_type_code", codes)
    .neq("company_id", excludeCompanyId)
    .returns<OpportunityRow[]>();

  return (data ?? []).map((row) => ({
    opportunityId: row.id,
    intent: opportunityToIntent(row),
    compatibilityRatio: getCompatibilityRatio(
      lookup,
      need.capabilityTypeCode,
      row.capability_type_code,
    ),
  }));
}

/**
 * Symétrique : opportunités en direction 'seeking' (se comportent comme un
 * besoin) compatibles avec une OFFRE donnée.
 */
export async function fetchSeekingOpportunityCandidatesForOffer(
  supabase: SupabaseClient,
  lookup: CompatibilityLookup,
  offer: { capabilityTypeCode: string },
  excludeCompanyId: string,
): Promise<OpportunityCandidate[]> {
  const codes = compatibleNeedCodes(lookup, offer.capabilityTypeCode);
  const { data } = await supabase
    .from("opportunities")
    .select(OPPORTUNITY_SELECT)
    .eq("status", "published")
    .eq("direction", "seeking")
    .gt("expires_at", new Date().toISOString())
    .in("capability_type_code", codes)
    .neq("company_id", excludeCompanyId)
    .returns<OpportunityRow[]>();

  return (data ?? []).map((row) => ({
    opportunityId: row.id,
    intent: opportunityToIntent(row),
    compatibilityRatio: getCompatibilityRatio(
      lookup,
      row.capability_type_code,
      offer.capabilityTypeCode,
    ),
  }));
}

export async function fetchCompanyProfile(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CandidateCompanyProfile> {
  const { data } = await supabase
    .from("companies")
    .select(
      "id, country_code, verification_status, export_experience, employee_range, company_languages(language_code)",
    )
    .eq("id", companyId)
    .single();

  return {
    companyId: data?.id ?? companyId,
    countryCode: data?.country_code ?? "",
    verificationStatus: data?.verification_status ?? "unverified",
    exportExperience: data?.export_experience ?? false,
    employeeRange: data?.employee_range ?? null,
    languageCodes: (data?.company_languages ?? []).map(
      (l: { language_code: string }) => l.language_code,
    ),
    hasLinkedProductsServices: false,
  };
}
