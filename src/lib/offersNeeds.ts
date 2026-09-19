import type { AppLocale } from "@/i18n/routing";

/**
 * Compose un titre affichable/recherchable à partir des champs structurés,
 * plutôt que de demander à l'entreprise de le rédiger elle-même (voir
 * PROJECT_SPEC.md — le formulaire reste volontairement court).
 */
export function buildOfferNeedTitle({
  kind,
  locale,
  capabilityLabel,
  productLabel,
  targetCountryCode,
  targetRegion,
}: {
  kind: "offer" | "need";
  locale: AppLocale;
  capabilityLabel: string;
  productLabel?: string | null;
  targetCountryCode?: string | null;
  targetRegion?: string | null;
}): string {
  const place = targetRegion || targetCountryCode || null;
  const parts = [capabilityLabel, productLabel].filter(Boolean);
  let title = parts.join(" — ");
  if (place) {
    title += ` (${place})`;
  }
  if (kind === "need") {
    const prefix = locale === "en" ? "Looking for: " : "Recherche : ";
    return prefix + title;
  }
  return title;
}

/**
 * Même principe pour une opportunité : le formulaire de publication ne
 * demande pas de titre (voir PROJECT_SPEC.md §4.4bis), il est composé à
 * partir du type/de la direction/du produit/du marché.
 */
export function buildOpportunityTitle({
  locale,
  direction,
  capabilityLabel,
  productLabel,
  targetCountryCode,
  targetRegion,
}: {
  locale: AppLocale;
  direction: "seeking" | "offering";
  capabilityLabel: string;
  productLabel?: string | null;
  targetCountryCode?: string | null;
  targetRegion?: string | null;
}): string {
  const place = targetRegion || targetCountryCode || null;
  const parts = [capabilityLabel, productLabel].filter(Boolean);
  let title = parts.join(" — ");
  if (place) {
    title += ` (${place})`;
  }
  const prefix =
    direction === "seeking"
      ? locale === "en"
        ? "Looking for: "
        : "Recherche : "
      : locale === "en"
        ? "Offering: "
        : "Proposition : ";
  return prefix + title;
}
