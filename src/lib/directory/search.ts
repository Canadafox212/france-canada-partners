import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Couche de lecture de l'annuaire public (Phase 7). Toute la logique de
 * filtrage/tri/pagination vit côté base (fonction SQL `search_companies`,
 * voir supabase/migrations/0017_public_directory_search.sql) : ce fichier
 * ne fait que traduire des paramètres d'URL en arguments RPC et mettre en
 * forme le résultat — voir docs/DIRECTORY.md.
 */

export const DIRECTORY_PAGE_SIZE = 20;

export type CompanySortOption = "relevance" | "name" | "recent";

export interface DirectorySearchParams {
  q?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  industryId?: string;
  subindustryId?: string;
  productServiceId?: string;
  offeringCapabilityCode?: string;
  seekingCapabilityCode?: string;
  targetCountryCode?: string;
  verifiedOnly?: boolean;
  activeOpportunitiesOnly?: boolean;
  sort?: CompanySortOption;
  page?: number;
}

export interface DirectoryResultItem {
  id: string;
  displayName: string;
  slug: string;
  countryCode: string;
  region: string | null;
  city: string | null;
  verificationStatus: "unverified" | "pending" | "verified";
  primaryIndustryNameFr: string | null;
  primaryIndustryNameEn: string | null;
  activeOpportunitiesCount: number;
  offeringCapabilityCodes: string[];
  seekingCapabilityCodes: string[];
}

export interface DirectorySearchResult {
  items: DirectoryResultItem[];
  hasNextPage: boolean;
  page: number;
}

type SearchCompaniesRow = {
  id: string;
  display_name: string;
  slug: string;
  country_code: string;
  region: string | null;
  city: string | null;
  verification_status: "unverified" | "pending" | "verified";
  primary_industry_name_fr: string | null;
  primary_industry_name_en: string | null;
  active_opportunities_count: number | string;
  offering_capability_codes: string[] | null;
  seeking_capability_codes: string[] | null;
};

function isValidSort(value: unknown): value is CompanySortOption {
  return value === "relevance" || value === "name" || value === "recent";
}

/**
 * Une recherche libre (p_query) désactive le classement par pertinence côté
 * SQL si le tri demandé n'est pas 'relevance' ; ici on laisse simplement la
 * fonction SQL gérer la priorité (elle retombe sur le nom si la pertinence
 * ne s'applique pas), donc aucune logique supplémentaire n'est nécessaire.
 */
export async function searchCompanies(
  supabase: SupabaseClient,
  params: DirectorySearchParams,
): Promise<DirectorySearchResult> {
  const page = Math.max(1, Math.trunc(params.page ?? 1) || 1);
  const offset = (page - 1) * DIRECTORY_PAGE_SIZE;
  const sort = isValidSort(params.sort) ? params.sort : "relevance";

  const { data, error } = await supabase.rpc("search_companies", {
    p_query: params.q?.trim() || null,
    p_country_code: params.countryCode || null,
    p_region: params.region || null,
    p_city: params.city || null,
    p_industry_id: params.industryId || null,
    p_subindustry_id: params.subindustryId || null,
    p_product_service_id: params.productServiceId || null,
    p_offering_capability_code: params.offeringCapabilityCode || null,
    p_seeking_capability_code: params.seekingCapabilityCode || null,
    p_target_country_code: params.targetCountryCode || null,
    p_verified_only: params.verifiedOnly ?? false,
    p_active_opportunities_only: params.activeOpportunitiesOnly ?? false,
    p_sort: sort,
    p_limit: DIRECTORY_PAGE_SIZE + 1,
    p_offset: offset,
  });

  if (error) throw error;

  const rows = (data ?? []) as SearchCompaniesRow[];
  const hasNextPage = rows.length > DIRECTORY_PAGE_SIZE;
  const items: DirectoryResultItem[] = rows
    .slice(0, DIRECTORY_PAGE_SIZE)
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      slug: row.slug,
      countryCode: row.country_code,
      region: row.region,
      city: row.city,
      verificationStatus: row.verification_status,
      primaryIndustryNameFr: row.primary_industry_name_fr,
      primaryIndustryNameEn: row.primary_industry_name_en,
      activeOpportunitiesCount: Number(row.active_opportunities_count),
      offeringCapabilityCodes: row.offering_capability_codes ?? [],
      seekingCapabilityCodes: row.seeking_capability_codes ?? [],
    }));

  return { items, hasNextPage, page };
}

/**
 * Décide si une page d'annuaire filtrée mérite d'être indexée (§25) :
 * jamais pour une recherche libre (texte arbitraire, non pertinent pour un
 * moteur de recherche), jamais pour une combinaison de plus d'un filtre
 * structurel (évite l'explosion combinatoire de pages quasi vides), et
 * seulement au-delà d'un nombre minimal de résultats. Fonction pure,
 * testée unitairement (tests/unit/directory/indexing.test.ts) — voir
 * docs/DIRECTORY.md §SEO des listes.
 */
export function shouldIndexDirectoryPage(params: {
  hasFreeTextQuery: boolean;
  activeStructuralFilterCount: number;
  resultCount: number;
}): boolean {
  const MIN_RESULTS_TO_INDEX = 5;
  if (params.hasFreeTextQuery) return false;
  if (params.activeStructuralFilterCount > 1) return false;
  return params.resultCount >= MIN_RESULTS_TO_INDEX;
}
