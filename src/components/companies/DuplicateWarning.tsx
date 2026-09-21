"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SubmitButton } from "@/components/ui/Button";
import type { ScoredSimilarCompany } from "@/lib/companies/duplicateCheck";

/**
 * Affichage du résultat de la vérification de doublon avant création
 * (Phase 10C, LOT 10C-2, §A3) — jamais bloquant à lui seul : EXACT/
 * VERY_LIKELY demande une confirmation explicite ("Ce n'est pas mon
 * entreprise"), POSSIBLE reste un simple avertissement, UNLIKELY n'est
 * même pas affiché ici (voir le tri dans duplicateCheck.ts).
 */
export function DuplicateWarning({
  candidates,
  confirmed,
  onConfirmNotMine,
}: {
  candidates: ScoredSimilarCompany[];
  confirmed: boolean;
  onConfirmNotMine: () => void;
}) {
  const t = useTranslations("DuplicateCheck");

  const strong = candidates.filter(
    (c) => c.comparison.level === "EXACT" || c.comparison.level === "VERY_LIKELY",
  );
  const possible = candidates.filter((c) => c.comparison.level === "POSSIBLE");

  if (strong.length === 0 && possible.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("noneFound")}
      </p>
    );
  }

  if (strong.length > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {t("strongTitle")}
        </p>
        <ul className="flex flex-col gap-2">
          {strong.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900 dark:text-amber-200"
            >
              <span>
                {c.displayName}
                {c.city ? ` — ${c.city}` : ""}
              </span>
              <span className="flex items-center gap-3">
                <Link
                  href={{ pathname: "/entreprises/[geoOrSlug]", params: { geoOrSlug: c.slug } }}
                  className="underline"
                >
                  {t("viewAction")}
                </Link>
                {c.isClaimed ? (
                  <span>{t("strongAlreadyClaimed")}</span>
                ) : (
                  <Link
                    href={{ pathname: "/entreprises/[geoOrSlug]", params: { geoOrSlug: c.slug } }}
                    className="font-medium underline"
                  >
                    {t("strongClaimCta")}
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!confirmed ? (
          <SubmitButton
            type="button"
            variant="secondary"
            className="self-start"
            onClick={onConfirmNotMine}
          >
            {t("continueAction")}
          </SubmitButton>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {t("possibleTitle")}
      </p>
      <ul className="flex flex-col gap-1">
        {possible.map((c) => (
          <li key={c.id} className="text-sm text-slate-600 dark:text-slate-300">
            {c.displayName}
            {c.city ? ` — ${c.city}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
