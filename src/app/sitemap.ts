import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/env";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { GEO_SLUGS } from "@/lib/directory/geoSlugs";

/**
 * Sitemap (§26 du cahier des charges Phase 7). N'inclut JAMAIS : brouillons,
 * entreprises suspendues/archivées, pages privées (compte, revendications,
 * admin), matchs. Une seule liste pour l'instant (voir Next.js
 * generateSitemaps() si le volume dépasse plusieurs dizaines de milliers
 * d'URLs après l'import massif de la Phase 10 — non nécessaire tant que le
 * volume réel ne le justifie pas).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const supabase = await createClient();

  const [{ data: companies }, { data: opportunities }] = await Promise.all([
    supabase
      .from("companies")
      .select("slug, updated_at")
      .eq("status", "active"),
    supabase
      .from("opportunities")
      .select("slug, published_at")
      .eq("status", "published")
      .gt("expires_at", new Date().toISOString()),
  ]);

  const entries: MetadataRoute.Sitemap = [];

  function addForEachLocale(
    hrefKey: Parameters<typeof getPathname>[0]["href"],
    lastModified?: string | Date,
  ) {
    for (const loc of routing.locales) {
      entries.push({
        url: `${siteUrl}${getPathname({ href: hrefKey, locale: loc })}`,
        lastModified,
      });
    }
  }

  addForEachLocale("/");
  addForEachLocale("/entreprises");
  addForEachLocale("/opportunites");

  for (const geoSlug of Object.keys(GEO_SLUGS)) {
    addForEachLocale({
      pathname: "/entreprises/[geoOrSlug]",
      params: { geoOrSlug: geoSlug },
    });
  }

  for (const company of companies ?? []) {
    if (!company.slug) continue;
    addForEachLocale(
      {
        pathname: "/entreprises/[geoOrSlug]",
        params: { geoOrSlug: company.slug },
      },
      company.updated_at ?? undefined,
    );
  }

  for (const opportunity of opportunities ?? []) {
    if (!opportunity.slug) continue;
    addForEachLocale(
      { pathname: "/opportunites/[slug]", params: { slug: opportunity.slug } },
      opportunity.published_at ?? undefined,
    );
  }

  return entries;
}
