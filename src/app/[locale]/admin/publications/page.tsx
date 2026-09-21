import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import {
  PublicationsReviewList,
  type PublicationReviewItem,
} from "@/components/publications/PublicationsReviewList";

/**
 * Deuxième page du back-office admin (Phase 10C, LOT 10C-4), calquée sur
 * /admin/revendications (Phase 7) : gardée par platform_role, pas
 * seulement par la RLS des tables sous-jacentes — un visiteur non admin
 * obtient un 404, jamais un message "accès refusé".
 *
 * "Profil prêt : oui/non" est calculé côté base par
 * admin_is_company_ready_for_publication() (migration 0026) — jamais
 * recalculé ici en TypeScript, pour ne jamais dupliquer les critères de
 * is_company_ready_for_publication() (source unique de vérité, partagée
 * avec request_company_publication()/review_company_publication_request()).
 */
export default async function AdminPublicationsPage() {
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

  const t = await getTranslations("CompanyPublication");
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_publication_requests")
    .select(
      "id, company_id, requested_at, companies(display_name), profiles(full_name)",
    )
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  const one = <T,>(value: T | T[] | null | undefined): T | undefined =>
    Array.isArray(value) ? value[0] : (value ?? undefined);

  const items: PublicationReviewItem[] = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: isReady } = await supabase.rpc(
        "admin_is_company_ready_for_publication",
        { p_company_id: row.company_id },
      );
      return {
        id: row.id,
        companyName: one(row.companies)?.display_name ?? "—",
        requesterLabel:
          one(row.profiles)?.full_name ?? t("adminRequesterUnknown"),
        requestedAt: row.requested_at,
        isReady: Boolean(isReady),
      };
    }),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("adminTitle")}
      </h1>
      <PublicationsReviewList items={items} />
    </main>
  );
}
