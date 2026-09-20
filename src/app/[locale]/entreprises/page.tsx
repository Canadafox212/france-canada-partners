import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import {
  directoryParamsFromSearchParams,
  loadDirectoryResults,
} from "@/lib/directory/pageData";
import { shouldIndexDirectoryPage } from "@/lib/directory/search";
import { DirectoryPageBody } from "@/components/directory/DirectoryPageBody";

type SearchParams = Record<string, string | undefined>;

async function loadCatalogs(activeLocale: AppLocale) {
  const supabase = await createClient();
  const [
    { data: industries },
    { data: productsServices },
    { data: capabilityTypes },
  ] = await Promise.all([
    supabase.from("industries").select("id, name_fr, name_en").order("name_fr"),
    supabase
      .from("products_services")
      .select("id, label_fr, label_en")
      .order("label_fr"),
    supabase
      .from("business_capability_types")
      .select("code, label_fr, label_en, applies_to_offers, applies_to_needs")
      .eq("is_active", true),
  ]);

  const labelFor = (row: {
    label_fr?: string;
    label_en?: string;
    name_fr?: string;
    name_en?: string;
  }) =>
    activeLocale === "en"
      ? (row.label_en ?? row.name_en ?? "")
      : (row.label_fr ?? row.name_fr ?? "");

  return {
    industries: (industries ?? []).map((i) => ({
      value: i.id,
      label: labelFor(i),
    })),
    productsServices: (productsServices ?? []).map((p) => ({
      value: p.id,
      label: labelFor(p),
    })),
    offeringCapabilityTypes: (capabilityTypes ?? [])
      .filter((c) => c.applies_to_offers)
      .map((c) => ({ value: c.code, label: labelFor(c) })),
    seekingCapabilityTypes: (capabilityTypes ?? [])
      .filter((c) => c.applies_to_needs)
      .map((c) => ({ value: c.code, label: labelFor(c) })),
    capabilityLabels: Object.fromEntries(
      (capabilityTypes ?? []).map((c) => [c.code, labelFor(c)]),
    ),
  };
}

async function runSearch(searchParams: SearchParams) {
  const params = directoryParamsFromSearchParams(searchParams);
  return loadDirectoryResults(
    params.q,
    params.countryCode,
    params.region,
    params.city,
    params.industryId,
    params.subindustryId,
    params.productServiceId,
    params.offeringCapabilityCode,
    params.seekingCapabilityCode,
    params.targetCountryCode,
    params.verifiedOnly ?? false,
    params.activeOpportunitiesOnly ?? false,
    params.sort ?? "relevance",
    params.page ?? 1,
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("Directory");
  const result = await runSearch(params);

  const activeStructuralFilterCount = [
    params.country,
    params.region,
    params.industry,
    params.product,
    params.offering,
    params.seeking,
    params.target,
  ].filter(Boolean).length;

  const index = shouldIndexDirectoryPage({
    hasFreeTextQuery: !!params.q,
    activeStructuralFilterCount,
    resultCount: result.items.length,
  });

  return {
    title: t("listTitle"),
    description: t("listSubtitle"),
    alternates: { canonical: "/entreprises" },
    robots: index ? undefined : { index: false, follow: true },
  };
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const [activeLocaleValue, user] = await Promise.all([
    locale(),
    getCurrentUser(),
  ]);
  const activeLocale = activeLocaleValue as AppLocale;

  const [t, catalogs, result] = await Promise.all([
    getTranslations("Directory"),
    loadCatalogs(activeLocale),
    runSearch(rawSearchParams),
  ]);

  const basePath = getPathname({ href: "/entreprises", locale: activeLocale });

  return (
    <DirectoryPageBody
      title={t("listTitle")}
      subtitle={t("listSubtitle")}
      breadcrumbs={[{ label: t("listTitle") }]}
      basePath={basePath}
      rawSearchParams={rawSearchParams}
      result={result}
      lockedFilters={{}}
      industries={catalogs.industries}
      productsServices={catalogs.productsServices}
      offeringCapabilityTypes={catalogs.offeringCapabilityTypes}
      seekingCapabilityTypes={catalogs.seekingCapabilityTypes}
      capabilityLabels={catalogs.capabilityLabels}
      isAuthenticated={!!user}
    />
  );
}
