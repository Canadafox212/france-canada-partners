import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import {
  ClaimsReviewList,
  type ClaimReviewItem,
} from "@/components/claims/ClaimsReviewList";

/**
 * Première page du futur back-office admin (§34 du cahier des charges
 * Phase 7) : volontairement minimale (liste + approuver/refuser), pas de
 * section /admin complète construite cette phase. Gardée par
 * platform_role, pas seulement par la RLS des tables sous-jacentes — un
 * visiteur non admin obtient un 404, jamais un message "accès refusé" qui
 * confirmerait l'existence de la page.
 */
export default async function AdminClaimsPage() {
  const [activeLocaleValue, profile] = await Promise.all([
    locale(),
    getCurrentProfile(),
  ]);
  const activeLocale = activeLocaleValue as AppLocale;

  if (!profile) {
    redirect({ href: "/connexion", locale: activeLocale });
    return null;
  }
  if (profile.platform_role !== "admin") {
    notFound();
  }

  const t = await getTranslations("Claim");
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_claims")
    .select(
      `id, professional_email, verification_method, status, submitted_at,
       companies(display_name), profiles(full_name)`,
    )
    .in("status", ["pending", "verified"])
    .order("submitted_at", { ascending: true });

  const one = <T,>(value: T | T[] | null | undefined): T | undefined =>
    Array.isArray(value) ? value[0] : (value ?? undefined);

  const items: ClaimReviewItem[] = (data ?? []).map((row) => ({
    id: row.id,
    companyName: one(row.companies)?.display_name ?? "—",
    userLabel: one(row.profiles)?.full_name ?? "—",
    professionalEmail: row.professional_email,
    verificationMethod: row.verification_method,
    status: row.status,
    submittedAt: row.submitted_at,
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("adminTitle")}
      </h1>
      <ClaimsReviewList items={items} />
    </main>
  );
}
