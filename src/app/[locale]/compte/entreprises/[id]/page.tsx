import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { pickCompanyTranslation } from "@/lib/companies";
import { EditCompanyForm } from "@/components/companies/EditCompanyForm";
import { MembersList } from "@/components/companies/MembersList";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, activeLocale] = await Promise.all([getCurrentUser(), locale()]);
  if (!user) {
    redirect({ href: "/connexion", locale: activeLocale as AppLocale });
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

  const canEdit = membership?.role === "owner" || membership?.role === "admin";

  const { data: members } = await supabase
    .from("company_members")
    .select("id, role, status, profiles(full_name)")
    .eq("company_id", id)
    .eq("status", "active");

  const t = await getTranslations("Company");
  const primaryLocation =
    company.company_locations?.find((loc) => loc.is_primary) ?? null;
  const translation = pickCompanyTranslation(
    company.company_translations ?? [],
    activeLocale as AppLocale,
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {company.display_name}
      </h1>

      {canEdit ? (
        <EditCompanyForm
          companyId={company.id}
          locationId={primaryLocation?.id ?? null}
          descriptionLocale={(activeLocale as AppLocale) === "en" ? "en" : "fr"}
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

      <MembersList members={members ?? []} />
    </main>
  );
}
