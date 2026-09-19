import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

export async function generateMetadata() {
  const t = await getTranslations("Opportunity");
  return { title: t("listTitle"), description: t("listSubtitle") };
}

export default async function OpportunitiesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const t = await getTranslations("Opportunity");
  const supabase = await createClient();

  const [
    { data: capabilityTypes },
    { data: industries },
    { data: productsServices },
  ] = await Promise.all([
    supabase
      .from("business_capability_types")
      .select("code, label_fr, label_en")
      .eq("is_active", true),
    supabase.from("industries").select("id, name_fr, name_en").order("name_fr"),
    supabase
      .from("products_services")
      .select("id, label_fr, label_en")
      .order("label_fr"),
  ]);

  let query = supabase
    .from("opportunities")
    .select(
      "id, slug, title, direction, capability_type_code, target_country_code, target_region, origin_country_code, published_at, companies(display_name)",
    )
    .in("status", ["published"])
    .order("published_at", { ascending: false })
    .limit(50);

  if (params.type) query = query.eq("capability_type_code", params.type);
  if (params.industry) query = query.eq("industry_id", params.industry);
  if (params.origin)
    query = query.eq("origin_country_code", params.origin.toUpperCase());
  if (params.target)
    query = query.eq("target_country_code", params.target.toUpperCase());
  if (params.region) query = query.ilike("target_region", `%${params.region}%`);

  if (params.product) {
    const { data: matches } = await supabase
      .from("opportunity_products_services")
      .select("opportunity_id")
      .eq("product_service_id", params.product);
    const ids = (matches ?? []).map((m) => m.opportunity_id);
    query = query.in(
      "id",
      ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"],
    );
  }

  const { data: opportunities } = await query;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          {t("listTitle")}
        </h1>
        <p className="text-slate-600 dark:text-slate-300">
          {t("listSubtitle")}
        </p>
      </div>

      <form className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-3">
        <select
          name="type"
          defaultValue={params.type ?? ""}
          className={inputClasses}
        >
          <option value="">{t("filterTypeAll")}</option>
          {(capabilityTypes ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.label_fr}
            </option>
          ))}
        </select>
        <select
          name="industry"
          defaultValue={params.industry ?? ""}
          className={inputClasses}
        >
          <option value="">{t("filterIndustryAll")}</option>
          {(industries ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name_fr}
            </option>
          ))}
        </select>
        <input
          name="origin"
          defaultValue={params.origin ?? ""}
          placeholder={t("filterOriginPlaceholder")}
          className={inputClasses}
          maxLength={2}
        />
        <input
          name="target"
          defaultValue={params.target ?? ""}
          placeholder={t("filterTargetPlaceholder")}
          className={inputClasses}
          maxLength={2}
        />
        <input
          name="region"
          defaultValue={params.region ?? ""}
          placeholder={t("filterRegionPlaceholder")}
          className={inputClasses}
        />
        <select
          name="product"
          defaultValue={params.product ?? ""}
          className={inputClasses}
        >
          <option value="">{t("filterProductAll")}</option>
          {(productsServices ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label_fr}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary">{t("filterApply")}</SubmitButton>
      </form>

      {(opportunities ?? []).length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("listEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(opportunities ?? []).map((opp) => {
            const company = Array.isArray(opp.companies)
              ? opp.companies[0]
              : opp.companies;
            return (
              <li
                key={opp.id}
                className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
              >
                <Link
                  href={{
                    pathname: "/opportunites/[slug]",
                    params: { slug: opp.slug! },
                  }}
                  className="text-lg font-medium text-slate-900 underline dark:text-white"
                >
                  {opp.title}
                </Link>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {company?.display_name} · {opp.origin_country_code} →{" "}
                  {opp.target_country_code ?? "—"}
                  {opp.target_region ? `, ${opp.target_region}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
