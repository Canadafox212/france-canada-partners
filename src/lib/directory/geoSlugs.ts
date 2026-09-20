/**
 * Petit ensemble fixe d'URLs géographiques "propres" (§8 du cahier des
 * charges Phase 7) — volontairement PAS une table administrable ni générée
 * automatiquement à partir de toutes les combinaisons pays/région possibles
 * (voir §8 : "ne génère pas automatiquement des milliers de pages
 * indexables vides"). "quebec" est une RÉGION du Canada, pas un pays : sa
 * présence ici mélange donc délibérément deux granularités différentes,
 * exactement comme demandé par les exemples du cahier des charges
 * (/entreprises/france, /entreprises/canada, /entreprises/quebec).
 */
export type GeoSlugDefinition = {
  slug: string;
  countryCode: string;
  region?: string;
  labelFr: string;
  labelEn: string;
};

export const GEO_SLUGS: Record<string, GeoSlugDefinition> = {
  france: {
    slug: "france",
    countryCode: "FR",
    labelFr: "France",
    labelEn: "France",
  },
  canada: {
    slug: "canada",
    countryCode: "CA",
    labelFr: "Canada",
    labelEn: "Canada",
  },
  quebec: {
    slug: "quebec",
    countryCode: "CA",
    region: "Québec",
    labelFr: "Québec",
    labelEn: "Quebec",
  },
};

export function resolveGeoSlug(slug: string): GeoSlugDefinition | null {
  return GEO_SLUGS[slug.toLowerCase()] ?? null;
}
