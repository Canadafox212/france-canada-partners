import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { searchCompanies, type DirectorySearchParams } from "./search";

/**
 * `generateMetadata()` (pour le SEO, §25) et le composant de page ont tous
 * les deux besoin du résultat de recherche (nombre de résultats compris),
 * mais Next.js les exécute séparément, sans partager entre elles les appels
 * réseau non-`fetch()` (notre client Supabase). `React.cache()` mémoïse un
 * appel pour la durée d'UNE requête — à condition de ne lui passer que des
 * arguments PRIMITIFS (comparés par valeur) : un objet reconstruit à
 * chaque appel serait, lui, toujours considéré différent (comparaison par
 * référence) et casserait la mémoïsation. D'où la signature "à plat"
 * ci-dessous plutôt qu'un unique objet `DirectorySearchParams`.
 */
export const loadDirectoryResults = cache(
  async (
    q: string | undefined,
    countryCode: string | undefined,
    region: string | undefined,
    city: string | undefined,
    industryId: string | undefined,
    subindustryId: string | undefined,
    productServiceId: string | undefined,
    offeringCapabilityCode: string | undefined,
    seekingCapabilityCode: string | undefined,
    targetCountryCode: string | undefined,
    verifiedOnly: boolean,
    activeOpportunitiesOnly: boolean,
    sort: DirectorySearchParams["sort"],
    page: number,
  ) => {
    const supabase = await createClient();
    return searchCompanies(supabase, {
      q,
      countryCode,
      region,
      city,
      industryId,
      subindustryId,
      productServiceId,
      offeringCapabilityCode,
      seekingCapabilityCode,
      targetCountryCode,
      verifiedOnly,
      activeOpportunitiesOnly,
      sort,
      page,
    });
  },
);

export function directoryParamsFromSearchParams(
  searchParams: Record<string, string | undefined>,
  fixed: Partial<DirectorySearchParams> = {},
): DirectorySearchParams {
  return {
    q: searchParams.q || undefined,
    countryCode:
      fixed.countryCode ?? (searchParams.country?.toUpperCase() || undefined),
    region: fixed.region ?? (searchParams.region || undefined),
    city: searchParams.city || undefined,
    industryId: fixed.industryId ?? (searchParams.industry || undefined),
    subindustryId: searchParams.subindustry || undefined,
    productServiceId: searchParams.product || undefined,
    offeringCapabilityCode: searchParams.offering || undefined,
    seekingCapabilityCode: searchParams.seeking || undefined,
    targetCountryCode: searchParams.target?.toUpperCase() || undefined,
    verifiedOnly: searchParams.verified === "1",
    activeOpportunitiesOnly: searchParams.activeOpportunities === "1",
    sort: (searchParams.sort as DirectorySearchParams["sort"]) || "relevance",
    page: searchParams.page ? Number(searchParams.page) || 1 : 1,
  };
}
