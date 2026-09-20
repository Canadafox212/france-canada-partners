import type { ActivationChecklistItem } from "@/lib/companies/completeness";

const ANCHOR_BY_ITEM: Record<ActivationChecklistItem["id"], string> = {
  profile: "#profile",
  productsServices: "#products-services",
  offer: "#offers",
  need: "#needs",
  markets: "#markets",
  viewPartners: "#partners",
};

/**
 * Checklist d'activation (Phase 10C, §2) — purement présentationnelle,
 * jamais bloquante : chaque étape pointe vers une section déjà existante
 * de la même page (ancres, pas de nouvelle route). Ne duplique aucun
 * formulaire, se contente de guider vers ceux qui existent déjà.
 */
export function ActivationChecklist({
  items,
  labels,
}: {
  items: ActivationChecklistItem[];
  labels: Record<ActivationChecklistItem["id"], string>;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={
              item.done
                ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs text-white"
                : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs text-transparent dark:border-slate-600"
            }
          >
            ✓
          </span>
          {item.done ? (
            <span className="text-sm text-slate-500 line-through dark:text-slate-400">
              {labels[item.id]}
            </span>
          ) : (
            <a
              href={ANCHOR_BY_ITEM[item.id]}
              className="text-sm text-slate-900 underline dark:text-white"
            >
              {labels[item.id]}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
