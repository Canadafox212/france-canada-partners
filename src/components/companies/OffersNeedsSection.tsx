"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  OfferNeedForm,
  type EditingOfferNeed,
} from "@/components/companies/OfferNeedForm";
import { SubmitButton } from "@/components/ui/Button";
import type { AppLocale } from "@/i18n/routing";

type Option = { id: string; label: string };
type CapabilityOption = { code: string; label: string };

export type OfferNeedItem = {
  id: string;
  title: string | null;
  description: string | null;
  capabilityTypeCode: string;
  targetCountryCode: string | null;
  targetRegion: string | null;
  status: "active" | "inactive";
  industryId: string | null;
  soughtEmployeeRange?: string | null;
  productServiceIds: string[];
  languageCodes: string[];
};

export function OffersNeedsSection({
  kind,
  companyId,
  locale,
  items,
  capabilityTypes,
  productsServices,
  languages,
  industries,
  canManage,
}: {
  kind: "offer" | "need";
  companyId: string;
  locale: AppLocale;
  items: OfferNeedItem[];
  capabilityTypes: CapabilityOption[];
  productsServices: Option[];
  languages: Option[];
  industries: Option[];
  canManage: boolean;
}) {
  const t = useTranslations("OfferNeed");
  const router = useRouter();
  const [formMode, setFormMode] = useState<"new" | string | null>(null);

  const table = kind === "offer" ? "company_offers" : "company_needs";

  async function toggleStatus(item: OfferNeedItem) {
    const supabase = createClient();
    await supabase
      .from(table)
      .update({ status: item.status === "active" ? "inactive" : "active" })
      .eq("id", item.id);
    router.refresh();
  }

  async function remove(item: OfferNeedItem) {
    const supabase = createClient();
    await supabase.from(table).delete().eq("id", item.id);
    router.refresh();
  }

  function editingItemFor(id: string): EditingOfferNeed | null {
    const item = items.find((i) => i.id === id);
    if (!item) return null;
    return {
      id: item.id,
      capabilityTypeCode: item.capabilityTypeCode,
      industryId: item.industryId,
      targetCountryCode: item.targetCountryCode,
      targetRegion: item.targetRegion,
      description: item.description,
      soughtEmployeeRange: item.soughtEmployeeRange,
      productServiceIds: item.productServiceIds,
      languageCodes: item.languageCodes,
    };
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {kind === "offer" ? t("weOfferTitle") : t("weSeekTitle")}
        </h2>
        {canManage && formMode === null ? (
          <SubmitButton
            type="button"
            variant="secondary"
            onClick={() => setFormMode("new")}
          >
            {kind === "offer" ? t("addOffer") : t("addNeed")}
          </SubmitButton>
        ) : null}
      </div>

      {items.length === 0 && formMode === null ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {kind === "offer" ? t("noOffers") : t("noNeeds")}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {items.map((item) =>
          formMode === item.id ? (
            <OfferNeedForm
              key={item.id}
              kind={kind}
              companyId={companyId}
              locale={locale}
              capabilityTypes={capabilityTypes}
              productsServices={productsServices}
              languages={languages}
              industries={industries}
              editing={editingItemFor(item.id)}
              onCancel={() => setFormMode(null)}
              onSaved={() => {
                setFormMode(null);
                router.refresh();
              }}
            />
          ) : (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-md border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {item.title}
                  </p>
                  {item.description ? (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.status === "active"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {item.status === "active"
                    ? t("statusActive")
                    : t("statusInactive")}
                </span>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <SubmitButton
                    type="button"
                    variant="secondary"
                    onClick={() => setFormMode(item.id)}
                  >
                    {t("editAction")}
                  </SubmitButton>
                  <SubmitButton
                    type="button"
                    variant="secondary"
                    onClick={() => toggleStatus(item)}
                  >
                    {item.status === "active"
                      ? t("deactivateAction")
                      : t("activateAction")}
                  </SubmitButton>
                  <SubmitButton
                    type="button"
                    variant="secondary"
                    onClick={() => remove(item)}
                  >
                    {t("deleteAction")}
                  </SubmitButton>
                </div>
              ) : null}
            </li>
          ),
        )}
      </ul>

      {formMode === "new" ? (
        <OfferNeedForm
          kind={kind}
          companyId={companyId}
          locale={locale}
          capabilityTypes={capabilityTypes}
          productsServices={productsServices}
          languages={languages}
          industries={industries}
          editing={null}
          onCancel={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
