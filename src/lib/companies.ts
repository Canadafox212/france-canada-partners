import type { AppLocale } from "@/i18n/routing";

type Translation = {
  locale: string;
  description: string | null;
  tagline: string | null;
  content_source?: string | null;
};

/**
 * Une entreprise n'est pas obligée de fournir sa description dans les deux
 * langues (voir PROJECT_SPEC.md §11) : on affiche celle de la langue
 * demandée si elle existe, sinon on se replie sur l'autre langue disponible.
 *
 * Ce repli ne s'applique JAMAIS à un contenu `EDITORIAL` (Phase 8, voir
 * docs/EDITORIAL_CONTENT.md) : un texte rédigé par l'équipe éditoriale
 * l'est pour une langue précise et ne doit jamais s'afficher tel quel dans
 * l'autre langue — contrairement à un contenu fourni par l'entreprise
 * elle-même, où montrer la langue disponible reste préférable à ne rien
 * montrer.
 */
export function pickCompanyTranslation(
  translations: Translation[],
  locale: AppLocale,
): Translation | null {
  const exact = translations.find((t) => t.locale === locale);
  if (exact) return exact;
  const fallback = translations.find((t) => t.description || t.tagline);
  if (fallback?.content_source === "EDITORIAL") return null;
  return fallback ?? null;
}
