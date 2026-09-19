import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { CreateCompanyForm } from "@/components/companies/CreateCompanyForm";

export default async function CreateCompanyPage() {
  const [user, activeLocale] = await Promise.all([getCurrentUser(), locale()]);
  if (!user) {
    redirect({ href: "/connexion", locale: activeLocale as AppLocale });
    return null;
  }

  const [t, supabase] = await Promise.all([
    getTranslations("Company"),
    createClient(),
  ]);
  const { data: industries } = await supabase
    .from("industries")
    .select("id, name_fr, name_en")
    .order(activeLocale === "en" ? "name_en" : "name_fr");

  const industryOptions = (industries ?? []).map((industry) => ({
    id: industry.id,
    label: activeLocale === "en" ? industry.name_en : industry.name_fr,
  }));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("createTitle")}
      </h1>
      <CreateCompanyForm industries={industryOptions} />
    </main>
  );
}
