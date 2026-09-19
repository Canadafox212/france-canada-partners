"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  editCompanySchema,
  type EditCompanyInput,
} from "@/validations/company";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

export function EditCompanyForm({
  companyId,
  locationId,
  descriptionLocale,
  defaultValues,
}: {
  companyId: string;
  locationId: string | null;
  descriptionLocale: "fr" | "en";
  defaultValues: EditCompanyInput;
}) {
  const t = useTranslations("Company");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditCompanyInput>({
    resolver: zodResolver(editCompanySchema),
    defaultValues,
  });

  async function onSubmit(values: EditCompanyInput) {
    setFormError(null);
    setSaved(false);
    const supabase = createClient();

    // companies.subscription_level et verification_status ne sont jamais
    // envoyés ici : ils sont protégés côté base (voir migration 0009) et
    // n'apparaissent pas dans ce formulaire (principe de minimisation de
    // ce qui peut être demandé, en plus de la protection technique).
    const { error: companyError } = await supabase
      .from("companies")
      .update({
        display_name: values.displayName,
        legal_name: values.legalName || values.displayName,
        website: values.website || null,
        professional_email: values.professionalEmail || null,
        phone: values.phone || null,
      })
      .eq("id", companyId);

    if (companyError) {
      setFormError(tCommon("errorGeneric"));
      return;
    }

    if (locationId) {
      await supabase
        .from("company_locations")
        .update({ region: values.region || null, city: values.city || null })
        .eq("id", locationId);
    }

    await supabase.from("company_translations").upsert(
      {
        company_id: companyId,
        locale: descriptionLocale,
        description: values.description || null,
      },
      { onConflict: "company_id,locale" },
    );

    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField
        label={t("displayName")}
        htmlFor="displayName"
        error={errors.displayName?.message}
      >
        <input
          id="displayName"
          type="text"
          className={inputClasses}
          {...register("displayName")}
        />
      </FormField>

      <FormField label={t("legalName")} htmlFor="legalName">
        <input
          id="legalName"
          type="text"
          className={inputClasses}
          {...register("legalName")}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label={t("region")} htmlFor="region">
          <input
            id="region"
            type="text"
            className={inputClasses}
            {...register("region")}
          />
        </FormField>
        <FormField label={t("city")} htmlFor="city">
          <input
            id="city"
            type="text"
            className={inputClasses}
            {...register("city")}
          />
        </FormField>
      </div>

      <FormField
        label={t("website")}
        htmlFor="website"
        error={errors.website?.message}
      >
        <input
          id="website"
          type="text"
          className={inputClasses}
          {...register("website")}
        />
      </FormField>

      <FormField
        label={t("professionalEmail")}
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

      <FormField label={t("phone")} htmlFor="phone">
        <input
          id="phone"
          type="tel"
          className={inputClasses}
          {...register("phone")}
        />
      </FormField>

      <FormField
        label={t("description")}
        htmlFor="description"
        error={errors.description?.message}
      >
        <textarea
          id="description"
          rows={4}
          className={inputClasses}
          {...register("description")}
        />
      </FormField>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t("protectedFieldsNote")}
      </p>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          {tCommon("saved")}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting} className="self-start">
        {isSubmitting ? tCommon("loading") : t("submitEdit")}
      </SubmitButton>
    </form>
  );
}
