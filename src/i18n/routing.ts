import { defineRouting } from "next-intl/routing";

/**
 * Langues supportées au lancement : français (par défaut) et anglais.
 * Ajouter une langue plus tard = ajouter son code ici + son fichier
 * messages/<code>.json — voir PROJECT_SPEC.md §11.
 */
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "always",
  // Segments d'URL traduits : la clé est le chemin "canonique" (utilisé
  // dans le code et le système de fichiers sous src/app/[locale]/), la
  // valeur est le chemin affiché pour une langue donnée. Le français
  // (langue par défaut) n'a pas besoin d'être répété : il reprend la clé.
  pathnames: {
    "/": "/",
    "/connexion": { en: "/login" },
    "/inscription": { en: "/signup" },
    "/mot-de-passe-oublie": { en: "/forgot-password" },
    "/reinitialiser-mot-de-passe": { en: "/reset-password" },
    "/compte": { en: "/account" },
    "/compte/entreprises/nouvelle": { en: "/account/companies/new" },
    "/compte/entreprises/[id]": { en: "/account/companies/[id]" },
    "/compte/entreprises/[id]/opportunites/nouvelle": {
      en: "/account/companies/[id]/opportunities/new",
    },
    "/compte/entreprises/[id]/opportunites/[opportunityId]": {
      en: "/account/companies/[id]/opportunities/[opportunityId]",
    },
    "/compte/mises-en-relation": { en: "/account/partnership-requests" },
    "/compte/mises-en-relation/[id]": {
      en: "/account/partnership-requests/[id]",
    },
    "/compte/notifications": { en: "/account/notifications" },
    "/opportunites": { en: "/opportunities" },
    "/opportunites/[slug]": { en: "/opportunities/[slug]" },
    // Annuaire public (Phase 7). Next.js interdit deux noms de segment
    // dynamique différents à la même profondeur ("/entreprises/[slug]" et
    // "/entreprises/[geo]" ne peuvent pas coexister) : un seul segment
    // "[geoOrSlug]" sert donc à la fois de fiche entreprise (slug non
    // reconnu comme zone géographique) et d'entrée géographique (slug
    // reconnu, voir src/lib/directory/geoSlugs.ts) — désambiguïsation faite
    // dans la page elle-même, pas dans le routage. Pas de traduction du
    // segment secteur (§8 : même identifiant technique quelle que soit la
    // langue, comme pour les slugs d'entreprise/opportunité).
    "/entreprises": { en: "/companies" },
    "/entreprises/[geoOrSlug]": { en: "/companies/[geoOrSlug]" },
    "/entreprises/[geoOrSlug]/[industry]": {
      en: "/companies/[geoOrSlug]/[industry]",
    },
    "/admin/revendications": { en: "/admin/claims" },
    // Page de recrutement dédiée au Québec (Phase 10C) — même segment dans
    // les deux langues, comme "/" (rien à traduire ici).
    "/quebec": "/quebec",
  },
});

export type AppLocale = (typeof routing.locales)[number];
