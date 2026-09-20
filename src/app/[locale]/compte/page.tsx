import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import {
  getCurrentAuthUser,
  getCurrentProfile,
  getCurrentUser,
  getCurrentUserCompanies,
} from "@/lib/supabase/session";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/account/ProfileForm";
import { ButtonLink } from "@/components/ui/Button";

export default async function AccountPage() {
  const [user, activeLocale] = await Promise.all([getCurrentUser(), locale()]);
  if (!user) {
    redirect({ href: "/connexion", locale: activeLocale as AppLocale });
    return null;
  }

  const supabase = await createClient();
  const [t, tCommon, authUser, profile, companies, { count: unreadCount }] =
    await Promise.all([
      getTranslations("Account"),
      getTranslations("Common"),
      getCurrentAuthUser(),
      getCurrentProfile(),
      getCurrentUserCompanies(),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null),
    ]);

  const roleLabel: Record<string, string> = {
    owner: t("roleOwner"),
    admin: t("roleAdmin"),
    member: t("roleMember"),
    viewer: t("roleViewer"),
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("title")}
      </h1>

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/compte/mises-en-relation" variant="secondary">
          {t("partnershipRequestsLink")}
        </ButtonLink>
        <ButtonLink href="/compte/notifications" variant="secondary">
          {t("notificationsLink")}
          {unreadCount ? ` (${unreadCount})` : ""}
        </ButtonLink>
      </div>

      <section className="flex flex-col gap-2 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("emailLabel")}
        </p>
        <p className="text-slate-900 dark:text-white">{authUser?.email}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {t("verificationStatus")}
        </p>
        <p className="text-slate-900 dark:text-white">
          {authUser?.email_confirmed_at
            ? t("verificationVerified")
            : t("verificationUnverified")}
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("profileSectionTitle")}
        </h2>
        {profile ? (
          <ProfileForm
            userId={user.id}
            defaultValues={{
              fullName: profile.full_name ?? "",
              preferredLanguage: (profile.preferred_language ?? "fr") as
                "fr" | "en",
            }}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t("companiesSectionTitle")}
          </h2>
          <ButtonLink href="/compte/entreprises/nouvelle" variant="secondary">
            {t("createCompanyLink")}
          </ButtonLink>
        </div>

        {companies.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("noCompanies")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {companies.map((membership) => {
              const company = Array.isArray(membership.companies)
                ? membership.companies[0]
                : membership.companies;
              if (!company) return null;
              return (
                <li
                  key={company.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3 dark:border-slate-800"
                >
                  <span className="text-slate-900 dark:text-white">
                    {company.display_name}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      {roleLabel[membership.role] ?? membership.role}
                    </span>
                    <ButtonLink
                      href={{
                        pathname: "/compte/entreprises/[id]",
                        params: { id: company.id },
                      }}
                      variant="secondary"
                    >
                      {tCommon("edit")}
                    </ButtonLink>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
