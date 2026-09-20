import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { Link, getPathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/session";
import { pickCompanyTranslation } from "@/lib/companies";
import { resolveGeoSlug } from "@/lib/directory/geoSlugs";
import {
  directoryParamsFromSearchParams,
  loadDirectoryResults,
} from "@/lib/directory/pageData";
import { shouldIndexDirectoryPage } from "@/lib/directory/search";
import { DirectoryPageBody } from "@/components/directory/DirectoryPageBody";
import { loadCompanyBySlug } from "@/lib/directory/companyPageData";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ClaimCompanyForm } from "@/components/claims/ClaimCompanyForm";
import { CopyLinkButton } from "@/components/directory/CopyLinkButton";
import { MatchCard } from "@/components/matching/MatchCard";
import { getCompatibilityBetweenCompanies } from "@/lib/matching/service";

type Params = { geoOrSlug: string };
type SearchParams = Record<string, string | undefined>;

/**
 * supabase-js ne peut pas toujours déduire qu'une relation embarquée est
 * "à un seul élément" (dépend d'une contrainte unique reconnue côté
 * schéma) et la type alors en tableau par précaution — même pattern
 * défensif déjà utilisé pour les opportunités (voir la fiche publique
 * d'opportunité, Phase 5).
 */
function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

async function loadCatalogsForGeo(activeLocale: AppLocale) {
  const supabase = await createClient();
  const { data: industries } = await supabase
    .from("industries")
    .select("id, name_fr, name_en")
    .order("name_fr");
  const labelFor = (row: { name_fr: string; name_en: string }) =>
    activeLocale === "en" ? row.name_en : row.name_fr;
  return {
    industries: (industries ?? []).map((i) => ({
      value: i.id,
      label: labelFor(i),
    })),
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { geoOrSlug } = await params;
  const geo = resolveGeoSlug(geoOrSlug);

  if (geo) {
    const rawSearchParams = await searchParams;
    const t = await getTranslations("Directory");
    const fixedParams = directoryParamsFromSearchParams(rawSearchParams, {
      countryCode: geo.countryCode,
      region: geo.region,
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
    // Le segment géographique de l'URL est un choix ÉDITORIAL (un petit
    // ensemble fixe, voir geoSlugs.ts), pas un filtre arbitraire choisi par
    // un visiteur : il ne compte donc pas dans le seuil du §25, qui vise
    // spécifiquement à éviter d'indexer des combinaisons arbitraires
    // produites par le formulaire interactif. Seuls les filtres
    // SUPPLÉMENTAIRES ajoutés via la query string comptent ici.
    const extraStructuralFilterCount = [
      rawSearchParams.city,
      rawSearchParams.industry,
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
      title: `${t("listTitle")} — ${geo.labelFr}`,
      description: t("listSubtitle"),
      alternates: { canonical: `/entreprises/${geoOrSlug}` },
      robots: index ? undefined : { index: false, follow: true },
    };
  }

  const company = await loadCompanyBySlug(geoOrSlug);
  if (!company || company.status !== "active") return {};

  const activeLocale = (await locale()) as AppLocale;
  const translation = pickCompanyTranslation(
    company.company_translations ?? [],
    activeLocale,
  );
  const description = (
    translation?.tagline ||
    translation?.description ||
    ""
  ).slice(0, 160);
  const canonicalPath = `${getPathname({ href: "/entreprises", locale: activeLocale })}/${company.slug}`;

  return {
    title: company.display_name,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: company.display_name,
      description,
      type: "website",
      ...(company.website ? { url: company.website } : {}),
    },
  };
}

export default async function EntrepriseOrGeoPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { geoOrSlug } = await params;
  const geo = resolveGeoSlug(geoOrSlug);
  const [activeLocaleValue, user] = await Promise.all([
    locale(),
    getCurrentUser(),
  ]);
  const activeLocale = activeLocaleValue as AppLocale;

  if (geo) {
    const rawSearchParams = await searchParams;
    const [t, catalogs] = await Promise.all([
      getTranslations("Directory"),
      loadCatalogsForGeo(activeLocale),
    ]);
    const fixedParams = directoryParamsFromSearchParams(rawSearchParams, {
      countryCode: geo.countryCode,
      region: geo.region,
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
    const basePath = `${getPathname({ href: "/entreprises", locale: activeLocale })}/${geoOrSlug}`;

    return (
      <DirectoryPageBody
        title={`${t("listTitle")} — ${geo.labelFr}`}
        subtitle={t("listSubtitle")}
        breadcrumbs={[
          { label: t("listTitle"), href: "/entreprises" },
          { label: geo.labelFr },
        ]}
        basePath={basePath}
        rawSearchParams={rawSearchParams}
        result={result}
        lockedFilters={{ country: true, region: !!geo.region }}
        industries={catalogs.industries}
        productsServices={[]}
        offeringCapabilityTypes={[]}
        seekingCapabilityTypes={[]}
        capabilityLabels={{}}
        isAuthenticated={!!user}
      />
    );
  }

  // --- Sinon : fiche entreprise publique ------------------------------
  const company = await loadCompanyBySlug(geoOrSlug);
  if (!company) notFound();

  const t = await getTranslations("CompanyPublic");
  const supabase = await createClient();

  const [
    { data: offers },
    { data: needs },
    { data: opportunities },
    { data: userCompanies },
  ] = await Promise.all([
    supabase
      .from("company_offers")
      .select(
        "id, title, capability_type_code, business_capability_types(label_fr), products:company_offer_products_services(products_services(label_fr))",
      )
      .eq("company_id", company.id)
      .eq("status", "active"),
    supabase
      .from("company_needs")
      .select(
        "id, title, capability_type_code, business_capability_types(label_fr), products:company_need_products_services(products_services(label_fr))",
      )
      .eq("company_id", company.id)
      .eq("status", "active"),
    supabase
      .from("opportunities")
      .select("id, slug, title, direction")
      .eq("company_id", company.id)
      .eq("status", "published")
      .gt("expires_at", new Date().toISOString()),
    user
      ? supabase
          .from("company_members")
          .select("company_id, role, companies(id, display_name)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .in("role", ["owner", "admin", "member"])
      : Promise.resolve({ data: null }),
  ]);

  const translation = pickCompanyTranslation(
    company.company_translations ?? [],
    activeLocale,
  );
  const primaryLocation =
    company.company_locations?.find((l) => l.is_primary) ??
    company.company_locations?.[0] ??
    null;
  const primaryIndustry =
    company.company_industries?.find((ci) => ci.is_primary) ??
    company.company_industries?.[0] ??
    null;

  const isMember = (userCompanies ?? []).some(
    (m) => m.company_id === company.id,
  );
  const eligibleCompanies = (userCompanies ?? [])
    .map((m) => (Array.isArray(m.companies) ? m.companies[0] : m.companies))
    .filter(
      (c): c is { id: string; display_name: string } =>
        !!c && c.id !== company.id,
    );

  const rawSearchParams = await searchParams;
  const compareWithId = rawSearchParams.compareWith || eligibleCompanies[0]?.id;
  const compatibility =
    compareWithId && eligibleCompanies.some((c) => c.id === compareWithId)
      ? await getCompatibilityBetweenCompanies(
          supabase,
          compareWithId,
          company.id,
        )
      : null;

  let existingClaim: {
    id: string;
    status: "pending" | "verified" | "approved" | "rejected" | "cancelled";
  } | null = null;
  if (user && !isMember) {
    const { data } = await supabase
      .from("company_claims")
      .select("id, status")
      .eq("company_id", company.id)
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existingClaim = data;
  }

  const sourceRecord = company.company_source_records?.[0] ?? null;

  // Données structurées schema.org (§10/§24 du cahier des charges) :
  // uniquement des informations déjà vérifiées/affichées sur la page,
  // jamais une donnée non confirmée (ex. pas de note ou d'avis inventé).
  const structuredData =
    company.status === "active"
      ? {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: company.display_name,
          url: `${getSiteUrl()}/entreprises/${company.slug}`,
          ...(company.website ? { sameAs: [company.website] } : {}),
          ...(primaryLocation
            ? {
                address: {
                  "@type": "PostalAddress",
                  addressLocality: primaryLocation.city ?? undefined,
                  addressRegion: primaryLocation.region ?? undefined,
                  addressCountry: primaryLocation.country_code,
                },
              }
            : {}),
        }
      : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}
      <Breadcrumbs
        items={[
          { label: t("backToDirectory"), href: "/entreprises" },
          { label: company.display_name },
        ]}
      />

      {company.status !== "active" ? (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("notPublicNotice")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            {company.display_name}
          </h1>
          {translation?.tagline ? (
            <p className="text-slate-600 dark:text-slate-300">
              {translation.tagline}
            </p>
          ) : null}
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[
              primaryLocation?.city,
              primaryLocation?.region,
              company.country_code,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
        {company.verification_status === "verified" ? (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
            {t("verifiedLabel")}
          </span>
        ) : null}
      </div>

      {translation?.description ? (
        <p className="text-slate-700 dark:text-slate-200">
          {translation.description}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 text-sm">
        {primaryIndustry ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("sectorsLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {[
                activeLocale === "en"
                  ? one(primaryIndustry.industries)?.name_en
                  : one(primaryIndustry.industries)?.name_fr,
                ...(company.company_subindustries ?? []).map((csi) =>
                  activeLocale === "en"
                    ? one(csi.subindustries)?.name_en
                    : one(csi.subindustries)?.name_fr,
                ),
              ]
                .filter(Boolean)
                .join(" — ")}
            </dd>
          </div>
        ) : null}
        {(company.company_products_services ?? []).length > 0 ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("productsLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {(company.company_products_services ?? [])
                .map((cps) =>
                  activeLocale === "en"
                    ? one(cps.products_services)?.label_en
                    : one(cps.products_services)?.label_fr,
                )
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
        ) : null}
        {(company.company_languages ?? []).length > 0 ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("languagesLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {(company.company_languages ?? [])
                .map((cl) =>
                  activeLocale === "en"
                    ? one(cl.languages)?.name_en
                    : one(cl.languages)?.name_fr,
                )
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
        ) : null}
        {(company.company_certifications ?? []).length > 0 ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("certificationsLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {(company.company_certifications ?? [])
                .map((cc) => one(cc.certifications)?.name)
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
        ) : null}
        {company.website ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("websiteLabel")}
            </dt>
            <dd>
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 underline dark:text-white"
              >
                {company.website}
              </a>
            </dd>
          </div>
        ) : null}
        {company.professional_email ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("emailLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {company.professional_email}
            </dd>
          </div>
        ) : null}
        {company.phone ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("phoneLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">{company.phone}</dd>
          </div>
        ) : null}
      </dl>

      <CopyLinkButton />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("weOfferTitle")}
        </h2>
        {(offers ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("noOffers")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(offers ?? []).map((o) => (
              <li
                key={o.id}
                className="text-sm text-slate-700 dark:text-slate-200"
              >
                {o.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("weSeekTitle")}
        </h2>
        {(needs ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("noNeeds")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(needs ?? []).map((n) => (
              <li
                key={n.id}
                className="text-sm text-slate-700 dark:text-slate-200"
              >
                {n.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("activeOpportunitiesTitle")}
        </h2>
        {(opportunities ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("noActiveOpportunities")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(opportunities ?? []).map((o) => (
              <li key={o.id}>
                <Link
                  href={{
                    pathname: "/opportunites/[slug]",
                    params: { slug: o.slug! },
                  }}
                  className="text-sm text-slate-900 underline dark:text-white"
                >
                  {o.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sourceRecord && !company.claimed_at ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {t("sourceLabel")} : {one(sourceRecord.data_sources)?.name}
          {sourceRecord.last_verified_at
            ? ` — ${t("lastVerifiedLabel")} : ${sourceRecord.last_verified_at}`
            : ""}
        </p>
      ) : null}

      {user ? (
        eligibleCompanies.length > 0 ? (
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {t("compatibilityTitle")}
            </h2>
            {eligibleCompanies.length > 1 ? (
              <form className="flex items-center gap-2 text-sm">
                <label htmlFor="compareWith">
                  {t("compatibilityCompareWith")}
                </label>
                <select
                  id="compareWith"
                  name="compareWith"
                  defaultValue={compareWithId}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
                >
                  {eligibleCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="underline">
                  {t("compatibilityCompareAction")}
                </button>
              </form>
            ) : null}
            {compatibility ? (
              <MatchCard
                title={company.display_name}
                score={compatibility.score}
                confidence={compatibility.confidence}
                level={compatibility.level}
                confidenceLevel={compatibility.confidenceLevel}
                breakdown={compatibility.breakdown}
              />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t("noCompatibility")}
              </p>
            )}
          </section>
        ) : null
      ) : null}

      {user && !isMember ? (
        <ClaimCompanyForm
          companyId={company.id}
          existingClaim={existingClaim}
        />
      ) : !user ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("claimQuestion")}{" "}
          <Link href="/connexion" className="underline">
            {t("claimCta")}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
