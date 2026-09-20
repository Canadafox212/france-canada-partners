import { Link } from "@/i18n/navigation";
import type { ComponentProps } from "react";

export type BreadcrumbItem = {
  label: string;
  href?: ComponentProps<typeof Link>["href"];
};

/**
 * Fil d'Ariane minimal (§9/§24/§37 du cahier des charges Phase 7) : le
 * dernier élément (page courante) n'est jamais un lien, marqué
 * aria-current pour les lecteurs d'écran.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="text-sm text-slate-500 dark:text-slate-400"
    >
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center gap-1"
            >
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="underline hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
