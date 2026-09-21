"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/FormField";

export type PublicationReviewItem = {
  id: string;
  companyName: string;
  requesterLabel: string;
  requestedAt: string;
  isReady: boolean;
};

/**
 * Vue minimale d'administration des demandes de publication (Phase 10C,
 * LOT 10C-4) — calquée sur ClaimsReviewList (Phase 7). N'appelle jamais de
 * mise à jour directe sur company_publication_requests ni companies :
 * uniquement review_company_publication_request() (SECURITY DEFINER,
 * vérifie elle-même is_platform_admin() et revalide les critères — voir
 * migration 0026).
 */
export function PublicationsReviewList({
  items,
}: {
  items: PublicationReviewItem[];
}) {
  const t = useTranslations("CompanyPublication");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setPendingId(requestId);
    setErrorById((prev) => ({ ...prev, [requestId]: "" }));
    const supabase = createClient();
    const { error } = await supabase.rpc("review_company_publication_request", {
      p_request_id: requestId,
      p_decision: decision,
      p_note: noteById[requestId] || null,
    });
    setPendingId(null);
    if (error) {
      setErrorById((prev) => ({
        ...prev,
        [requestId]: error.message || tCommon("errorGeneric"),
      }));
      return;
    }
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("adminEmpty")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-2 rounded-md border border-slate-200 p-4 dark:border-slate-800"
        >
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnCompany")} :{" "}
              </span>
              {item.companyName}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnRequester")} :{" "}
              </span>
              {item.requesterLabel}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnDate")} :{" "}
              </span>
              {new Date(item.requestedAt).toLocaleDateString()}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnReady")} :{" "}
              </span>
              {item.isReady ? t("adminReadyYes") : t("adminReadyNo")}
            </div>
          </div>

          <input
            className={inputClasses}
            placeholder={t("adminNotesLabel")}
            value={noteById[item.id] ?? ""}
            onChange={(e) =>
              setNoteById((prev) => ({ ...prev, [item.id]: e.target.value }))
            }
          />

          {errorById[item.id] ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {errorById[item.id]}
            </p>
          ) : null}

          <div className="flex gap-2">
            <SubmitButton
              type="button"
              variant="primary"
              isLoading={pendingId === item.id}
              onClick={() => decide(item.id, "approved")}
            >
              {t("adminApprove")}
            </SubmitButton>
            <SubmitButton
              type="button"
              variant="secondary"
              isLoading={pendingId === item.id}
              onClick={() => decide(item.id, "rejected")}
            >
              {t("adminReject")}
            </SubmitButton>
          </div>
        </li>
      ))}
    </ul>
  );
}
