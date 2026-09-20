import { locale } from "next/root-params";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/Button";
import type { AppLocale } from "@/i18n/routing";
import { buildLocaleAlternates } from "@/lib/seo/alternates";

export async function generateMetadata() {
  const activeLocale = (await locale()) as AppLocale;
  const t = await getTranslations("QuebecLanding");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: buildLocaleAlternates("/quebec", activeLocale),
  };
}

/**
 * Page de recrutement dédiée au Québec (Phase 10C) — canal d'acquisition
 * pour la stratégie décrite en Phase 10B : aucune source de données
 * québécoise n'étant commercialement réutilisable, l'inscription
 * volontaire est le levier principal. Contenu statique, aucune entreprise
 * `[DEMO]` n'est présentée comme réelle (§4 de la demande).
 */
export default async function QuebecLandingPage() {
  const t = await getTranslations("QuebecLanding");

  const steps = [
    { title: t("step1Title"), text: t("step1Text") },
    { title: t("step2Title"), text: t("step2Text") },
    { title: t("step3Title"), text: t("step3Text") },
    { title: t("step4Title"), text: t("step4Text") },
  ];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-12 px-6 py-16">
      <section className="flex flex-col gap-4 text-center">
        <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
          {t("heroTitle")}
        </h1>
        <p className="text-slate-600 dark:text-slate-300">
          {t("heroSubtitle")}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/inscription">{t("ctaPrimary")}</ButtonLink>
          <ButtonLink href="/entreprises" variant="secondary">
            {t("ctaSecondary")}
          </ButtonLink>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          {t("howItWorksTitle")}
        </h2>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-white dark:text-slate-900"
              >
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  {step.title}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {step.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-slate-200 p-6 text-center dark:border-slate-800">
        <p className="font-medium text-slate-900 dark:text-white">
          {t("freeNoticeTitle")}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("freeNoticeText")}
        </p>
        <div className="mt-2 flex justify-center">
          <ButtonLink href="/inscription">{t("ctaPrimary")}</ButtonLink>
        </div>
      </section>
    </main>
  );
}
