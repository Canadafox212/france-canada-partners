import { describe, expect, it, vi } from "vitest";

/**
 * Tests ciblés (bilinguisme, suite) pour `buildLocaleAlternates()` — la
 * source unique utilisée par toutes les pages publiques indexables pour
 * leur `alternates.canonical`/`alternates.languages`. Volontairement
 * indépendants de tout contenu éditorial précis (§3 de la demande) : seule
 * l'ORCHESTRATION (quelle locale donne quelle URL, x-default, structure
 * fr/en) est vérifiée ici.
 *
 * `@/i18n/navigation` (next-intl) importe `next/navigation`, non résoluble
 * en dehors du bundler Next.js — comme pour "server-only" dans les tests
 * d'intégration (voir tests/integration/server-only-stub.ts), on ne
 * réimplémente pas la résolution de chemin réelle ici : on la simule avec
 * un `getPathname` minimal et déterministe, fidèle au even mapping de
 * src/i18n/routing.ts pour les deux cas utilisés par l'application (chemin
 * fixe, chemin avec un ou plusieurs segments dynamiques). Le comportement
 * RÉEL de next-intl (chemins traduits comme /entreprises -> /companies)
 * est vérifié séparément, en conditions réelles, sur chaque type de page
 * (voir le rapport de vérification manuelle du lot).
 */
vi.mock("@/i18n/navigation", () => {
  const ROUTE_TRANSLATIONS: Record<string, string> = {
    "/entreprises": "/companies",
    "/opportunites": "/opportunities",
  };
  return {
    getPathname: ({
      href,
      locale,
    }: {
      href: string | { pathname: string; params?: Record<string, string> };
      locale: string;
    }) => {
      const pathname = typeof href === "string" ? href : href.pathname;
      const params = typeof href === "string" ? undefined : href.params;
      let localized = pathname;
      if (locale === "en") {
        for (const [fr, en] of Object.entries(ROUTE_TRANSLATIONS)) {
          localized = localized.replace(fr, en);
        }
      }
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          localized = localized.replace(`[${key}]`, value);
        }
      }
      return `/${locale}${localized}`;
    },
  };
});

const { buildLocaleAlternates } = await import("@/lib/seo/alternates");

describe("buildLocaleAlternates", () => {
  it("la canonical FR commence par /fr/", () => {
    const { canonical } = buildLocaleAlternates("/entreprises", "fr");
    expect(canonical.startsWith("/fr/")).toBe(true);
  });

  it("la canonical EN commence par /en/", () => {
    const { canonical } = buildLocaleAlternates("/entreprises", "en");
    expect(canonical.startsWith("/en/")).toBe(true);
  });

  it("une fiche entreprise FR pointe (en alternates) vers sa version EN, avec la route traduite", () => {
    const { languages } = buildLocaleAlternates(
      {
        pathname: "/entreprises/[geoOrSlug]",
        params: { geoOrSlug: "figeac-aero" },
      },
      "fr",
    );
    expect(languages.en).toBe("/en/companies/figeac-aero");
  });

  it("une fiche entreprise EN pointe (en alternates) vers sa version FR", () => {
    const { languages } = buildLocaleAlternates(
      {
        pathname: "/entreprises/[geoOrSlug]",
        params: { geoOrSlug: "figeac-aero" },
      },
      "en",
    );
    expect(languages.fr).toBe("/fr/entreprises/figeac-aero");
  });

  it("contient les alternates fr, en et x-default", () => {
    const { languages } = buildLocaleAlternates("/opportunites", "fr");
    expect(Object.keys(languages).sort()).toEqual(["en", "fr", "x-default"]);
  });

  it("x-default pointe vers la langue par défaut du site (fr)", () => {
    const { languages } = buildLocaleAlternates("/opportunites", "en");
    expect(languages["x-default"]).toBe(languages.fr);
  });

  it("la canonical correspond toujours à l'entrée alternates de la locale demandée", () => {
    const fr = buildLocaleAlternates("/entreprises", "fr");
    const en = buildLocaleAlternates("/entreprises", "en");
    expect(fr.canonical).toBe(fr.languages.fr);
    expect(en.canonical).toBe(en.languages.en);
  });

  it("fonctionne aussi pour une route à deux segments dynamiques (géo + secteur)", () => {
    const { canonical, languages } = buildLocaleAlternates(
      {
        pathname: "/entreprises/[geoOrSlug]/[industry]",
        params: { geoOrSlug: "canada", industry: "aeronautique-spatial" },
      },
      "en",
    );
    expect(canonical).toBe("/en/companies/canada/aeronautique-spatial");
    expect(languages.fr).toBe("/fr/entreprises/canada/aeronautique-spatial");
  });
});
