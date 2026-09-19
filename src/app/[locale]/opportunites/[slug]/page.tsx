import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";
import { RespondToOpportunityForm } from "@/components/opportunities/RespondToOpportunityForm";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("title, description, status")
    .eq("slug", slug)
    .maybeSingle();

  if (!opportunity) return {};

  return {
    title: opportunity.title,
    description: opportunity.description?.slice(0, 160),
    alternates: { canonical: `/opportunites/${slug}` },
    // Restée consultable, mais retirée de l'indexation une fois clôturée/expirée.
    robots:
      opportunity.status === "published"
        ? undefined
        : { index: false, follow: true },
  };
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [t, user] = await Promise.all([
    getTranslations("Opportunity"),
    getCurrentUser(),
  ]);
  const supabase = await createClient();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(
      "id, company_id, title, description, direction, capability_type_code, target_country_code, target_region, origin_country_code, status, published_at, deadline, industries(name_fr), companies(display_name), business_capability_types(label_fr), opportunity_products_services(products_services(label_fr))",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!opportunity) {
    notFound();
  }

  const company = Array.isArray(opportunity.companies)
    ? opportunity.companies[0]
    : opportunity.companies;
  const capability = Array.isArray(opportunity.business_capability_types)
    ? opportunity.business_capability_types[0]
    : opportunity.business_capability_types;
  const industry = Array.isArray(opportunity.industries)
    ? opportunity.industries[0]
    : opportunity.industries;
  const products = (opportunity.opportunity_products_services ?? [])
    .map((ops) =>
      Array.isArray(ops.products_services)
        ? ops.products_services[0]
        : ops.products_services,
    )
    .filter(Boolean);

  let eligibleCompanies: { id: string; displayName: string }[] = [];
  if (user) {
    const { data: memberships } = await supabase
      .from("company_members")
      .select("role, companies(id, display_name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "admin", "member"]);
    eligibleCompanies = (memberships ?? [])
      .map((m) => (Array.isArray(m.companies) ? m.companies[0] : m.companies))
      .filter(
        (c): c is { id: string; display_name: string } =>
          !!c && c.id !== opportunity.company_id,
      )
      .map((c) => ({ id: c.id, displayName: c.display_name }));
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <nav className="text-sm text-slate-500 dark:text-slate-400">
        <Link href="/opportunites" className="underline">
          {t("listTitle")}
        </Link>
      </nav>

      {opportunity.status === "closed" || opportunity.status === "expired" ? (
        <p className="rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("opportunityOverNotice")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          {opportunity.title}
        </h1>
        <p className="text-slate-600 dark:text-slate-300">
          {company?.display_name}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">
            {t("originLabel")}
          </dt>
          <dd className="text-slate-900 dark:text-white">
            {opportunity.origin_country_code}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">
            {t("targetMarketLabel")}
          </dt>
          <dd className="text-slate-900 dark:text-white">
            {opportunity.target_country_code ?? "—"}
            {opportunity.target_region ? `, ${opportunity.target_region}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">
            {t("typeLabel")}
          </dt>
          <dd className="text-slate-900 dark:text-white">
            {capability?.label_fr}
          </dd>
        </div>
        {industry ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("industryLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {industry.name_fr}
            </dd>
          </div>
        ) : null}
        {opportunity.deadline ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              {t("deadlineLabel")}
            </dt>
            <dd className="text-slate-900 dark:text-white">
              {opportunity.deadline}
            </dd>
          </div>
        ) : null}
      </dl>

      {products.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("productsLabel")}
          </h2>
          <p className="text-slate-900 dark:text-white">
            {products.map((p) => p?.label_fr).join(", ")}
          </p>
        </div>
      ) : null}

      {opportunity.description ? (
        <p className="text-slate-700 dark:text-slate-200">
          {opportunity.description}
        </p>
      ) : null}

      {opportunity.status === "published" ? (
        user ? (
          <RespondToOpportunityForm
            opportunityId={opportunity.id}
            eligibleCompanies={eligibleCompanies}
            userId={user.id}
          />
        ) : (
          <Link
            href="/connexion"
            className="text-sm underline text-slate-700 dark:text-slate-200"
          >
            {t("loginToRespond")}
          </Link>
        )
      ) : null}
    </main>
  );
}
