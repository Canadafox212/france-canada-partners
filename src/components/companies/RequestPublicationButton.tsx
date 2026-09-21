"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

/**
 * CTA "Demander la publication" (Phase 10C, LOT 10C-4). N'écrit jamais
 * companies.status directement : appelle uniquement
 * request_company_publication() (SECURITY DEFINER, revalide elle-même les
 * critères côté serveur — voir migration 0026). Après succès,
 * router.refresh() relit le vrai statut depuis le serveur plutôt que de
 * supposer un état local optimiste.
 */
export function RequestPublicationButton({ companyId }: { companyId: string }) {
  const t = useTranslations("Company");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    setIsSubmitting(false);
    if (rpcError) {
      setError(rpcError.message || tCommon("errorGeneric"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <SubmitButton
        type="button"
        variant="primary"
        isLoading={isSubmitting}
        onClick={submit}
      >
        {t("requestPublicationAction")}
      </SubmitButton>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
