import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { MarkNotificationReadButton } from "@/components/notifications/MarkNotificationReadButton";

const PAGE_SIZE = 20;

type SearchParams = { page?: string };

const KNOWN_TYPES = [
  "partnership_request_received",
  "partnership_request_accepted",
  "partnership_request_declined",
  "company_publication_approved",
  "company_publication_rejected",
] as const;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [user, activeLocaleValue, { page }] = await Promise.all([
    getCurrentUser(),
    locale(),
    searchParams,
  ]);
  const activeLocale = activeLocaleValue as AppLocale;
  if (!user) {
    redirect({ href: "/connexion", locale: activeLocale });
    return null;
  }

  const t = await getTranslations("Notification");
  const tPartnership = await getTranslations("PartnershipRequest");
  const tAccount = await getTranslations("Account");
  const supabase = await createClient();

  const currentPage = Math.max(1, Number(page) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: notifications, count } = await supabase
    .from("notifications")
    .select("id, type, payload, read_at, created_at", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  const rows = notifications ?? [];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <Breadcrumbs items={[{ label: tAccount("title"), href: "/compte" }, { label: t("pageTitle") }]} />
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("pageTitle")}
      </h1>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((n) => {
            const isKnownType = (KNOWN_TYPES as readonly string[]).includes(n.type);
            const title = isKnownType ? t(`type.${n.type}.title`) : n.type;
            const message = isKnownType ? t(`type.${n.type}.message`) : "";
            const requestId = (n.payload as { request_id?: string } | null)?.request_id;

            return (
              <li
                key={n.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3 ${
                  n.read_at
                    ? "border-slate-200 dark:border-slate-800"
                    : "border-slate-400 bg-slate-50 dark:border-slate-600 dark:bg-slate-900"
                }`}
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{title}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {new Date(n.created_at).toLocaleString(activeLocale)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {requestId ? (
                    <Link
                      href={{
                        pathname: "/compte/mises-en-relation/[id]",
                        params: { id: requestId },
                      }}
                      className="text-sm text-slate-600 underline dark:text-slate-300"
                    >
                      {tPartnership("viewAction")}
                    </Link>
                  ) : null}
                  {!n.read_at ? (
                    <MarkNotificationReadButton notificationId={n.id} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          {currentPage > 1 ? (
            <Link
              href={{ pathname: "/compte/notifications", query: { page: String(currentPage - 1) } }}
            >
              ←
            </Link>
          ) : (
            <span />
          )}
          <span>
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={{ pathname: "/compte/notifications", query: { page: String(currentPage + 1) } }}
            >
              →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </main>
  );
}
