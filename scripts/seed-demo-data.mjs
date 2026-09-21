// Jeu de données de démonstration (Phases 4-5) — PAS un import réel.
//
// Sert à préparer des cas de test concrets pour la Phase 6 (matching) :
// des entreprises dont l'offre de l'une correspond au besoin de l'autre, et
// quelques opportunités ponctuelles. Volontairement minimal (3 entreprises),
// à ne jamais confondre avec les 7 000 entreprises réelles de data/raw/ (non
// importées). Chaque entreprise de démonstration porte le préfixe "[DEMO]"
// dans son nom commercial pour rester clairement identifiable (voir
// PROJECT_SPEC.md §16, Phase 5).
//
// Utilise la clé secrète (service_role) : contourne la RLS, comme le ferait
// un script d'administration. Exécution : npm run seed:demo
// Idempotent : chaque section (entreprises, opportunités) vérifie
// séparément si elle a déjà été exécutée avant d'écrire quoi que ce soit.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(
  new URL("../.env.local", import.meta.url),
  "utf8",
).split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

async function insert(table, rows, { returning } = {}) {
  const query = admin.from(table).insert(rows);
  const { data, error } = returning
    ? await query.select(returning)
    : await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function findOrCreate(
  table,
  matchColumn,
  matchValue,
  row,
  { returning = "id" } = {},
) {
  const { data: existing } = await admin
    .from(table)
    .select(returning)
    .eq(matchColumn, matchValue)
    .maybeSingle();
  if (existing) return existing;
  const [created] = await insert(table, [row], { returning });
  return created;
}

async function seedCompanies() {
  const { data: existing } = await admin
    .from("companies")
    .select("id")
    .eq("slug", "metallerie-du-rhone")
    .maybeSingle();
  if (existing) {
    console.log("Entreprises de démonstration déjà présentes — rien à faire.");
    return;
  }

  console.log("Création des secteurs...");
  const industryManufacturing = await findOrCreate(
    "industries",
    "slug",
    "metallurgie-fabrication",
    {
      name_fr: "Métallurgie et fabrication",
      name_en: "Manufacturing & Metalworking",
      slug: "metallurgie-fabrication",
    },
  );
  const industryTech = await findOrCreate(
    "industries",
    "slug",
    "technologies-demo",
    {
      name_fr: "Technologies",
      name_en: "Technology",
      slug: "technologies-demo",
    },
  );

  console.log("Création des produits/services...");
  const productMetalParts = await findOrCreate(
    "products_services",
    "slug",
    "composants-metalliques",
    {
      type: "product",
      label_fr: "Composants métalliques",
      label_en: "Metal components",
      slug: "composants-metalliques",
    },
  );
  await findOrCreate(
    "products_services",
    "slug",
    "equipements-refrigeration-industrielle",
    {
      type: "product",
      label_fr: "Équipements de réfrigération industrielle",
      label_en: "Industrial refrigeration equipment",
      slug: "equipements-refrigeration-industrielle",
    },
  );
  const serviceSoftware = await findOrCreate(
    "products_services",
    "slug",
    "services-developpement-logiciel",
    {
      type: "service",
      label_fr: "Services de développement logiciel",
      label_en: "Software development services",
      slug: "services-developpement-logiciel",
    },
  );

  console.log("Création de l'entreprise A ([DEMO] France, fabrication)...");
  const [companyA] = await insert(
    "companies",
    [
      {
        legal_name: "Métallerie du Rhône SAS",
        display_name: "[DEMO] Métallerie du Rhône",
        slug: "metallerie-du-rhone",
        country_code: "FR",
        status: "active",
      },
    ],
    { returning: "id" },
  );
  // Phase 10C (LOT 10C-3) : professional_email vit désormais dans
  // company_contacts, jamais dans companies (colonne legacy contrainte à
  // NULL depuis la migration 0025).
  await insert("company_contacts", [
    {
      company_id: companyA.id,
      professional_email: "contact@metallerie-du-rhone.example",
    },
  ]);
  await insert("company_locations", [
    {
      company_id: companyA.id,
      location_type: "headquarters",
      is_primary: true,
      region: "Auvergne-Rhône-Alpes",
      city: "Lyon",
      country_code: "FR",
    },
  ]);
  await insert("company_industries", [
    {
      company_id: companyA.id,
      industry_id: industryManufacturing.id,
      is_primary: true,
    },
  ]);
  await insert("company_translations", [
    {
      company_id: companyA.id,
      locale: "fr",
      description:
        "[Entreprise de démonstration] Fabricant de composants métalliques de précision pour l'industrie, à la recherche de nouveaux débouchés commerciaux.",
    },
  ]);
  const [offerA] = await insert(
    "company_offers",
    [
      {
        company_id: companyA.id,
        capability_type_code: "MANUFACTURER",
        title: "Fabrication de composants métalliques",
        description:
          "Capacité de production disponible pour composants métalliques sur mesure.",
      },
    ],
    { returning: "id" },
  );
  await insert("company_offer_products_services", [
    { offer_id: offerA.id, product_service_id: productMetalParts.id },
  ]);
  const [needA] = await insert(
    "company_needs",
    [
      {
        company_id: companyA.id,
        capability_type_code: "DISTRIBUTOR",
        title: "Recherche distributeur au Québec",
        target_country_code: "CA",
        target_region: "Québec",
      },
    ],
    { returning: "id" },
  );
  await insert("company_need_products_services", [
    { need_id: needA.id, product_service_id: productMetalParts.id },
  ]);

  console.log("Création de l'entreprise B ([DEMO] Québec, distribution)...");
  const [companyB] = await insert(
    "companies",
    [
      {
        legal_name: "Distribution Nordique Inc.",
        display_name: "[DEMO] Distribution Nordique",
        slug: "distribution-nordique",
        country_code: "CA",
        status: "active",
      },
    ],
    { returning: "id" },
  );
  await insert("company_contacts", [
    {
      company_id: companyB.id,
      professional_email: "contact@distribution-nordique.example",
    },
  ]);
  await insert("company_locations", [
    {
      company_id: companyB.id,
      location_type: "headquarters",
      is_primary: true,
      region: "Québec",
      city: "Montréal",
      country_code: "CA",
    },
  ]);
  await insert("company_industries", [
    {
      company_id: companyB.id,
      industry_id: industryManufacturing.id,
      is_primary: true,
    },
  ]);
  await insert("company_translations", [
    {
      company_id: companyB.id,
      locale: "fr",
      description:
        "[Entreprise de démonstration] Distributeur établi au Québec, recherche des fabricants européens pour élargir son catalogue de produits industriels.",
    },
  ]);
  const [offerB] = await insert(
    "company_offers",
    [
      {
        company_id: companyB.id,
        capability_type_code: "DISTRIBUTOR",
        title: "Distribution au Québec",
        target_country_code: "CA",
      },
    ],
    { returning: "id" },
  );
  await insert("company_offer_products_services", [
    { offer_id: offerB.id, product_service_id: productMetalParts.id },
  ]);
  const [needB] = await insert(
    "company_needs",
    [
      {
        company_id: companyB.id,
        capability_type_code: "MANUFACTURER",
        title: "Recherche fabricants en France",
        target_country_code: "FR",
      },
    ],
    { returning: "id" },
  );
  await insert("company_need_products_services", [
    { need_id: needB.id, product_service_id: productMetalParts.id },
  ]);

  console.log(
    "Création de l'entreprise C ([DEMO] France, services technologiques)...",
  );
  const [companyC] = await insert(
    "companies",
    [
      {
        legal_name: "NovaTech Solutions SAS",
        display_name: "[DEMO] NovaTech Solutions",
        slug: "novatech-solutions",
        country_code: "FR",
        status: "active",
      },
    ],
    { returning: "id" },
  );
  await insert("company_contacts", [
    {
      company_id: companyC.id,
      professional_email: "contact@novatech-solutions.example",
    },
  ]);
  await insert("company_locations", [
    {
      company_id: companyC.id,
      location_type: "headquarters",
      is_primary: true,
      region: "Île-de-France",
      city: "Paris",
      country_code: "FR",
    },
  ]);
  await insert("company_industries", [
    { company_id: companyC.id, industry_id: industryTech.id, is_primary: true },
  ]);
  await insert("company_translations", [
    {
      company_id: companyC.id,
      locale: "fr",
      description:
        "[Entreprise de démonstration] Éditeur de solutions logicielles sur mesure pour l'industrie, propose ses services de développement aux entreprises en expansion.",
    },
  ]);
  const [offerC] = await insert(
    "company_offers",
    [
      {
        company_id: companyC.id,
        capability_type_code: "SERVICES",
        title: "Services de développement logiciel",
      },
    ],
    { returning: "id" },
  );
  await insert("company_offer_products_services", [
    { offer_id: offerC.id, product_service_id: serviceSoftware.id },
  ]);

  console.log(
    "\n=== Entreprises de démonstration créées : 3 entreprises, 3 offres, 2 besoins ===",
  );
  console.log(
    "Aucune n'a de propriétaire (owner) : elles restent à revendiquer (voir PROJECT_SPEC.md §12, Phase 7).",
  );
}

/**
 * Ajouté en Phase 6 : un besoin volontairement moins précis pour NovaTech
 * (pas de produit commun avec l'offre de A, secteur différent), qui
 * s'appuie sur la compatibilité CROISÉE SUBCONTRACTOR↔MANUFACTURER (ratio
 * 0,6) plutôt qu'une correspondance de type parfaite — sert d'exemple de
 * correspondance MOYENNE (voir §33 du cahier des charges Phase 6 /
 * docs/MATCHING.md), en plus de la correspondance FORTE déjà démontrée
 * par A↔B. Fonction séparée (idempotence propre) car `seedCompanies()`
 * s'arrête tôt si les entreprises de démonstration existent déjà.
 */
async function seedMediumMatchNeed() {
  const { data: companyC } = await admin
    .from("companies")
    .select("id")
    .eq("slug", "novatech-solutions")
    .maybeSingle();
  if (!companyC) {
    console.log(
      "NovaTech Solutions introuvable — seedCompanies() doit être exécuté avant.",
    );
    return;
  }
  const { data: existing } = await admin
    .from("company_needs")
    .select("id")
    .eq("company_id", companyC.id)
    .eq("capability_type_code", "SUBCONTRACTOR")
    .maybeSingle();
  if (existing) {
    console.log(
      "Besoin de démonstration (correspondance moyenne) déjà présent — rien à faire.",
    );
    return;
  }
  const industryTech = await findOrCreate(
    "industries",
    "slug",
    "technologies-demo",
    {
      name_fr: "Technologies",
      name_en: "Technology",
      slug: "technologies-demo",
    },
  );
  await insert("company_needs", [
    {
      company_id: companyC.id,
      capability_type_code: "SUBCONTRACTOR",
      title: "Recherche sous-traitant industriel en France",
      industry_id: industryTech.id,
      target_country_code: "FR",
    },
  ]);
  console.log(
    "Besoin de démonstration (correspondance moyenne) ajouté pour NovaTech.",
  );
}

async function seedOpportunities() {
  const { data: companyA } = await admin
    .from("companies")
    .select("id, country_code")
    .eq("slug", "metallerie-du-rhone")
    .maybeSingle();
  const { data: companyB } = await admin
    .from("companies")
    .select("id, country_code")
    .eq("slug", "distribution-nordique")
    .maybeSingle();
  const { data: companyC } = await admin
    .from("companies")
    .select("id, country_code")
    .eq("slug", "novatech-solutions")
    .maybeSingle();
  if (!companyA || !companyB || !companyC) {
    console.log(
      "Entreprises de démonstration introuvables — exécutez d'abord la création des entreprises.",
    );
    return;
  }

  const { data: existingOpp } = await admin
    .from("opportunities")
    .select("id")
    .eq("company_id", companyA.id)
    .limit(1)
    .maybeSingle();
  if (existingOpp) {
    console.log("Opportunités de démonstration déjà présentes — rien à faire.");
    return;
  }

  console.log("Création du secteur et produit agroalimentaire...");
  const industryFood = await findOrCreate(
    "industries",
    "slug",
    "agroalimentaire-demo",
    {
      name_fr: "Agroalimentaire",
      name_en: "Food & Beverage",
      slug: "agroalimentaire-demo",
    },
  );
  const productFood = await findOrCreate(
    "products_services",
    "slug",
    "produits-alimentaires-specialises",
    {
      type: "product",
      label_fr: "Produits alimentaires spécialisés",
      label_en: "Specialized food products",
      slug: "produits-alimentaires-specialises",
    },
  );
  const { data: productRefrigeration } = await admin
    .from("products_services")
    .select("id")
    .eq("slug", "equipements-refrigeration-industrielle")
    .single();

  const deadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  console.log(
    "Publication de l'opportunité A ([DEMO] recherche distributeur, équipements industriels)...",
  );
  const [oppA] = await insert(
    "opportunities",
    [
      {
        company_id: companyA.id,
        title:
          "[DEMO] Recherche distributeur au Québec pour équipements industriels",
        description:
          "[Opportunité de démonstration] Nous recherchons avant le " +
          deadline +
          " un distributeur québécois pour lancer une nouvelle gamme d'équipements de réfrigération industrielle.",
        capability_type_code: "DISTRIBUTOR",
        direction: "seeking",
        origin_country_code: companyA.country_code,
        target_country_code: "CA",
        target_region: "Québec",
        language_code: "fr",
        deadline,
        status: "published",
      },
    ],
    { returning: "id" },
  );
  await insert("opportunity_products_services", [
    { opportunity_id: oppA.id, product_service_id: productRefrigeration.id },
  ]);

  console.log(
    "Publication de l'opportunité B ([DEMO] recherche fabricant, produits alimentaires)...",
  );
  const [oppB] = await insert(
    "opportunities",
    [
      {
        company_id: companyB.id,
        title:
          "[DEMO] Recherche fabricant français de produits alimentaires spécialisés",
        description:
          "[Opportunité de démonstration] Nous recherchons un fabricant français de produits alimentaires spécialisés pour élargir notre offre au Québec.",
        capability_type_code: "MANUFACTURER",
        direction: "seeking",
        industry_id: industryFood.id,
        origin_country_code: companyB.country_code,
        target_country_code: "FR",
        language_code: "fr",
        status: "published",
      },
    ],
    { returning: "id" },
  );
  await insert("opportunity_products_services", [
    { opportunity_id: oppB.id, product_service_id: productFood.id },
  ]);

  console.log(
    "Publication de l'opportunité C ([DEMO] capacité de sous-traitance)...",
  );
  await insert("opportunities", [
    {
      company_id: companyC.id,
      title:
        "[DEMO] Capacité de sous-traitance disponible pour le marché canadien",
      description:
        "[Opportunité de démonstration] Capacité de sous-traitance en développement logiciel disponible pour des clients canadiens.",
      capability_type_code: "SUBCONTRACTOR",
      direction: "offering",
      origin_country_code: companyC.country_code,
      target_country_code: "CA",
      language_code: "fr",
      status: "published",
    },
  ]);

  console.log("\n=== 3 opportunités de démonstration publiées ===");
}

async function main() {
  await seedCompanies();
  await seedMediumMatchNeed();
  await seedOpportunities();
}

main().catch((err) => {
  console.error("Échec du seed :", err.message);
  process.exit(1);
});
