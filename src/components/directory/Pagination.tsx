/**
 * Pagination simple (§7 du cahier des charges Phase 7) : conserve tous les
 * paramètres de recherche/filtres dans l'URL (partageable, rafraîchissable,
 * indexable). `basePath` est déjà résolu par la page appelante (avec son
 * préfixe de langue et ses segments géographiques éventuels) : un lien HTML
 * simple suffit, pas besoin du composant Link conscient de la langue ici
 * puisqu'on reste sur la même page traduite. Composant serveur pur (aucune
 * interactivité) : les libellés traduits sont passés en props plutôt que
 * d'appeler useTranslations (réservé aux Client Components ici).
 */
export function Pagination({
  basePath,
  searchParams,
  page,
  hasNextPage,
  labels,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  page: number;
  hasNextPage: boolean;
  labels: { prev: string; next: string };
}) {
  function hrefForPage(targetPage: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page" || !value) continue;
      params.set(key, value);
    }
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  if (page === 1 && !hasNextPage) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 pt-2"
    >
      {page > 1 ? (
        <a
          href={hrefForPage(page - 1)}
          className="text-sm underline text-slate-700 dark:text-slate-200"
        >
          {labels.prev}
        </a>
      ) : (
        <span />
      )}
      {hasNextPage ? (
        <a
          href={hrefForPage(page + 1)}
          className="text-sm underline text-slate-700 dark:text-slate-200"
        >
          {labels.next}
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
