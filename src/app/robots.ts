import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";

/**
 * Interdit l'indexation des zones privées (compte, admin) — en complément
 * du `robots: {index:false}` posé page par page (§25/§26), pas à sa place :
 * un moteur de recherche respectueux évite de crawler ces sections du tout.
 *
 * Bug réel corrigé (audit bilingue) : "compte" est traduit en "account"
 * pour la locale anglaise (voir src/i18n/routing.ts) — le motif joker
 * précédent ne couvrait donc que le segment français, laissant les pages
 * "account" (anglais) indexables. "admin" n'a pas cette exception : seul
 * le sous-segment ("revendications"/"claims") est traduit, jamais "admin"
 * lui-même.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/*/compte", "/*/account", "/*/admin"],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
