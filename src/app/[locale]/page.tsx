import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/Button";

export default async function HomePage() {
  const t = await getTranslations("HomePage");

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

      <div className="flex flex-wrap items-center justify-center gap-4">
        <ButtonLink href="/entreprises" variant="primary">
          {t("ctaFindPartner")}
        </ButtonLink>
        <ButtonLink href="/opportunites" variant="secondary">
          {t("ctaPublishOpportunity")}
        </ButtonLink>
        <ButtonLink href="/inscription" variant="secondary">
          {t("ctaRegisterCompany")}
        </ButtonLink>
      </div>

      <p className="max-w-md text-sm text-slate-400 dark:text-slate-500">
        {t("comingSoon")}
      </p>
    </main>
  );
}
