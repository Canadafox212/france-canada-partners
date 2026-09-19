"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createCompanySchema,
  type CreateCompanyInput,
} from "@/validations/company";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";
import { slugify } from "@/lib/utils";

type Industry = { id: string; label: string };

export function CreateCompanyForm({ industries }: { industries: Industry[] }) {
  const t = useTranslations("Company");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { descriptionLocale: "fr" },
  });

  async function onSubmit(values: CreateCompanyInput) {
    setFormError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_company", {
      p_legal_name: values.legalName || values.displayName,
      p_display_name: values.displayName,
      p_slug: slugify(values.displayName),
      p_country_code: values.countryCode,
      p_website: values.website || null,
      p_professional_email: values.professionalEmail || null,
      p_phone: values.phone || null,
      p_region: values.region || null,
      p_city: values.city || null,
      p_industry_id: values.industryId || null,
      p_description: values.description || null,
      p_description_locale: values.descriptionLocale,
    });

    if (error || !data) {
      setFormError(tCommon("errorGeneric"));
      return;
    }

    const company = data as { id: string };
    router.push({
      pathname: "/compte/entreprises/[id]",
      params: { id: company.id },
    });
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

      <FormField
        label={t("legalName")}
        htmlFor="legalName"
        error={errors.legalName?.message}
      >
        <input
          id="legalName"
          type="text"
          className={inputClasses}
          {...register("legalName")}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField
          label={t("country")}
          htmlFor="countryCode"
          error={errors.countryCode?.message}
        >
          <input
            id="countryCode"
            type="text"
            maxLength={2}
            className={inputClasses}
            {...register("countryCode")}
          />
        </FormField>
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

      <FormField label={t("industry")} htmlFor="industryId">
        <select
          id="industryId"
          className={inputClasses}
          {...register("industryId")}
        >
          <option value="">{t("industryNone")}</option>
          {industries.map((industry) => (
            <option key={industry.id} value={industry.id}>
              {industry.label}
            </option>
          ))}
        </select>
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

      <FormField label={t("descriptionLocale")} htmlFor="descriptionLocale">
        <select
          id="descriptionLocale"
          className={inputClasses}
          {...register("descriptionLocale")}
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </FormField>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting} className="self-start">
        {isSubmitting ? tCommon("loading") : t("submitCreate")}
      </SubmitButton>
    </form>
  );
}
