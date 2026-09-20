"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  companyMarketSchema,
  type CompanyMarketInput,
} from "@/validations/companyMarket";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

export type CompanyMarketItem = {
  id: string;
  countryCode: string;
  region: string | null;
  city: string | null;
};

/**
 * Formulaire minimal pour company_markets (Phase 10C) — table existante
 * depuis la Phase 4 mais sans aucune interface jusqu'ici. Ne couvre que
 * market_type='target' (marchés recherchés), seul besoin identifié par la
 * checklist d'activation ; 'current' reste non construit tant qu'aucun
 * besoin produit ne l'exige.
 */
export function CompanyMarketsForm({
  companyId,
  markets,
  canManage,
}: {
  companyId: string;
  markets: CompanyMarketItem[];
  canManage: boolean;
}) {
  const t = useTranslations("CompanyMarkets");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompanyMarketInput>({ resolver: zodResolver(companyMarketSchema) });

  async function onSubmit(values: CompanyMarketInput) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.from("company_markets").insert({
      company_id: companyId,
      market_type: "target",
      country_code: values.countryCode,
      region: values.region || null,
      city: values.city || null,
    });
    if (error) {
      setFormError(error.message || tCommon("errorGeneric"));
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  }

  async function onRemove(id: string) {
    const supabase = createClient();
    await supabase.from("company_markets").delete().eq("id", id);
    router.refresh();
  }

  return (
    <section id="markets" className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        {t("title")}
      </h2>

      {markets.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {markets.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200"
            >
              <span>
                {[m.countryCode, m.region, m.city].filter(Boolean).join(" — ")}
              </span>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => onRemove(m.id)}
                  aria-label={tCommon("delete")}
                  className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        open ? (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4 rounded-md border border-slate-200 p-4 dark:border-slate-800"
          >
            <FormField
              label={t("countryLabel")}
              htmlFor="marketCountryCode"
              error={errors.countryCode?.message}
            >
              <input
                id="marketCountryCode"
                type="text"
                maxLength={2}
                className={inputClasses}
                {...register("countryCode")}
              />
            </FormField>
            <FormField
              label={t("regionLabel")}
              htmlFor="marketRegion"
              error={errors.region?.message}
            >
              <input
                id="marketRegion"
                type="text"
                className={inputClasses}
                {...register("region")}
              />
            </FormField>
            <FormField
              label={t("cityLabel")}
              htmlFor="marketCity"
              error={errors.city?.message}
            >
              <input
                id="marketCity"
                type="text"
                className={inputClasses}
                {...register("city")}
              />
            </FormField>

            {formError ? (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2">
              <SubmitButton isLoading={isSubmitting}>
                {isSubmitting ? tCommon("loading") : t("addAction")}
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
        ) : (
          <SubmitButton
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => setOpen(true)}
          >
            {t("addAction")}
          </SubmitButton>
        )
      ) : null}
    </section>
  );
}
