import type { AppLocale } from "@/i18n/routing";

type Translation = {
  locale: string;
  description: string | null;
  tagline: string | null;
};

/**
 * Une entreprise n'est pas obligée de fournir sa description dans les deux
 * langues (voir PROJECT_SPEC.md §11) : on affiche celle de la langue
 * demandée si elle existe, sinon on se replie sur l'autre langue disponible.
 */
export function pickCompanyTranslation(
  translations: Translation[],
  locale: AppLocale,
): Translation | null {
  return (
    translations.find((t) => t.locale === locale) ??
    translations.find((t) => t.description || t.tagline) ??
    null
  );
}
