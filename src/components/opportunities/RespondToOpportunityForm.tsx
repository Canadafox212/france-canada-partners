"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  opportunityResponseSchema,
  type OpportunityResponseInput,
} from "@/validations/opportunity";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

type CompanyOption = { id: string; displayName: string };

export function RespondToOpportunityForm({
  opportunityId,
  eligibleCompanies,
  userId,
}: {
  opportunityId: string;
  eligibleCompanies: CompanyOption[];
  userId: string;
}) {
  const t = useTranslations("Opportunity");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OpportunityResponseInput>({
    resolver: zodResolver(opportunityResponseSchema),
  });

  async function onSubmit(values: OpportunityResponseInput) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.from("opportunity_responses").insert({
      opportunity_id: opportunityId,
      responding_company_id: values.respondingCompanyId,
      responding_user_id: userId,
      message: values.message || null,
    });
    if (error) {
      setFormError(tCommon("errorGeneric"));
      return;
    }
    setSuccess(true);
    router.refresh();
  }

  if (eligibleCompanies.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("noEligibleCompany")}
      </p>
    );
  }

  if (success) {
    return (
      <p className="text-sm text-green-700 dark:text-green-400">
        {t("responseSentMessage")}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-4 dark:border-slate-800"
    >
      <FormField
        label={t("respondingCompanyLabel")}
        htmlFor="respondingCompanyId"
        error={errors.respondingCompanyId?.message}
      >
        <select
          id="respondingCompanyId"
          className={inputClasses}
          {...register("respondingCompanyId")}
        >
          <option value="">{t("selectPlaceholder")}</option>
          {eligibleCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label={t("responseMessageLabel")}
        htmlFor="message"
        error={errors.message?.message}
      >
        <textarea
          id="message"
          rows={3}
          className={inputClasses}
          {...register("message")}
        />
      </FormField>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting}>
        {isSubmitting ? tCommon("loading") : t("respondAction")}
      </SubmitButton>
    </form>
  );
}
