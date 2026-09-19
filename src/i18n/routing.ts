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
});

export type AppLocale = (typeof routing.locales)[number];
