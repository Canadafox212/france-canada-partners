"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

/**
 * Marque une notification comme lue via une simple mise à jour directe
 * (RLS notifications_update_own, 0015) — pas de RPC nécessaire ici, la
 * politique existante suffit déjà à restreindre l'écriture au propriétaire.
 */
export function MarkNotificationReadButton({ notificationId }: { notificationId: string }) {
  const t = useTranslations("Notification");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function onClick() {
    setIsPending(true);
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
    setIsPending(false);
    router.refresh();
  }

  return (
    <SubmitButton type="button" variant="secondary" isLoading={isPending} onClick={onClick}>
      {t("markAsRead")}
    </SubmitButton>
  );
}
