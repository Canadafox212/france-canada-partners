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
    "/opportunites": { en: "/opportunities" },
    "/opportunites/[slug]": { en: "/opportunities/[slug]" },
    // Pas encore construite (voir PROJECT_SPEC.md §6, Phase 7+) : la page
    // d'accueil y renvoie déjà, on déclare donc son URL dès maintenant.
    "/entreprises": { en: "/companies" },
  },
});

export type AppLocale = (typeof routing.locales)[number];
