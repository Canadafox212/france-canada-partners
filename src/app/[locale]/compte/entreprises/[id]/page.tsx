import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { pickCompanyTranslation } from "@/lib/companies";
import { EditCompanyForm } from "@/components/companies/EditCompanyForm";
import { MembersList } from "@/components/companies/MembersList";
import { CompanyProductsServicesForm } from "@/components/companies/CompanyProductsServicesForm";
import {
  OffersNeedsSection,
  type OfferNeedItem,
} from "@/components/companies/OffersNeedsSection";
import {
  OpportunitiesListSection,
  type CompanyOpportunityItem,
} from "@/components/opportunities/OpportunitiesListSection";
import { MatchCard } from "@/components/matching/MatchCard";
import {
  getPartnersForCompany,
  getOpportunitiesForCompany,
} from "@/lib/matching/service";
import { RequestPartnershipButton } from "@/components/partnerships/RequestPartnershipButton";

type OfferNeedRow = {
  id: string;
  title: string | null;
  description: string | null;
  capability_type_code: string;
  target_country_code: string | null;
  target_region: string | null;
  status: "active" | "inactive";
  industry_id: string | null;
  sought_employee_range?: string | null;
  products?: { product_service_id: string }[] | null;
  langs?: { language_code: string }[] | null;
};

function mapOfferNeedRow(row: OfferNeedRow): OfferNeedItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    capabilityTypeCode: row.capability_type_code,
    targetCountryCode: row.target_country_code,
    targetRegion: row.target_region,
    status: row.status,
    industryId: row.industry_id,
    soughtEmployeeRange: row.sought_employee_range,
    productServiceIds: (row.products ?? []).map((p) => p.product_service_id),
    languageCodes: (row.langs ?? []).map((l) => l.language_code),
  };
}

