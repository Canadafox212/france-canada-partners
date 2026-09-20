"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";
import { inputClasses } from "@/components/ui/FormField";

export type ClaimReviewItem = {
  id: string;
  companyName: string;
  userLabel: string;
  professionalEmail: string;
  verificationMethod: "domain_match" | "manual";
  status: "pending" | "verified" | "approved" | "rejected" | "cancelled";
  submittedAt: string;
};

/**
 * Vue minimale d'administration des revendications (§34 du cahier des
 * charges Phase 7). N'appelle jamais de mise à jour directe sur
 * company_claims : uniquement review_company_claim() (SECURITY DEFINER,
 * vérifie elle-même is_platform_admin() — voir migration 0018).
 */
export function ClaimsReviewList({ items }: { items: ClaimReviewItem[] }) {
  const t = useTranslations("Claim");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function decide(claimId: string, decision: "approved" | "rejected") {
    setPendingId(claimId);
    setErrorById((prev) => ({ ...prev, [claimId]: "" }));
    const supabase = createClient();
    const { error } = await supabase.rpc("review_company_claim", {
      p_claim_id: claimId,
      p_decision: decision,
      p_notes: notesById[claimId] || null,
    });
    setPendingId(null);
    if (error) {
      setErrorById((prev) => ({
        ...prev,
        [claimId]: error.message || tCommon("errorGeneric"),
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
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnCompany")} :{" "}
              </span>
              {item.companyName}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnUser")} :{" "}
              </span>
              {item.userLabel}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnEmail")} :{" "}
              </span>
              {item.professionalEmail}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnMethod")} :{" "}
              </span>
              {t(`method.${item.verificationMethod}`)}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnDate")} :{" "}
              </span>
              {new Date(item.submittedAt).toLocaleDateString()}
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                {t("adminColumnStatus")} :{" "}
              </span>
              {t(`status.${item.status}`)}
            </div>
          </div>

          <input
            className={inputClasses}
            placeholder={t("adminNotesLabel")}
            value={notesById[item.id] ?? ""}
            onChange={(e) =>
              setNotesById((prev) => ({ ...prev, [item.id]: e.target.value }))
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
