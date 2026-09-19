import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import {
  CreateOpportunityClient,
  type PrefillSource,
} from "@/components/opportunities/CreateOpportunityClient";

export default async function CreateOpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  if (!canManage) notFound();

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
    { data: offers },
    { data: needs },
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
    supabase
      .from("company_offers")
      .select(
        "id, title, capability_type_code, industry_id, target_country_code, target_region, description, company_offer_products_services(product_service_id)",
      )
      .eq("company_id", id)
      .eq("status", "active"),
    supabase
      .from("company_needs")
      .select(
        "id, title, capability_type_code, industry_id, target_country_code, target_region, description, company_need_products_services(product_service_id)",
      )
      .eq("company_id", id)
      .eq("status", "active"),
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

  const prefillSources: PrefillSource[] = [
    ...(offers ?? []).map((o) => ({
      key: `offer-${o.id}`,
      label: `${t("prefillFromOffer")} : ${o.title}`,
      values: {
        direction: "offering" as const,
        capabilityTypeCode: o.capability_type_code,
        industryId: o.industry_id,
        targetCountryCode: o.target_country_code,
        targetRegion: o.target_region,
        description: o.description,
        productServiceIds: (o.company_offer_products_services ?? []).map(
          (p) => p.product_service_id,
        ),
      },
    })),
    ...(needs ?? []).map((n) => ({
      key: `need-${n.id}`,
      label: `${t("prefillFromNeed")} : ${n.title}`,
      values: {
        direction: "seeking" as const,
        capabilityTypeCode: n.capability_type_code,
        industryId: n.industry_id,
        targetCountryCode: n.target_country_code,
        targetRegion: n.target_region,
        description: n.description,
        productServiceIds: (n.company_need_products_services ?? []).map(
          (p) => p.product_service_id,
        ),
      },
    })),
  ];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("createTitle")}
      </h1>
      <CreateOpportunityClient
        companyId={company.id}
        originCountryCode={company.country_code}
        locale={activeLocale}
        capabilityTypes={capabilityTypes}
        productsServices={productsServices}
        industries={industries}
        prefillSources={prefillSources}
      />
    </main>
  );
}
