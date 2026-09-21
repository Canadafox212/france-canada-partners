"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  partnershipRequestSchema,
  type PartnershipRequestInput,
} from "@/validations/partnershipRequest";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

type SourceType = "DIRECTORY" | "MATCH" | "OPPORTUNITY" | "OTHER";

/**
 * CTA + formulaire "Demander une mise en relation" (Phase 9). Le
 * composant ne fait qu'appeler create_partnership_request() et afficher
 * le résultat qu'elle renvoie — la décision (pending / pending_unclaimed /
 * refus) est entièrement calculée côté base, jamais dupliquée ici. Sujet
 * et message restent des champs libres saisis par l'utilisateur : jamais
 * pré-remplis à partir du score de matching (§6 de la demande).
 */
export function RequestPartnershipButton({
  requesterCompanies,
  targetCompanyId,
  sourceType = "OTHER",
  sourceMatchId = null,
  sourceOpportunityId = null,
  alreadyActiveStatus = null,
}: {
  requesterCompanies: { id: string; name: string }[];
  targetCompanyId: string;
  sourceType?: SourceType;
  sourceMatchId?: string | null;
  sourceOpportunityId?: string | null;
  /** Statut d'une demande déjà active de CETTE entreprise vers la cible, si connu — évite un aller-retour d'erreur pour un doublon déjà visible. */
  alreadyActiveStatus?: "pending" | "pending_unclaimed" | null;
}) {
  const t = useTranslations("PartnershipRequest");
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<
    "pending" | "pending_unclaimed" | null
  >(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PartnershipRequestInput>({
    resolver: zodResolver(partnershipRequestSchema),
    defaultValues: { requesterCompanyId: requesterCompanies[0]?.id },
  });

  async function onSubmit(values: PartnershipRequestInput) {
    setFormError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_partnership_request", {
      p_requester_company_id: values.requesterCompanyId,
      p_target_company_id: targetCompanyId,
      p_subject: values.subject,
      p_message: values.message,
      p_source_type: sourceType,
      p_source_match_id: sourceMatchId,
      p_source_opportunity_id: sourceOpportunityId,
    });
    if (error) {
      // Marqueurs stables renvoyés par create_partnership_request()
      // (Phase 10C, LOT 10C-2 pour RATE_LIMIT_EXCEEDED, LOT 10C-4 pour les
      // quatre autres) — traduits ici plutôt que renvoyés déjà en
      // français/anglais depuis la fonction.
      const stableErrors: Record<string, string> = {
        RATE_LIMIT_EXCEEDED: t("rateLimitError"),
        REQUESTER_NOT_ACTIVE: t("requesterNotActiveError"),
        TARGET_NOT_ACTIVE: t("targetNotActiveError"),
        DUPLICATE_ACTIVE_REQUEST: t("duplicateActiveRequestError"),
        NOT_AUTHORIZED: t("notAuthorizedError"),
      };
      setFormError(
        stableErrors[error.message] ?? error.message ?? tCommon("errorGeneric"),
      );
      return;
    }
    setOutcome(
      (data as { status: "pending" | "pending_unclaimed" }).status,
    );
  }

  if (outcome === "pending") {
    return (
      <p className="text-sm text-green-700 dark:text-green-400">
        {t("successPending")}
      </p>
    );
  }
  if (outcome === "pending_unclaimed") {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("successPendingUnclaimed")}
      </p>
    );
  }

  if (alreadyActiveStatus === "pending") {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("alreadyPending")}
      </p>
    );
  }
  if (alreadyActiveStatus === "pending_unclaimed") {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("alreadyPendingUnclaimed")}
      </p>
    );
  }

  if (requesterCompanies.length === 0) {
    return null;
  }

  if (!open) {
    return (
      <SubmitButton type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("cta")}
      </SubmitButton>
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

      {requesterCompanies.length > 1 ? (
        <FormField
          label={t("actingAsLabel")}
          htmlFor="requesterCompanyId"
          error={errors.requesterCompanyId?.message}
        >
          <select
            id="requesterCompanyId"
            className={inputClasses}
            {...register("requesterCompanyId")}
          >
            {requesterCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <input
          type="hidden"
          {...register("requesterCompanyId")}
          value={requesterCompanies[0].id}
        />
      )}

      <FormField
        label={t("subjectLabel")}
        htmlFor="subject"
        error={errors.subject?.message}
      >
        <input
          id="subject"
          type="text"
          maxLength={200}
          className={inputClasses}
          {...register("subject")}
        />
      </FormField>

      <FormField
        label={t("messageLabel")}
        htmlFor="message"
        error={errors.message?.message}
      >
        <textarea
          id="message"
          rows={4}
          maxLength={2000}
          className={inputClasses}
          {...register("message")}
        />
      </FormField>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <SubmitButton isLoading={isSubmitting}>
          {isSubmitting ? tCommon("loading") : t("submitAction")}
        </SubmitButton>
        <SubmitButton
          type="button"
          variant="secondary"
          onClick={() => setOpen(false)}
        >
          {tCommon("cancel")}
        </SubmitButton>
      </div>
    </form>
  );
}
