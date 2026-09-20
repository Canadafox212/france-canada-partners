import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Mémoïsé (voir pageData.ts pour la même raison) : generateMetadata() et le
 * composant de page ont tous deux besoin de la fiche entreprise. Un seul
 * argument primitif (le slug) — la mémoïsation de React.cache() fonctionne
 * correctement ici sans précaution particulière.
 */
export const loadCompanyBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  // Chaîne de sélection en un seul littéral (template literal, sans
  // interpolation) : une concaténation par "+" élargirait son type en
  // `string` générique côté TypeScript, et supabase-js perdrait alors le
  // typage précis qu'il déduit normalement de la chaîne littérale exacte
  // passée à .select() — d'où ce bloc figé plutôt que plusieurs morceaux.
  const { data } = await supabase
    .from("companies")
    .select(
      `id, legal_name, display_name, slug, website, professional_email, phone, country_code,
       verification_status, status, claimed_at, updated_at,
       company_locations(id, region, city, country_code, is_primary),
       company_translations(locale, description, tagline),
       company_industries(is_primary, industries(id, name_fr, name_en, slug)),
       company_products_services(description, products_services(id, label_fr, label_en)),
       company_languages(languages(code, name_fr, name_en)),
       company_certifications(issuer, valid_until, verification_status, certifications(name)),
       company_source_records(source_date, last_verified_at, data_sources(name))`,
    )
    .eq("slug", slug)
    .maybeSingle();
  return data;
});
