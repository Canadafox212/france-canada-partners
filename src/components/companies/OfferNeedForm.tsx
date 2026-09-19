"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { offerNeedSchema } from "@/validations/offerNeed";
import { buildOfferNeedTitle } from "@/lib/offersNeeds";
import { inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";
import type { AppLocale } from "@/i18n/routing";

type Option = { id: string; label: string };
type CapabilityOption = { code: string; label: string };

export type EditingOfferNeed = {
  id: string;
  capabilityTypeCode: string;
  industryId: string | null;
  targetCountryCode: string | null;
  targetRegion: string | null;
  description: string | null;
  soughtEmployeeRange?: string | null;
  productServiceIds: string[];
  languageCodes: string[];
};

export function OfferNeedForm({
  kind,
  companyId,
  locale,
  capabilityTypes,
  productsServices,
  languages,
  industries,
  editing,
  onCancel,
  onSaved,
}: {
  kind: "offer" | "need";
  companyId: string;
  locale: AppLocale;
  capabilityTypes: CapabilityOption[];
  productsServices: Option[];
  languages: Option[];
  industries: Option[];
  editing: EditingOfferNeed | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("OfferNeed");
  const tCommon = useTranslations("Common");

  const [capabilityTypeCode, setCapabilityTypeCode] = useState(
    editing?.capabilityTypeCode ?? "",
  );
  const [productServiceIds, setProductServiceIds] = useState<string[]>(
    editing?.productServiceIds ?? [],
  );
  const [industryId, setIndustryId] = useState(editing?.industryId ?? "");
  const [targetCountryCode, setTargetCountryCode] = useState(
    editing?.targetCountryCode ?? "",
  );
  const [targetRegion, setTargetRegion] = useState(editing?.targetRegion ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [languageCodes, setLanguageCodes] = useState<string[]>(
    editing?.languageCodes ?? [],
  );
  const [soughtEmployeeRange, setSoughtEmployeeRange] = useState(
    editing?.soughtEmployeeRange ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleInArray(
    value: string,
    setter: (fn: (prev: string[]) => string[]) => void,
  ) {
    setter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    const parsed = offerNeedSchema.safeParse({
      capabilityTypeCode,
      productServiceIds,
      industryId,
      targetCountryCode,
      targetRegion,
      description,
      languageCodes,
      soughtEmployeeRange,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tCommon("errorGeneric"));
      return;
    }
    const values = parsed.data;

    setSubmitting(true);
    const supabase = createClient();
    const table = kind === "offer" ? "company_offers" : "company_needs";
    const joinTable =
      kind === "offer"
        ? "company_offer_products_services"
        : "company_need_products_services";
    const langTable =
      kind === "offer" ? "company_offer_languages" : "company_need_languages";
    const foreignKey = kind === "offer" ? "offer_id" : "need_id";

    const capabilityLabel =
      capabilityTypes.find((c) => c.code === values.capabilityTypeCode)
        ?.label ?? values.capabilityTypeCode;
    const productLabel =
      productsServices.find((p) => p.id === values.productServiceIds[0])
        ?.label ?? null;
    const title = buildOfferNeedTitle({
      kind,
      locale,
      capabilityLabel,
      productLabel,
      targetCountryCode: values.targetCountryCode || null,
      targetRegion: values.targetRegion || null,
    });

    const row: Record<string, unknown> = {
      capability_type_code: values.capabilityTypeCode,
      title,
      description: values.description || null,
      industry_id: values.industryId || null,
      target_country_code: values.targetCountryCode || null,
      target_region: values.targetRegion || null,
    };
    if (kind === "need") {
      row.sought_employee_range = values.soughtEmployeeRange || null;
    }

    let entityId = editing?.id ?? null;
    if (entityId) {
      const { error: updateError } = await supabase
        .from(table)
        .update(row)
        .eq("id", entityId);
      if (updateError) {
        setError(tCommon("errorGeneric"));
        setSubmitting(false);
        return;
      }
      await supabase.from(joinTable).delete().eq(foreignKey, entityId);
      await supabase.from(langTable).delete().eq(foreignKey, entityId);
    } else {
      const { data, error: insertError } = await supabase
        .from(table)
        .insert({ ...row, company_id: companyId })
        .select("id")
        .single();
      if (insertError || !data) {
        setError(tCommon("errorGeneric"));
        setSubmitting(false);
        return;
      }
      entityId = data.id;
    }

    if (values.productServiceIds.length > 0) {
      await supabase.from(joinTable).insert(
        values.productServiceIds.map((id) => ({
          [foreignKey]: entityId,
          product_service_id: id,
        })),
      );
    }
    if (values.languageCodes.length > 0) {
      await supabase.from(langTable).insert(
        values.languageCodes.map((code) => ({
          [foreignKey]: entityId,
          language_code: code,
        })),
      );
    }

    setSubmitting(false);
    onSaved();
  }

  const relevantCapabilityTypes = capabilityTypes;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-4 dark:border-slate-800"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {kind === "offer"
            ? t("offerCapabilityLabel")
            : t("needCapabilityLabel")}
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
                onChange={() => toggleInArray(p.id, setProductServiceIds)}
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
            {t("countryLabel")}
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
            {t("regionLabel")}
          </label>
          <input
            type="text"
            className={inputClasses}
            value={targetRegion}
            onChange={(e) => setTargetRegion(e.target.value)}
          />
        </div>
      </div>

      {kind === "need" ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("partnerSizeLabel")}
          </label>
          <input
            type="text"
            className={inputClasses}
            value={soughtEmployeeRange}
            onChange={(e) => setSoughtEmployeeRange(e.target.value)}
            placeholder={t("partnerSizePlaceholder")}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("languagesLabel")}
        </label>
        <div className="flex flex-wrap gap-3">
          {languages.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"
            >
              <input
                type="checkbox"
                checked={languageCodes.includes(l.id)}
                onChange={() => toggleInArray(l.id, setLanguageCodes)}
              />
              {l.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t("descriptionLabel")}
        </label>
        <textarea
          rows={3}
          className={inputClasses}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <SubmitButton isLoading={submitting}>
          {submitting
            ? tCommon("loading")
            : kind === "offer"
              ? t("publishOffer")
              : t("publishNeed")}
        </SubmitButton>
        <SubmitButton type="button" variant="secondary" onClick={onCancel}>
          {tCommon("cancel")}
        </SubmitButton>
      </div>
    </form>
  );
}
