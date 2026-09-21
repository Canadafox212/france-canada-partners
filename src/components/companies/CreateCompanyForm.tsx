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
import {
  scoreSimilarCompanies,
  hasBlockingDuplicate,
  type ScoredSimilarCompany,
} from "@/lib/companies/duplicateCheck";
import { DuplicateWarning } from "@/components/companies/DuplicateWarning";

type Industry = { id: string; label: string };

export function CreateCompanyForm({ industries }: { industries: Industry[] }) {
  const t = useTranslations("Company");
  const tCommon = useTranslations("Common");
  const tDup = useTranslations("DuplicateCheck");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<
    ScoredSimilarCompany[] | null
  >(null);
  const [confirmedNotMine, setConfirmedNotMine] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { descriptionLocale: "fr" },
  });

  async function handleCheckDuplicates() {
    const { displayName, legalName, website, city, countryCode } = getValues();
    if (!displayName || displayName.trim().length === 0) return;

    setChecking(true);
    setConfirmedNotMine(false);
    const supabase = createClient();
    // p_registration_number n'est jamais fourni ici : ce formulaire ne
    // collecte aucun numéro officiel (SIREN ou équivalent) — voir la revue
    // de sécurité de la migration 0024. Le paramètre reste plombé côté
    // fonction/scoring pour un futur appelant qui en collecterait un,
    // jamais une fonctionnalité fictive présentée comme active ici.
    const { data } = await supabase.rpc("find_similar_companies", {
      p_display_name: displayName,
      p_website: website || null,
      p_country_code: countryCode || null,
      p_city: city || null,
    });
    setChecking(false);

    const candidates = (data ?? []).map(
      (c: {
        id: string;
        display_name: string;
        legal_name: string | null;
        slug: string;
        website: string | null;
        country_code: string;
        region: string | null;
        city: string | null;
        is_claimed: boolean;
        registration_number_match: boolean;
      }) => ({
        id: c.id,
        displayName: c.display_name,
        legalName: c.legal_name,
        slug: c.slug,
        website: c.website,
        countryCode: c.country_code,
        region: c.region,
        city: c.city,
        isClaimed: c.is_claimed,
        registrationNumberMatch: c.registration_number_match,
      }),
    );
    setDuplicateCandidates(
      scoreSimilarCompanies({ displayName, legalName, website, city }, candidates),
    );
  }

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

      <div className="flex flex-col gap-3">
        <SubmitButton
          type="button"
          variant="secondary"
          className="self-start"
          isLoading={checking}
          onClick={handleCheckDuplicates}
        >
          {checking ? tDup("checking") : tDup("checkAction")}
        </SubmitButton>
        {duplicateCandidates !== null ? (
          <DuplicateWarning
            candidates={duplicateCandidates}
            confirmed={confirmedNotMine}
            onConfirmNotMine={() => setConfirmedNotMine(true)}
          />
        ) : null}
      </div>

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

      <SubmitButton
        isLoading={isSubmitting}
        disabled={hasBlockingDuplicate(duplicateCandidates) && !confirmedNotMine}
        className="self-start"
      >
        {isSubmitting ? tCommon("loading") : t("submitCreate")}
      </SubmitButton>
    </form>
  );
}
