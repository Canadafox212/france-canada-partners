// Jeu de données de démonstration (Phase 4) — PAS un import réel.
//
// Sert à préparer des cas de test concrets pour la Phase 6 (matching) :
// deux entreprises dont l'offre de l'une correspond au besoin de l'autre,
// et réciproquement. Volontairement minimal (3 entreprises), à ne jamais
// confondre avec les 7 000 entreprises réelles de data/raw/ (non importées).
//
// Utilise la clé secrète (service_role) : contourne la RLS, comme le ferait
// un script d'administration. Exécution : npm run seed:demo
// Idempotent : si une entreprise du jeu de démonstration existe déjà
// (même slug), le script s'arrête sans rien dupliquer.

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

async function main() {
  const { data: existing } = await admin
    .from("companies")
    .select("id")
    .eq("slug", "metallerie-du-rhone")
    .maybeSingle();
  if (existing) {
    console.log(
      "Jeu de démonstration déjà présent (metallerie-du-rhone existe) — rien à faire.",
    );
    return;
  }

  console.log("Création des secteurs...");
  const [industryManufacturing] = await insert(
    "industries",
    [
      {
        name_fr: "Métallurgie et fabrication",
        name_en: "Manufacturing & Metalworking",
        slug: "metallurgie-fabrication",
      },
    ],
    { returning: "id" },
  );
  const [industryTech] = await insert(
    "industries",
    [
      {
        name_fr: "Technologies",
        name_en: "Technology",
        slug: "technologies-demo",
      },
    ],
    { returning: "id" },
  );

  console.log("Création des produits/services...");
  const [productMetalParts] = await insert(
    "products_services",
    [
      {
        type: "product",
        label_fr: "Composants métalliques",
        label_en: "Metal components",
        slug: "composants-metalliques",
      },
    ],
    { returning: "id" },
  );
  await insert("products_services", [
    {
      type: "product",
      label_fr: "Équipements de réfrigération industrielle",
      label_en: "Industrial refrigeration equipment",
      slug: "equipements-refrigeration-industrielle",
    },
  ]);
  const [serviceSoftware] = await insert(
    "products_services",
    [
      {
        type: "service",
        label_fr: "Services de développement logiciel",
        label_en: "Software development services",
        slug: "services-developpement-logiciel",
      },
    ],
    { returning: "id" },
  );

  console.log("Création de l'entreprise A (France, fabrication)...");
  const [companyA] = await insert(
    "companies",
    [
      {
        legal_name: "Métallerie du Rhône SAS",
        display_name: "Métallerie du Rhône",
        slug: "metallerie-du-rhone",
        country_code: "FR",
        professional_email: "contact@metallerie-du-rhone.example",
        status: "active",
      },
    ],
    { returning: "id" },
  );
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
        "Fabricant de composants métalliques de précision pour l'industrie, à la recherche de nouveaux débouchés commerciaux.",
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

  console.log("Création de l'entreprise B (Québec, distribution)...");
  const [companyB] = await insert(
    "companies",
    [
      {
        legal_name: "Distribution Nordique Inc.",
        display_name: "Distribution Nordique",
        slug: "distribution-nordique",
        country_code: "CA",
        professional_email: "contact@distribution-nordique.example",
        status: "active",
      },
    ],
    { returning: "id" },
  );
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
        "Distributeur établi au Québec, recherche des fabricants européens pour élargir son catalogue de produits industriels.",
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
    "Création de l'entreprise C (France, services technologiques)...",
  );
  const [companyC] = await insert(
    "companies",
    [
      {
        legal_name: "NovaTech Solutions SAS",
        display_name: "NovaTech Solutions",
        slug: "novatech-solutions",
        country_code: "FR",
        professional_email: "contact@novatech-solutions.example",
        status: "active",
      },
    ],
    { returning: "id" },
  );
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
        "Éditeur de solutions logicielles sur mesure pour l'industrie, propose ses services de développement aux entreprises en expansion.",
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
    "\n=== Jeu de démonstration créé : 3 entreprises, 3 offres, 2 besoins ===",
  );
  console.log(
    "Aucune n'a de propriétaire (owner) : elles restent à revendiquer (voir PROJECT_SPEC.md §12, Phase 7).",
  );
}

main().catch((err) => {
  console.error("Échec du seed :", err.message);
  process.exit(1);
});
