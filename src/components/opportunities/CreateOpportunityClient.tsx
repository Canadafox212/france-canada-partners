"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  OpportunityForm,
  type EditingOpportunity,
} from "@/components/opportunities/OpportunityForm";
import { inputClasses } from "@/components/ui/FormField";
import type { AppLocale } from "@/i18n/routing";

type Option = { id: string; label: string };
type CapabilityOption = {
  code: string;
  label: string;
  appliesToOffers: boolean;
  appliesToNeeds: boolean;
};

export type PrefillSource = {
  key: string;
  label: string;
  values: Partial<EditingOpportunity>;
};

export function CreateOpportunityClient({
  companyId,
  originCountryCode,
  locale,
  capabilityTypes,
  productsServices,
  industries,
  prefillSources,
}: {
  companyId: string;
  originCountryCode: string;
  locale: AppLocale;
  capabilityTypes: CapabilityOption[];
  productsServices: Option[];
  industries: Option[];
  prefillSources: PrefillSource[];
}) {
  const t = useTranslations("Opportunity");
  const router = useRouter();
  const [prefillKey, setPrefillKey] = useState("");

  const selected = prefillSources.find((s) => s.key === prefillKey) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {prefillSources.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("prefillLabel")}
          </label>
          <select
            className={inputClasses}
            value={prefillKey}
            onChange={(e) => setPrefillKey(e.target.value)}
          >
            <option value="">{t("prefillNone")}</option>
            {prefillSources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <OpportunityForm
        key={prefillKey}
        companyId={companyId}
        originCountryCode={originCountryCode}
        locale={locale}
        capabilityTypes={capabilityTypes}
        productsServices={productsServices}
        industries={industries}
        editing={null}
        prefill={selected?.values ?? null}
        onCancel={() => router.back()}
        onSaved={(opportunityId) => {
          router.push({
            pathname: "/compte/entreprises/[id]/opportunites/[opportunityId]",
            params: { id: companyId, opportunityId },
          });
        }}
      />
    </div>
  );
}
