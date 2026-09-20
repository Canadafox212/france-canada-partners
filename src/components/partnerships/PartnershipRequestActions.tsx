"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

type Role = "target" | "requester" | "none";

/**
 * Actions autorisées sur une demande de mise en relation (Phase 9) :
 * accepter/refuser côté cible, retirer côté demandeur. Chaque bouton
 * appelle directement la RPC correspondante — aucune logique de permission
 * ou de statut n'est dupliquée ici, tout est recalculé côté base.
 */
export function PartnershipRequestActions({
  requestId,
  role,
  status,
}: {
  requestId: string;
  role: Role;
  status: "pending" | "pending_unclaimed" | "accepted" | "declined" | "withdrawn" | "expired";
}) {
  const t = useTranslations("PartnershipRequest");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function callRpc(fn: string) {
    setError(null);
    setIsPending(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc(fn, {
      p_request_id: requestId,
    });
    setIsPending(false);
    if (rpcError) {
      setError(rpcError.message || tCommon("errorGeneric"));
      return;
    }
    router.refresh();
  }

  const actions: { label: string; fn: string; variant: "primary" | "secondary" }[] = [];
  if (role === "target" && status === "pending") {
    actions.push({ label: t("acceptAction"), fn: "accept_partnership_request", variant: "primary" });
    actions.push({ label: t("declineAction"), fn: "decline_partnership_request", variant: "secondary" });
  }
  if (role === "requester" && (status === "pending" || status === "pending_unclaimed")) {
    actions.push({ label: t("withdrawAction"), fn: "withdraw_partnership_request", variant: "secondary" });
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {actions.map((a) => (
          <SubmitButton
            key={a.fn}
            type="button"
            variant={a.variant}
            isLoading={isPending}
            onClick={() => callRpc(a.fn)}
          >
            {a.label}
          </SubmitButton>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
