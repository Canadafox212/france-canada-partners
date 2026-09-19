"use client";

import { useRouter } from "@/i18n/navigation";
import {
  OpportunityForm,
  type EditingOpportunity,
} from "@/components/opportunities/OpportunityForm";
import type { AppLocale } from "@/i18n/routing";

type Option = { id: string; label: string };
type CapabilityOption = {
  code: string;
  label: string;
  appliesToOffers: boolean;
  appliesToNeeds: boolean;
};

export function EditOpportunityClient({
  companyId,
  originCountryCode,
  locale,
  capabilityTypes,
  productsServices,
  industries,
  editing,
}: {
  companyId: string;
  originCountryCode: string;
  locale: AppLocale;
  capabilityTypes: CapabilityOption[];
  productsServices: Option[];
  industries: Option[];
  editing: EditingOpportunity;
}) {
  const router = useRouter();

  return (
    <OpportunityForm
      companyId={companyId}
      originCountryCode={originCountryCode}
      locale={locale}
      capabilityTypes={capabilityTypes}
      productsServices={productsServices}
      industries={industries}
      editing={editing}
      onCancel={() => router.back()}
      onSaved={() => router.refresh()}
    />
  );
}
