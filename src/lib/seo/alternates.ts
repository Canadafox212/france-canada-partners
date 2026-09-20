import { getPathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

type HrefArg = Parameters<typeof getPathname>[0]["href"];

/**
 * Construit `alternates.canonical` (dans la locale courante) et
 * `alternates.languages` (une entrée par langue + "x-default") pour une
 * page publique indexable, à partir de son "href" interne next-intl (le
 * même argument que getPathname()/Link — un chemin fixe ou
 * `{ pathname, params }` pour une route dynamique).
 *
 * `x-default` pointe vers la langue par défaut du site
 * (routing.defaultLocale) — convention Google pour la version à proposer
 * quand aucune langue déclarée ne correspond au visiteur.
 */
export function buildLocaleAlternates(href: HrefArg, activeLocale: AppLocale) {
  const languages = Object.fromEntries(
    routing.locales.map((loc) => [loc, getPathname({ href, locale: loc })]),
  ) as Record<AppLocale, string>;

  return {
    canonical: languages[activeLocale],
    languages: {
      ...languages,
      "x-default": languages[routing.defaultLocale as AppLocale],
    },
  };
}
