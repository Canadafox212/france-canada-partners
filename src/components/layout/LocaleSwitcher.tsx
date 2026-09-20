"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

// Noms natifs, volontairement non traduits (convention courante pour un
// sélecteur de langue : "Français" reste "Français" même vu depuis la
// version anglaise, et inversement).
const NATIVE_NAMES: Record<AppLocale, string> = {
  fr: "Français",
  en: "English",
};

/**
 * Bascule de langue générique : fonctionne pour n'importe quelle route
 * définie dans src/i18n/routing.ts (statique ou dynamique), sans logique
 * par page. `usePathname()` (next-intl) résout déjà l'URL courante vers
 * son gabarit interne (ex. "/entreprises/[geoOrSlug]"), `useParams()`
 * (Next.js) fournit les valeurs de ses segments dynamiques, et les
 * paramètres de recherche courants sont conservés tels quels.
 *
 * Le typage strict de next-intl pour les chemins nommés exige un littéral
 * exact par route ; un composant générique ne peut pas le satisfaire
 * statiquement puisque le gabarit n'est connu qu'à l'exécution — d'où le
 * contournement de type ci-dessous, isolé à ce seul appel et vérifié
 * manuellement sur chaque type de page (annuaire, fiche entreprise, page
 * géographique, opportunités, authentification, compte).
 */
export function LocaleSwitcher() {
  const t = useTranslations("Header");
  const activeLocale = useLocale() as AppLocale;
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const query = Object.fromEntries(searchParams.entries());

  return (
    <nav
      aria-label={t("languageSwitcherLabel")}
      className="flex items-center gap-1.5 text-sm"
    >
      {routing.locales.map((code, index) => (
        <span key={code} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="text-slate-300 dark:text-slate-600"
            >
              /
            </span>
          ) : null}
          {code === activeLocale ? (
            <span
              lang={code}
              aria-current="true"
              className="font-medium text-slate-900 dark:text-white"
            >
              {NATIVE_NAMES[code]}
            </span>
          ) : (
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- voir la note ci-dessus sur le typage générique des chemins nommés
              href={{ pathname, params, query } as any}
              locale={code}
              lang={code}
              className="text-slate-500 hover:underline dark:text-slate-400"
            >
              {NATIVE_NAMES[code]}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
