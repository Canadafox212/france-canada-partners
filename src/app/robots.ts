import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";

/**
 * Interdit l'indexation des zones privées (compte, admin) — en complément
 * du `robots: {index:false}` posé page par page (§25/§26), pas à sa place :
 * un moteur de recherche respectueux évite de crawler ces sections du tout.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/*/compte", "/*/admin"],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
