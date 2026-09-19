"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

type Status =
  "draft" | "published" | "paused" | "closed" | "expired" | "archived";

const nextActions: Partial<
  Record<Status, { action: string; nextStatus: Status }[]>
> = {
  draft: [{ action: "publishAction", nextStatus: "published" }],
  published: [
    { action: "pauseAction", nextStatus: "paused" },
    { action: "closeAction", nextStatus: "closed" },
  ],
  paused: [
    { action: "resumeAction", nextStatus: "published" },
    { action: "archiveAction", nextStatus: "archived" },
  ],
  closed: [{ action: "archiveAction", nextStatus: "archived" }],
  expired: [{ action: "archiveAction", nextStatus: "archived" }],
};

export function OpportunityStatusActions({
  opportunityId,
  status,
}: {
  opportunityId: string;
  status: Status;
}) {
  const t = useTranslations("Opportunity");
  const router = useRouter();

  async function transitionTo(nextStatus: Status) {
    const supabase = createClient();
    await supabase
      .from("opportunities")
      .update({ status: nextStatus })
      .eq("id", opportunityId);
    router.refresh();
  }

  const actions = nextActions[status] ?? [];
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ action, nextStatus }) => (
        <SubmitButton
          key={nextStatus}
          type="button"
          variant="secondary"
          onClick={() => transitionTo(nextStatus)}
        >
          {t(action)}
        </SubmitButton>
      ))}
    </div>
  );
}
