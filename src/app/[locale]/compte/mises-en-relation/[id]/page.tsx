import { notFound } from "next/navigation";
import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser, getCurrentUserCompanies } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PartnershipRequestActions } from "@/components/partnerships/PartnershipRequestActions";

export default async function PartnershipRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [user, activeLocaleValue, { id }] = await Promise.all([
    getCurrentUser(),
    locale(),
    params,
  ]);
  const activeLocale = activeLocaleValue as AppLocale;
  if (!user) {
    redirect({ href: "/connexion", locale: activeLocale });
    return null;
  }

  const [t, memberships] = await Promise.all([
    getTranslations("PartnershipRequest"),
    getCurrentUserCompanies(),
  ]);
  const myCompanyIds = new Set(
    memberships
      .map((m) => (Array.isArray(m.companies) ? m.companies[0] : m.companies))
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => c.id),
  );

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("partnership_requests")
    .select(
      "id, status, subject, message, source_type, created_at, requester_company_id, target_company_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!request) notFound();

  const isRequester = myCompanyIds.has(request.requester_company_id);
  const isTarget = myCompanyIds.has(request.target_company_id);
  if (!isRequester && !isTarget) notFound();

  const { data: companies } = await supabase
    .from("companies")
    .select("id, display_name")
    .in("id", [request.requester_company_id, request.target_company_id]);
  const nameById = new Map((companies ?? []).map((c) => [c.id, c.display_name]));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <Breadcrumbs
        items={[
          { label: t("listTitle"), href: "/compte/mises-en-relation" },
          { label: t("detailTitle") },
        ]}
      />
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {request.subject}
      </h1>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("fromLabel")}: {nameById.get(request.requester_company_id) ?? "—"}
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("toLabel")}: {nameById.get(request.target_company_id) ?? "—"}
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {new Date(request.created_at).toLocaleDateString(activeLocale)}
          {" · "}
          {t(`status.${request.status}`)}
          {" · "}
          {t(`source.${request.source_type}`)}
        </p>
        <p className="whitespace-pre-wrap text-slate-900 dark:text-white">
          {request.message}
        </p>
      </section>

      <PartnershipRequestActions
        requestId={request.id}
        role={isTarget ? "target" : "requester"}
        status={request.status}
      />

      <Link
        href="/compte/mises-en-relation"
        className="text-sm text-slate-500 underline dark:text-slate-400"
      >
        {t("backToList")}
      </Link>
    </main>
  );
}
