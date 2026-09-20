import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/Button";
import { HomeSearchBar } from "@/components/directory/HomeSearchBar";
import { getCurrentUser } from "@/lib/supabase/session";
import { getPathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

export default async function HomePage() {
  const [t, user, activeLocaleValue] = await Promise.all([
    getTranslations("HomePage"),
    getCurrentUser(),
    locale(),
  ]);
  const activeLocale = activeLocaleValue as AppLocale;
  const directoryPath = getPathname({
    href: "/entreprises",
    locale: activeLocale,
  });

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 bg-slate-50 px-6 py-24 text-center dark:bg-slate-950">
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
          {t("title")}
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-300">
          {t("subtitle")}
        </p>
      </div>

      <HomeSearchBar
        actionPath={directoryPath}
        placeholder={t("searchPlaceholder")}
        buttonLabel={t("searchButton")}
      />

      <div className="flex flex-wrap items-center justify-center gap-4">
        <ButtonLink href="/entreprises" variant="primary">
          {t("ctaFindCompany")}
        </ButtonLink>
        <ButtonLink href="/opportunites" variant="secondary">
          {t("ctaPublishOpportunity")}
        </ButtonLink>
        <ButtonLink
          href={user ? "/compte/entreprises/nouvelle" : "/inscription"}
          variant="secondary"
        >
          {user ? t("ctaMyAccount") : t("ctaRegisterCompany")}
        </ButtonLink>
      </div>
    </main>
  );
}
