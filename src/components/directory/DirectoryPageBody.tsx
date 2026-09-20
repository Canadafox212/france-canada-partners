import { getTranslations } from "next-intl/server";
import { inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/Breadcrumbs";
import { CompanyCard } from "@/components/directory/CompanyCard";
import { Pagination } from "@/components/directory/Pagination";
import type { DirectorySearchResult } from "@/lib/directory/search";

export type DirectoryCatalogOption = { value: string; label: string };

/**
 * Corps commun aux trois pages de l'annuaire (liste principale, entrée
 * géographique, entrée géographique + secteur — voir §8 du cahier des
 * charges Phase 7) : un seul composant, pas de logique de filtrage/rendu
 * dupliquée trois fois. Chaque page appelante ne fait que résoudre son
 * chemin de base et ses éventuels filtres déjà fixés par l'URL.
 */
export async function DirectoryPageBody({
  title,
  subtitle,
  breadcrumbs,
  basePath,
  rawSearchParams,
  result,
  lockedFilters,
  industries,
  productsServices,
  offeringCapabilityTypes,
  seekingCapabilityTypes,
  capabilityLabels,
  isAuthenticated,
}: {
  title: string;
  subtitle: string;
  breadcrumbs: BreadcrumbItem[];
  basePath: string;
  rawSearchParams: Record<string, string | undefined>;
  result: DirectorySearchResult;
  lockedFilters: { country?: boolean; region?: boolean; industry?: boolean };
  industries: DirectoryCatalogOption[];
  productsServices: DirectoryCatalogOption[];
  offeringCapabilityTypes: DirectoryCatalogOption[];
  seekingCapabilityTypes: DirectoryCatalogOption[];
  capabilityLabels: Record<string, string>;
  isAuthenticated: boolean;
}) {
  const t = await getTranslations("Directory");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16">
      <Breadcrumbs items={breadcrumbs} />

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          {title}
        </h1>
        <p className="text-slate-600 dark:text-slate-300">{subtitle}</p>
      </div>

      <form
        action={basePath}
        className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-3"
      >
        <input
          name="q"
          defaultValue={rawSearchParams.q ?? ""}
          placeholder={t("searchPlaceholder")}
          className={`${inputClasses} col-span-2 sm:col-span-1`}
          aria-label={t("searchPlaceholder")}
        />
        {!lockedFilters.country ? (
          <input
            name="country"
            defaultValue={rawSearchParams.country ?? ""}
            placeholder={t("filterCountryPlaceholder")}
            maxLength={2}
            className={inputClasses}
            aria-label={t("filterCountryPlaceholder")}
          />
        ) : null}
        {!lockedFilters.region ? (
          <input
            name="region"
            defaultValue={rawSearchParams.region ?? ""}
            placeholder={t("filterRegionPlaceholder")}
            className={inputClasses}
            aria-label={t("filterRegionPlaceholder")}
          />
        ) : null}
        <input
          name="city"
          defaultValue={rawSearchParams.city ?? ""}
          placeholder={t("filterCityPlaceholder")}
          className={inputClasses}
          aria-label={t("filterCityPlaceholder")}
        />
        {!lockedFilters.industry ? (
          <select
            name="industry"
            defaultValue={rawSearchParams.industry ?? ""}
            className={inputClasses}
            aria-label={t("filterIndustryAll")}
          >
            <option value="">{t("filterIndustryAll")}</option>
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        ) : null}
        <select
          name="product"
          defaultValue={rawSearchParams.product ?? ""}
          className={inputClasses}
          aria-label={t("filterProductAll")}
        >
          <option value="">{t("filterProductAll")}</option>
          {productsServices.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          name="offering"
          defaultValue={rawSearchParams.offering ?? ""}
          className={inputClasses}
          aria-label={t("filterOfferingAll")}
        >
          <option value="">{t("filterOfferingAll")}</option>
          {offeringCapabilityTypes.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          name="seeking"
          defaultValue={rawSearchParams.seeking ?? ""}
          className={inputClasses}
          aria-label={t("filterSeekingAll")}
        >
          <option value="">{t("filterSeekingAll")}</option>
          {seekingCapabilityTypes.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          name="target"
          defaultValue={rawSearchParams.target ?? ""}
          placeholder={t("filterTargetPlaceholder")}
          maxLength={2}
          className={inputClasses}
          aria-label={t("filterTargetPlaceholder")}
        />
        <select
          name="sort"
          defaultValue={rawSearchParams.sort ?? "relevance"}
          className={inputClasses}
          aria-label={t("sortLabel")}
        >
          <option value="relevance">{t("sortRelevance")}</option>
          <option value="name">{t("sortName")}</option>
          <option value="recent">{t("sortRecent")}</option>
        </select>
        <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 sm:col-span-1">
          <input
            type="checkbox"
            name="verified"
            value="1"
            defaultChecked={rawSearchParams.verified === "1"}
          />
          {t("filterVerifiedOnly")}
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 sm:col-span-1">
          <input
            type="checkbox"
            name="activeOpportunities"
            value="1"
            defaultChecked={rawSearchParams.activeOpportunities === "1"}
          />
          {t("filterActiveOpportunitiesOnly")}
        </label>
        <SubmitButton variant="secondary">{t("filterApply")}</SubmitButton>
      </form>

      {!isAuthenticated ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("loginToSeeCompatibility")}
        </p>
      ) : null}

      {result.items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("resultsEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              capabilityLabels={capabilityLabels}
            />
          ))}
        </ul>
      )}

      <Pagination
        basePath={basePath}
        searchParams={rawSearchParams}
        page={result.page}
        hasNextPage={result.hasNextPage}
        labels={{ prev: t("paginationPrev"), next: t("paginationNext") }}
      />
    </main>
  );
}
