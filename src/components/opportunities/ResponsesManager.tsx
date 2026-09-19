"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

export type OpportunityResponseItem = {
  id: string;
  respondingCompanyName: string;
  message: string | null;
  status:
    | "declared_interest"
    | "under_review"
    | "accepted"
    | "declined"
    | "withdrawn";
  createdAt: string;
};

export function ResponsesManager({
  items,
  canManage,
}: {
  items: OpportunityResponseItem[];
  canManage: boolean;
}) {
  const t = useTranslations("Opportunity");
  const router = useRouter();

  async function setStatus(
    id: string,
    status: "under_review" | "accepted" | "declined",
  ) {
    const supabase = createClient();
    await supabase
      .from("opportunity_responses")
      .update({ status })
      .eq("id", id);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        {t("responsesTitle")}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("noResponses")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-md border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-slate-900 dark:text-white">
                  {item.respondingCompanyName}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t(`responseStatus.${item.status}`)}
                </span>
              </div>
              {item.message ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {item.message}
                </p>
              ) : null}
              {canManage &&
              (item.status === "declared_interest" ||
                item.status === "under_review") ? (
                <div className="flex gap-2">
                  {item.status === "declared_interest" ? (
                    <SubmitButton
                      type="button"
                      variant="secondary"
                      onClick={() => setStatus(item.id, "under_review")}
                    >
                      {t("markUnderReviewAction")}
                    </SubmitButton>
                  ) : null}
                  <SubmitButton
                    type="button"
                    variant="secondary"
                    onClick={() => setStatus(item.id, "accepted")}
                  >
                    {t("acceptAction")}
                  </SubmitButton>
                  <SubmitButton
                    type="button"
                    variant="secondary"
                    onClick={() => setStatus(item.id, "declined")}
                  >
                    {t("declineAction")}
                  </SubmitButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
