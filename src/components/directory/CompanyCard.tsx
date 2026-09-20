"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { DirectoryResultItem } from "@/lib/directory/search";

/**
 * Carte d'un résultat d'annuaire (§3 du cahier des charges Phase 7).
 * Composant client uniquement pour useTranslations (aucune interactivité) —
 * voir la même convention que MatchCard (Phase 6).
 */
export function CompanyCard({
  company,
  capabilityLabels,
  compatibilityScore,
}: {
  company: DirectoryResultItem;
  capabilityLabels: Record<string, string>;
  /** Score 0-100 déjà calculé par le moteur de matching (Phase 6), jamais recalculé ici. */
  compatibilityScore?: number | null;
}) {
  const t = useTranslations("Directory");

  const offering = company.offeringCapabilityCodes.map(
    (c) => capabilityLabels[c] ?? c,
  );
  const seeking = company.seekingCapabilityCodes.map(
    (c) => capabilityLabels[c] ?? c,
  );
  const location =
    [company.city, company.region].filter(Boolean).join(", ") ||
    company.countryCode;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link
            href={{
              pathname: "/entreprises/[geoOrSlug]",
              params: { geoOrSlug: company.slug },
            }}
            className="text-lg font-medium text-slate-900 underline dark:text-white"
          >
            {company.displayName}
          </Link>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {location}
            {company.primaryIndustryNameFr
              ? ` · ${company.primaryIndustryNameFr}`
              : ""}
          </p>
        </div>
        {company.verificationStatus === "verified" ? (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
            {t("verifiedBadge")}
          </span>
        ) : null}
      </div>

      {offering.length > 0 ? (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-medium">{t("offersLabel")}</span>{" "}
          {offering.join(", ")}
        </p>
      ) : null}
      {seeking.length > 0 ? (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-medium">{t("needsLabel")}</span>{" "}
          {seeking.join(", ")}
        </p>
      ) : null}
      {company.activeOpportunitiesCount > 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("activeOpportunities", {
            count: company.activeOpportunitiesCount,
          })}
        </p>
      ) : null}
      {typeof compatibilityScore === "number" ? (
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {t("compatibilityLabel")} : {compatibilityScore}/100
        </p>
      ) : null}
    </li>
  );
}
