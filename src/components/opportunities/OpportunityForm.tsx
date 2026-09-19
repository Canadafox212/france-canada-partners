"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { opportunitySchema } from "@/validations/opportunity";
import { buildOpportunityTitle } from "@/lib/offersNeeds";
import { inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";
import type { AppLocale } from "@/i18n/routing";

type Option = { id: string; label: string };
type CapabilityOption = {
  code: string;
  label: string;
  appliesToOffers: boolean;
  appliesToNeeds: boolean;
};

export type EditingOpportunity = {
  id: string;
  capabilityTypeCode: string;
  direction: "seeking" | "offering";
  industryId: string | null;
  targetCountryCode: string | null;
  targetRegion: string | null;
  description: string | null;
  deadline: string | null;
  estimatedValue: number | null;
  currencyCode: string | null;
  productServiceIds: string[];
};

export function OpportunityForm({
  companyId,
  originCountryCode,
  locale,
  capabilityTypes,
  productsServices,
  industries,
  editing,
  prefill,
  onCancel,
  onSaved,
}: {
  companyId: string;
  originCountryCode: string;
  locale: AppLocale;
  capabilityTypes: CapabilityOption[];
  productsServices: Option[];
  industries: Option[];
  editing: EditingOpportunity | null;
  prefill?: Partial<EditingOpportunity> | null;
  onCancel: () => void;
  onSaved: (opportunityId: string) => void;
}) {
  const t = useTranslations("Opportunity");
  const tCommon = useTranslations("Common");
  const router = useRouter();

  const base = editing ?? prefill ?? null;
  const [direction, setDirection] = useState<"seeking" | "offering">(
    base?.direction ?? "seeking",
  );
  const [capabilityTypeCode, setCapabilityTypeCode] = useState(
    base?.capabilityTypeCode ?? "",
  );
  const [productServiceIds, setProductServiceIds] = useState<string[]>(
    base?.productServiceIds ?? [],
  );
  const [industryId, setIndustryId] = useState(base?.industryId ?? "");
  const [targetCountryCode, setTargetCountryCode] = useState(
    base?.targetCountryCode ?? "",
  );
  const [targetRegion, setTargetRegion] = useState(base?.targetRegion ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [deadline, setDeadline] = useState(base?.deadline ?? "");
  const [estimatedValue, setEstimatedValue] = useState(
    base?.estimatedValue?.toString() ?? "",
  );
  const [currencyCode, setCurrencyCode] = useState(base?.currencyCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const relevantCapabilityTypes = useMemo(
    () =>
      capabilityTypes.filter((c) =>
        direction === "seeking" ? c.appliesToNeeds : c.appliesToOffers,
      ),
    [capabilityTypes, direction],
  );

  function toggleProduct(id: string) {
    setProductServiceIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  async function saveAs(status: "draft" | "published") {
    setError(null);

    const parsed = opportunitySchema.safeParse({
      capabilityTypeCode,
      direction,
      productServiceIds,
      industryId,
      targetCountryCode,
      targetRegion,
      description,
      deadline,
      estimatedValue,
      currencyCode,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tCommon("errorGeneric"));
      return;
    }
    const values = parsed.data;

    setSubmitting(true);
    const supabase = createClient();

    const capabilityLabel =
      capabilityTypes.find((c) => c.code === values.capabilityTypeCode)
        ?.label ?? values.capabilityTypeCode;
    const productLabel =
      productsServices.find((p) => p.id === values.productServiceIds[0])
        ?.label ?? null;
    const title = buildOpportunityTitle({
      locale,
      direction: values.direction,
      capabilityLabel,
      productLabel,
      targetCountryCode: values.targetCountryCode || null,
      targetRegion: values.targetRegion || null,
    });

    const row = {
      title,
      description: values.description || null,
      capability_type_code: values.capabilityTypeCode,
      direction: values.direction,
      industry_id: values.industryId || null,
      target_country_code: values.targetCountryCode || null,
      target_region: values.targetRegion || null,
      deadline: values.deadline || null,
      estimated_value: values.estimatedValue
        ? Number(values.estimatedValue)
        : null,
      currency_code: values.currencyCode || null,
      status,
      language_code: locale,
    };

    let opportunityId = editing?.id ?? null;
    if (opportunityId) {
      const { error: updateError } = await supabase
        .from("opportunities")
        .update(row)
        .eq("id", opportunityId);
      if (updateError) {
        setError(tCommon("errorGeneric"));
        setSubmitting(false);
        return;
      }
      await supabase
        .from("opportunity_products_services")
        .delete()
        .eq("opportunity_id", opportunityId);
    } else {
      const { data, error: insertError } = await supabase
        .from("opportunities")
        .insert({
          ...row,
          company_id: companyId,
          origin_country_code: originCountryCode,
        })
        .select("id")
        .single();
      if (insertError || !data) {
        setError(tCommon("errorGeneric"));
        setSubmitting(false);
        return;
      }
      opportunityId = data.id;
    }

    if (values.productServiceIds.length > 0) {
      await supabase
        .from("opportunity_products_services")
        .insert(
          values.productServiceIds.map((id) => ({
            opportunity_id: opportunityId,
            product_service_id: id,
          })),
        );
    }

    setSubmitting(false);
    onSaved(opportunityId!);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-4 dark:border-slate-800"
    >
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="radio"
            checked={direction === "seeking"}
            onChange={() => {
              setDirection("seeking");
              setCapabilityTypeCode("");
            }}
          />
          {t("directionSeeking")}
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="radio"
            checked={direction === "offering"}
            onChange={() => {
              setDirection("offering");
              setCapabilityTypeCode("");
            }}
          />
          {t("directionOffering")}
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("typeLabel")}
        </label>
        <select
          className={inputClasses}
          value={capabilityTypeCode}
          onChange={(e) => setCapabilityTypeCode(e.target.value)}
          required
        >
          <option value="">{t("selectPlaceholder")}</option>
          {relevantCapabilityTypes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("productsLabel")}
        </label>
        <div className="flex flex-wrap gap-3">
          {productsServices.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"
            >
              <input
                type="checkbox"
                checked={productServiceIds.includes(p.id)}
                onChange={() => toggleProduct(p.id)}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("industryLabel")}
        </label>
        <select
          className={inputClasses}
          value={industryId}
          onChange={(e) => setIndustryId(e.target.value)}
        >
          <option value="">{t("industryNone")}</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("targetCountryLabel")}
          </label>
          <input
            type="text"
            maxLength={2}
            className={inputClasses}
            value={targetCountryCode}
            onChange={(e) => setTargetCountryCode(e.target.value.toUpperCase())}
            placeholder="FR, CA…"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("targetRegionLabel")}
          </label>
          <input
            type="text"
            className={inputClasses}
            value={targetRegion}
            onChange={(e) => setTargetRegion(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("descriptionLabel")}
        </label>
        <textarea
          rows={4}
          className={inputClasses}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("deadlineLabel")}
        </label>
        <input
          type="date"
          className={inputClasses}
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("deadlineHint")}
        </p>
      </div>

      <details className="text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium">
          {t("financialDetailsToggle")}
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t("estimatedValueLabel")}
            </label>
            <input
              type="text"
              className={inputClasses}
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t("currencyLabel")}
            </label>
            <input
              type="text"
              maxLength={3}
              className={inputClasses}
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
              placeholder="EUR, CAD…"
            />
          </div>
        </div>
      </details>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SubmitButton
          type="button"
          isLoading={submitting}
          onClick={() => saveAs("published")}
        >
          {submitting ? tCommon("loading") : t("publishAction")}
        </SubmitButton>
        <SubmitButton
          type="button"
          variant="secondary"
          isLoading={submitting}
          onClick={() => saveAs("draft")}
        >
          {t("saveDraftAction")}
        </SubmitButton>
        <SubmitButton type="button" variant="secondary" onClick={onCancel}>
          {tCommon("cancel")}
        </SubmitButton>
      </div>
    </form>
  );
}
