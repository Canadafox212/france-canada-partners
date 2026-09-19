"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { CriterionResult } from "@/lib/matching/types";
import type { getConfidenceLevel, getMatchLevel } from "@/lib/matching/config";

/**
 * Carte de présentation d'un match — utilisée aussi bien pour "Vos
 * partenaires potentiels", "Entreprises compatibles" et "Opportunités pour
 * vous" (voir §26/§27/§28) : un seul composant pour rester cohérent et ne
 * pas disperser l'affichage du score dans plusieurs endroits.
 *
 * Le repli "Pourquoi ce score ?" utilise <details>/<summary> natif (pas de
 * gestion d'état manuelle) ; composant client uniquement pour useTranslations.
 */
export function MatchCard({
  title,
  subtitle,
  score,
  confidence,
  level,
  confidenceLevel,
  breakdown,
}: {
  title: ReactNode;
  subtitle?: string;
  score: number;
  confidence: number;
  level: ReturnType<typeof getMatchLevel>;
  confidenceLevel: ReturnType<typeof getConfidenceLevel>;
  breakdown: CriterionResult[];
}) {
  const t = useTranslations("Matching");

  return (
    <li className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{title}</p>
          {subtitle ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("scoreLabel")} : {score}/100 — {t(`level.${level}`)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("confidenceLabel")} : {t(`confidenceLevel.${confidenceLevel}`)} (
            {confidence}%)
          </p>
        </div>
      </div>
      {breakdown.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 dark:text-blue-400">
            {t("whyToggle")}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 pl-1">
            {breakdown.map((item) => (
              <li
                key={item.criterion}
                className="flex items-center justify-between gap-4 text-slate-600 dark:text-slate-300"
              >
                <span>
                  {item.status === "missing"
                    ? "△"
                    : item.points > 0
                      ? "✓"
                      : "✕"}{" "}
                  {t(`criterion.${item.criterion}`)}
                  {item.status === "missing"
                    ? ` (${t("criterionMissing")})`
                    : ""}
                </span>
                <span>
                  {item.points}/{item.maxPoints}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
