import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser, getCurrentUserCompanies } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";

type SearchParams = { tab?: string };

export default async function PartnershipRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [user, activeLocaleValue, { tab }] = await Promise.all([
    getCurrentUser(),
    locale(),
    searchParams,
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
  const supabase = await createClient();

  const myCompanyIds = memberships
    .map((m) => (Array.isArray(m.companies) ? m.companies[0] : m.companies))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => c.id);

  const activeTab = tab === "sent" ? "sent" : "received";

  const [{ data: received }, { data: sent }] = await Promise.all([
    myCompanyIds.length > 0
      ? supabase
          .from("partnership_requests")
          .select(
            "id, status, subject, source_type, created_at, requester_company_id, target_company_id",
          )
          .in("target_company_id", myCompanyIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    myCompanyIds.length > 0
      ? supabase
          .from("partnership_requests")
          .select(
            "id, status, subject, source_type, created_at, requester_company_id, target_company_id",
          )
          .in("requester_company_id", myCompanyIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const rows = activeTab === "received" ? (received ?? []) : (sent ?? []);
  const otherCompanyIds = rows.map((r) =>
    activeTab === "received" ? r.requester_company_id : r.target_company_id,
  );
  const { data: companies } =
    otherCompanyIds.length > 0
      ? await supabase
          .from("companies")
          .select("id, display_name")
          .in("id", [...new Set(otherCompanyIds)])
      : { data: [] };
  const nameById = new Map((companies ?? []).map((c) => [c.id, c.display_name]));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Breadcrumbs
        items={[{ label: t("listTitle"), href: "/compte" }, { label: t("listTitle") }]}
      />
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("listTitle")}
      </h1>

      <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800">
        <Link
          href={{ pathname: "/compte/mises-en-relation", query: { tab: "received" } }}
          className={`pb-2 text-sm font-medium ${
            activeTab === "received"
              ? "border-b-2 border-slate-900 text-slate-900 dark:border-white dark:text-white"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {t("receivedTab")}
        </Link>
        <Link
          href={{ pathname: "/compte/mises-en-relation", query: { tab: "sent" } }}
          className={`pb-2 text-sm font-medium ${
            activeTab === "sent"
              ? "border-b-2 border-slate-900 text-slate-900 dark:border-white dark:text-white"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {t("sentTab")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {activeTab === "received" ? t("emptyReceived") : t("emptySent")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={{
                  pathname: "/compte/mises-en-relation/[id]",
                  params: { id: r.id },
                }}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-4 py-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {nameById.get(
                      activeTab === "received"
                        ? r.requester_company_id
                        : r.target_company_id,
                    ) ?? "—"}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {r.subject}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{new Date(r.created_at).toLocaleDateString(activeLocale)}</span>
                  <span>{t(`status.${r.status}`)}</span>
                  <span>{t(`source.${r.source_type}`)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
