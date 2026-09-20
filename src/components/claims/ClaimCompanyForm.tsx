"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  claimCompanySchema,
  type ClaimCompanyInput,
} from "@/validations/claim";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

type ExistingClaim = {
  id: string;
  status: "pending" | "verified" | "approved" | "rejected" | "cancelled";
};

/**
 * Formulaire de revendication (§14-§17 du cahier des charges Phase 7).
 * La décision (auto-approbation ou mise en attente) est calculée côté base
 * par submit_company_claim() — ce composant ne fait qu'appeler la fonction
 * et afficher le résultat qu'elle renvoie, jamais de logique dupliquée ici.
 */
export function ClaimCompanyForm({
  companyId,
  existingClaim,
}: {
  companyId: string;
  existingClaim: ExistingClaim | null;
}) {
  const t = useTranslations("Claim");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "pending" | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClaimCompanyInput>({ resolver: zodResolver(claimCompanySchema) });

  async function onSubmit(values: ClaimCompanyInput) {
    setFormError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("submit_company_claim", {
      p_company_id: companyId,
      p_professional_email: values.professionalEmail,
      p_justification: values.justification || null,
    });
    if (error) {
      setFormError(error.message || tCommon("errorGeneric"));
      return;
    }
    setOutcome(data.status === "approved" ? "approved" : "pending");
    router.refresh();
  }

  async function onCancel() {
    if (!existingClaim) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_company_claim", {
      p_claim_id: existingClaim.id,
    });
    if (error) {
      setFormError(error.message || tCommon("errorGeneric"));
      return;
    }
    setCancelled(true);
    router.refresh();
  }

  if (cancelled) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("cancelledMessage")}
      </p>
    );
  }

  if (outcome === "approved") {
    return (
      <p className="text-sm text-green-700 dark:text-green-400">
        {t("successApproved")}
      </p>
    );
  }
  if (outcome === "pending") {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("successPending")}
      </p>
    );
  }

  if (
    existingClaim &&
    (existingClaim.status === "pending" || existingClaim.status === "verified")
  ) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("alreadyPending")}
        </p>
        <SubmitButton type="button" variant="secondary" onClick={onCancel}>
          {t("cancelAction")}
        </SubmitButton>
        {formError ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-4 dark:border-slate-800"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t("formTitle")}
      </h2>
      <FormField
        label={t("professionalEmailLabel")}
        htmlFor="professionalEmail"
        error={errors.professionalEmail?.message}
      >
        <input
          id="professionalEmail"
          type="email"
          className={inputClasses}
          {...register("professionalEmail")}
        />
      </FormField>
      <FormField
        label={t("justificationLabel")}
        htmlFor="justification"
        error={errors.justification?.message}
      >
        <textarea
          id="justification"
          rows={3}
          className={inputClasses}
          {...register("justification")}
        />
      </FormField>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting}>
        {isSubmitting ? tCommon("loading") : t("submitAction")}
      </SubmitButton>
    </form>
  );
}
