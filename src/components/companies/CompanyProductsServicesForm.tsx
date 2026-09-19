"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

type Option = { id: string; label: string };

export function CompanyProductsServicesForm({
  companyId,
  productsServices,
  selectedIds,
  canManage,
}: {
  companyId: string;
  productsServices: Option[];
  selectedIds: string[];
  canManage: boolean;
}) {
  const t = useTranslations("ProductsServices");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(id: string) {
    setSaved(false);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    const toAdd = selected.filter((id) => !selectedIds.includes(id));
    const toRemove = selectedIds.filter((id) => !selected.includes(id));

    if (toAdd.length > 0) {
      await supabase.from("company_products_services").insert(
        toAdd.map((product_service_id) => ({
          company_id: companyId,
          product_service_id,
        })),
      );
    }
    if (toRemove.length > 0) {
      await supabase
        .from("company_products_services")
        .delete()
        .eq("company_id", companyId)
        .in("product_service_id", toRemove);
    }

    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        {t("title")}
      </h2>
      {productsServices.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("empty")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {productsServices.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200"
            >
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
                disabled={!canManage}
              />
              {p.label}
            </label>
          ))}
        </div>
      )}
      {canManage ? (
        <div className="flex items-center gap-3">
          <SubmitButton
            type="button"
            onClick={handleSave}
            isLoading={saving}
            className="self-start"
          >
            {saving ? tCommon("loading") : tCommon("save")}
          </SubmitButton>
          {saved ? (
            <span className="text-sm text-green-700 dark:text-green-400">
              {tCommon("saved")}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
