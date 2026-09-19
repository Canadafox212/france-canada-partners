import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { EditOpportunityClient } from "@/components/opportunities/EditOpportunityClient";
import { OpportunityStatusActions } from "@/components/opportunities/OpportunityStatusActions";
import {
  ResponsesManager,
  type OpportunityResponseItem,
} from "@/components/opportunities/ResponsesManager";

export default async function ManageOpportunityPage({
  params,
}: {
  params: Promise<{ id: string; opportunityId: string }>;
}) {
  const { id, opportunityId } = await params;
  const [user, activeLocaleValue] = await Promise.all([
    getCurrentUser(),
    locale(),
  ]);
  const activeLocale = activeLocaleValue as AppLocale;
  if (!user) {
    redirect({ href: "/connexion", locale: activeLocale });
    return null;
  }

  const supabase = await createClient();

  const { data: company } = await supabase
    .from("companies")
    .select("id, display_name, country_code")
    .eq("id", id)
    .single();
  if (!company) notFound();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(
      "id, title, status, capability_type_code, direction, industry_id, target_country_code, target_region, description, deadline, estimated_value, currency_code, opportunity_products_services(product_service_id)",
    )
    .eq("id", opportunityId)
    .eq("company_id", id)
    .maybeSingle();
  if (!opportunity) notFound();

  const { data: membership } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const canManage =
    membership?.role === "owner" ||
    membership?.role === "admin" ||
    membership?.role === "member";

  const t = await getTranslations("Opportunity");
  const labelFor = (row: {
    label_fr?: string;
    label_en?: string;
    name_fr?: string;
    name_en?: string;
  }) =>
    activeLocale === "en"
      ? (row.label_en ?? row.name_en ?? "")
      : (row.label_fr ?? row.name_fr ?? "");

  const [
    { data: capabilityTypesRaw },
    { data: productsServicesRaw },
    { data: industriesRaw },
    { data: responsesRaw },
  ] = await Promise.all([
    supabase
      .from("business_capability_types")
      .select("code, label_fr, label_en, applies_to_offers, applies_to_needs")
      .eq("is_active", true),
    supabase
      .from("products_services")
      .select("id, label_fr, label_en")
      .order("label_fr"),
    supabase.from("industries").select("id, name_fr, name_en").order("name_fr"),
    canManage
      ? supabase
          .from("opportunity_responses")
          .select("id, message, status, created_at, companies(display_name)")
          .eq("opportunity_id", opportunityId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const capabilityTypes = (capabilityTypesRaw ?? []).map((c) => ({
    code: c.code,
    label: labelFor(c),
    appliesToOffers: c.applies_to_offers,
    appliesToNeeds: c.applies_to_needs,
  }));
  const productsServices = (productsServicesRaw ?? []).map((p) => ({
    id: p.id,
    label: labelFor(p),
  }));
  const industries = (industriesRaw ?? []).map((i) => ({
    id: i.id,
    label: labelFor(i),
  }));

  const responses: OpportunityResponseItem[] = (responsesRaw ?? []).map((r) => {
    const respCompany = Array.isArray(r.companies)
      ? r.companies[0]
      : r.companies;
    return {
      id: r.id,
      respondingCompanyName: respCompany?.display_name ?? "—",
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          {opportunity.title}
        </h1>
        {canManage ? (
          <OpportunityStatusActions
            opportunityId={opportunity.id}
            status={opportunity.status}
          />
        ) : null}
      </div>

      {canManage ? (
        <EditOpportunityClient
          companyId={company.id}
          originCountryCode={company.country_code}
          locale={activeLocale}
          capabilityTypes={capabilityTypes}
          productsServices={productsServices}
          industries={industries}
          editing={{
            id: opportunity.id,
            capabilityTypeCode: opportunity.capability_type_code,
            direction: opportunity.direction,
            industryId: opportunity.industry_id,
            targetCountryCode: opportunity.target_country_code,
            targetRegion: opportunity.target_region,
            description: opportunity.description,
            deadline: opportunity.deadline,
            estimatedValue: opportunity.estimated_value,
            currencyCode: opportunity.currency_code,
            productServiceIds: (
              opportunity.opportunity_products_services ?? []
            ).map((p) => p.product_service_id),
          }}
        />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("readOnlyNote")}
        </p>
      )}

      {canManage ? (
        <ResponsesManager items={responses} canManage={canManage} />
      ) : null}
    </main>
  );
}
