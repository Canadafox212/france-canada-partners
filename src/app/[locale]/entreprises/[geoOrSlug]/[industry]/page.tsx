import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import { resolveGeoSlug } from "@/lib/directory/geoSlugs";
import {
  directoryParamsFromSearchParams,
  loadDirectoryResults,
} from "@/lib/directory/pageData";
import { shouldIndexDirectoryPage } from "@/lib/directory/search";
import { DirectoryPageBody } from "@/components/directory/DirectoryPageBody";

type Params = { geoOrSlug: string; industry: string };
type SearchParams = Record<string, string | undefined>;

/**
 * Deuxième niveau des URLs géographiques/sectorielles (§8 du cahier des
 * charges Phase 7, ex. /entreprises/quebec/distribution). Le premier
 * segment DOIT être une zone géographique reconnue ici (contrairement à
 * "/entreprises/[geoOrSlug]" qui accepte aussi un slug d'entreprise) : une
 * fiche entreprise n'a jamais de sous-page, donc toute combinaison
 * "slug-entreprise/quelque-chose" est un 404, jamais une tentative de
 * désambiguïsation supplémentaire.
 */
async function resolveIndustryBySlug(industrySlug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("industries")
    .select("id, name_fr, name_en, slug")
    .eq("slug", industrySlug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { geoOrSlug, industry: industrySlug } = await params;
  const geo = resolveGeoSlug(geoOrSlug);
  if (!geo) return {};
  const industry = await resolveIndustryBySlug(industrySlug);
  if (!industry) return {};

  const rawSearchParams = await searchParams;
  const t = await getTranslations("Directory");
  const fixedParams = directoryParamsFromSearchParams(rawSearchParams, {
    countryCode: geo.countryCode,
    region: geo.region,
    industryId: industry.id,
  });
  const result = await loadDirectoryResults(
    fixedParams.q,
    fixedParams.countryCode,
    fixedParams.region,
    fixedParams.city,
    fixedParams.industryId,
    fixedParams.subindustryId,
    fixedParams.productServiceId,
    fixedParams.offeringCapabilityCode,
    fixedParams.seekingCapabilityCode,
    fixedParams.targetCountryCode,
    fixedParams.verifiedOnly ?? false,
    fixedParams.activeOpportunitiesOnly ?? false,
    fixedParams.sort ?? "relevance",
    fixedParams.page ?? 1,
  );
  // Géo + secteur sont tous les deux des segments ÉDITORIAUX (voir la même
  // remarque dans "/entreprises/[geoOrSlug]") : seuls les filtres
  // supplémentaires de la query string comptent pour le seuil du §25.
  const extraStructuralFilterCount = [
    rawSearchParams.city,
    rawSearchParams.product,
    rawSearchParams.offering,
    rawSearchParams.seeking,
    rawSearchParams.target,
  ].filter(Boolean).length;
  const index = shouldIndexDirectoryPage({
    hasFreeTextQuery: !!rawSearchParams.q,
    activeStructuralFilterCount: extraStructuralFilterCount,
    resultCount: result.items.length,
  });

  return {
    title: `${t("listTitle")} — ${industry.name_fr} — ${geo.labelFr}`,
    description: t("listSubtitle"),
    alternates: { canonical: `/entreprises/${geoOrSlug}/${industrySlug}` },
    robots: index ? undefined : { index: false, follow: true },
  };
}

export default async function EntrepriseGeoIndustryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { geoOrSlug, industry: industrySlug } = await params;
  const geo = resolveGeoSlug(geoOrSlug);
  if (!geo) notFound();

  const industry = await resolveIndustryBySlug(industrySlug);
  if (!industry) notFound();

  const rawSearchParams = await searchParams;
  const [activeLocaleValue, user, t] = await Promise.all([
    locale(),
    getCurrentUser(),
    getTranslations("Directory"),
  ]);
  const activeLocale = activeLocaleValue as AppLocale;

  const fixedParams = directoryParamsFromSearchParams(rawSearchParams, {
    countryCode: geo.countryCode,
    region: geo.region,
    industryId: industry.id,
  });
  const result = await loadDirectoryResults(
    fixedParams.q,
    fixedParams.countryCode,
    fixedParams.region,
    fixedParams.city,
    fixedParams.industryId,
    fixedParams.subindustryId,
    fixedParams.productServiceId,
    fixedParams.offeringCapabilityCode,
    fixedParams.seekingCapabilityCode,
    fixedParams.targetCountryCode,
    fixedParams.verifiedOnly ?? false,
    fixedParams.activeOpportunitiesOnly ?? false,
    fixedParams.sort ?? "relevance",
    fixedParams.page ?? 1,
  );

  const industryLabel =
    activeLocale === "en" ? industry.name_en : industry.name_fr;
  const basePath = `${getPathname({ href: "/entreprises", locale: activeLocale })}/${geoOrSlug}/${industrySlug}`;

  return (
    <DirectoryPageBody
      title={`${t("listTitle")} — ${industryLabel} — ${geo.labelFr}`}
      subtitle={t("listSubtitle")}
      breadcrumbs={[
        { label: t("listTitle"), href: "/entreprises" },
        {
          label: geo.labelFr,
          href: { pathname: "/entreprises/[geoOrSlug]", params: { geoOrSlug } },
        },
        { label: industryLabel },
      ]}
      basePath={basePath}
      rawSearchParams={rawSearchParams}
      result={result}
      lockedFilters={{ country: true, region: !!geo.region, industry: true }}
      industries={[]}
      productsServices={[]}
      offeringCapabilityTypes={[]}
      seekingCapabilityTypes={[]}
      capabilityLabels={{}}
      isAuthenticated={!!user}
    />
  );
}
