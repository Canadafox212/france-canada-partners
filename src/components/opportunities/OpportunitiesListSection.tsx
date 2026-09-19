"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ButtonLink } from "@/components/ui/Button";

export type CompanyOpportunityItem = {
  id: string;
  title: string | null;
  status: "draft" | "published" | "paused" | "closed" | "expired" | "archived";
  responseCount: number;
};

const statusColors: Record<CompanyOpportunityItem["status"], string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  published:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  closed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  expired: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

export function OpportunitiesListSection({
  companyId,
  items,
  canManage,
}: {
  companyId: string;
  items: CompanyOpportunityItem[];
  canManage: boolean;
}) {
  const t = useTranslations("Opportunity");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("sectionTitle")}
        </h2>
        {canManage ? (
          <ButtonLink
            href={{
              pathname: "/compte/entreprises/[id]/opportunites/nouvelle",
              params: { id: companyId },
            }}
            variant="secondary"
          >
            {t("publishNewAction")}
          </ButtonLink>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("noOpportunities")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3 dark:border-slate-800"
            >
              <div className="flex flex-col gap-1">
                <span className="text-slate-900 dark:text-white">
                  {item.title}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t("responseCount", { count: item.responseCount })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[item.status]}`}
                >
                  {t(`status.${item.status}`)}
                </span>
                <Link
                  href={{
                    pathname:
                      "/compte/entreprises/[id]/opportunites/[opportunityId]",
                    params: { id: companyId, opportunityId: item.id },
                  }}
                  className="text-sm underline text-slate-700 dark:text-slate-200"
                >
                  {t("manageAction")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