export default async function EditCompanyPage({
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
    .select(
      "id, display_name, legal_name, website, professional_email, phone, company_locations(id, region, city, is_primary), company_translations(locale, description, tagline)",
    )
    .eq("id", id)
    .single();

  // RLS renvoie "aucune ligne" aussi bien si l'entreprise n'existe pas que
  // si elle existe mais n'est pas visible pour cet utilisateur : dans les
  // deux cas, une page 404 générique évite de révéler laquelle des deux
  // situations s'applique.
  if (!company) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const canEditProfile =
    membership?.role === "owner" || membership?.role === "admin";
  const canManageOffersNeeds =
    membership?.role === "owner" ||
    membership?.role === "admin" ||
    membership?.role === "member";

  const [
    { data: members },
    { data: capabilityTypes },
    { data: productsServicesCatalog },
    { data: languagesCatalog },
    { data: industriesCatalog },
    { data: companyProductsServices },
    { data: offerRows },
    { data: needRows },
    { data: opportunityRows },
  ] = await Promise.all([
    supabase
      .from("company_members")
      .select("id, role, status, profiles(full_name)")
      .eq("company_id", id)
      .eq("status", "active"),
    supabase
      .from("business_capability_types")
      .select("code, label_fr, label_en, applies_to_offers, applies_to_needs")
      .eq("is_active", true),
    supabase
      .from("products_services")
      .select("id, label_fr, label_en")
      .order("label_fr"),
    supabase
      .from("languages")
      .select("code, name_fr, name_en")
      .order("name_fr"),
    supabase.from("industries").select("id, name_fr, name_en").order("name_fr"),
    supabase
      .from("company_products_services")
      .select("product_service_id")
      .eq("company_id", id),
    supabase
      .from("company_offers")
      .select(
        "id, title, description, capability_type_code, target_country_code, target_region, status, industry_id, products:company_offer_products_services(product_service_id), langs:company_offer_languages(language_code)",
      )
      .eq("company_id", id)
      .order("created_at"),
    supabase
      .from("company_needs")
      .select(
        "id, title, description, capability_type_code, target_country_code, target_region, status, industry_id, sought_employee_range, products:company_need_products_services(product_service_id), langs:company_need_languages(language_code)",
      )
      .eq("company_id", id)
      .order("created_at"),
    supabase
      .from("opportunities")
      .select("id, title, status, opportunity_responses(count)")
      .eq("company_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const [partners, opportunitiesForYou] = await Promise.all([
    getPartnersForCompany(supabase, id),
    getOpportunitiesForCompany(supabase, id),
  ]);

  // Demandes de mise en relation déjà actives DE cette entreprise vers un
  // partenaire suggéré — évite de proposer un nouveau formulaire pour un
  // couple déjà en cours (Phase 9, §8 : une seule demande active par paire).
  const { data: activeOutgoingRequests } = await supabase
    .from("partnership_requests")
    .select("target_company_id, status")
    .eq("requester_company_id", id)
    .in("status", ["pending", "pending_unclaimed"]);
  const activeRequestStatusByTarget = new Map(
    (activeOutgoingRequests ?? []).map((r) => [
      r.target_company_id,
      r.status as "pending" | "pending_unclaimed",
    ]),
  );

  const t = await getTranslations("Company");
  const tMatching = await getTranslations("Matching");
  const primaryLocation =
    company.company_locations?.find((loc) => loc.is_primary) ?? null;
  const translation = pickCompanyTranslation(
    company.company_translations ?? [],
    activeLocale,
  );

  const labelFor = (row: {
    label_fr?: string;
    label_en?: string;
    name_fr?: string;
    name_en?: string;
  }) =>
    activeLocale === "en"
      ? (row.label_en ?? row.name_en ?? "")
      : (row.label_fr ?? row.name_fr ?? "");

  const productsServicesOptions = (productsServicesCatalog ?? []).map((p) => ({
    id: p.id,
    label: labelFor(p),
  }));
  const languagesOptions = (languagesCatalog ?? []).map((l) => ({
    id: l.code,
    label: labelFor(l),
  }));
  const industriesOptions = (industriesCatalog ?? []).map((i) => ({
    id: i.id,
    label: labelFor(i),
  }));
  const offerCapabilityTypes = (capabilityTypes ?? [])
    .filter((c) => c.applies_to_offers)
    .map((c) => ({ code: c.code, label: labelFor(c) }));
  const needCapabilityTypes = (capabilityTypes ?? [])
    .filter((c) => c.applies_to_needs)
    .map((c) => ({ code: c.code, label: labelFor(c) }));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {company.display_name}
      </h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("profileSectionTitle")}
        </h2>
        {canEditProfile ? (
          <EditCompanyForm
            companyId={company.id}
            locationId={primaryLocation?.id ?? null}
            descriptionLocale={activeLocale === "en" ? "en" : "fr"}
            defaultValues={{
              displayName: company.display_name,
              legalName: company.legal_name ?? "",
              website: company.website ?? "",
              professionalEmail: company.professional_email ?? "",
              phone: company.phone ?? "",
              region: primaryLocation?.region ?? "",
              city: primaryLocation?.city ?? "",
              description: translation?.description ?? "",
            }}
          />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("readOnlyNote")}
          </p>
        )}
      </section>

      <CompanyProductsServicesForm
        companyId={company.id}
        productsServices={productsServicesOptions}
        selectedIds={(companyProductsServices ?? []).map(
          (p) => p.product_service_id,
        )}
        canManage={canManageOffersNeeds}
      />

      <OffersNeedsSection
        kind="offer"
        companyId={company.id}
        locale={activeLocale}
        items={(offerRows ?? []).map(mapOfferNeedRow)}
        capabilityTypes={offerCapabilityTypes}
        productsServices={productsServicesOptions}
        languages={languagesOptions}
        industries={industriesOptions}
        canManage={canManageOffersNeeds}
      />

      <OffersNeedsSection
        kind="need"
        companyId={company.id}
        locale={activeLocale}
        items={(needRows ?? []).map(mapOfferNeedRow)}
        capabilityTypes={needCapabilityTypes}
        productsServices={productsServicesOptions}
        languages={languagesOptions}
        industries={industriesOptions}
        canManage={canManageOffersNeeds}
      />

      <OpportunitiesListSection
        companyId={company.id}
        items={(opportunityRows ?? []).map((o): CompanyOpportunityItem => ({
          id: o.id,
          title: o.title,
          status: o.status,
          responseCount: Array.isArray(o.opportunity_responses)
            ? (o.opportunity_responses[0]?.count ?? 0)
            : 0,
        }))}
        canManage={canManageOffersNeeds}
      />

      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {tMatching("partnersTitle")}
        </h2>
        {partners.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tMatching("partnersEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {partners.map((p, i) => (
              <MatchCard
                key={`${p.companyId}-${i}`}
                title={
                  p.companySlug ? (
                    <Link
                      href={{
                        pathname: "/entreprises/[geoOrSlug]",
                        params: { geoOrSlug: p.companySlug },
                      }}
                    >
                      {p.companyName}
                    </Link>
                  ) : (
                    p.companyName
                  )
                }
                subtitle={p.companyCountryCode}
                score={p.score}
                confidence={p.confidence}
                level={p.level}
                confidenceLevel={p.confidenceLevel}
                breakdown={p.breakdown}
                actions={
                  <RequestPartnershipButton
                    requesterCompanies={
                      canManageOffersNeeds
                        ? [{ id: company.id, name: company.display_name }]
                        : []
                    }
                    targetCompanyId={p.companyId}
                    sourceType="MATCH"
                    sourceMatchId={p.matchId}
                    alreadyActiveStatus={
                      activeRequestStatusByTarget.get(p.companyId) ?? null
                    }
                  />
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {tMatching("opportunitiesForYouTitle")}
        </h2>
        {opportunitiesForYou.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tMatching("opportunitiesForYouEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {opportunitiesForYou.map((o) => (
              <MatchCard
                key={o.opportunityId}
                title={
                  o.slug ? (
                    <Link
                      href={{
                        pathname: "/opportunites/[slug]",
                        params: { slug: o.slug },
                      }}
                    >
                      {o.title}
                    </Link>
                  ) : (
                    o.title
                  )
                }
                subtitle={o.companyName}
                score={o.score}
                confidence={o.confidence}
                level={o.level}
                confidenceLevel={o.confidenceLevel}
                breakdown={o.breakdown}
              />
            ))}
          </ul>
        )}
      </section>

      <MembersList members={members ?? []} />
    </main>
  );
}
