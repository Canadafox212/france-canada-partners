import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 8, suite) pour la migration
 * 0021_industry_mapping_and_content_source.sql :
 * - `industry_code_mappings` (correspondance code APE/NAF -> secteur interne,
 *   jamais un rapprochement par mot-clé, jamais de mapping global pour un
 *   code trop générique — voir docs/DATA_MAPPING.md §4) ;
 * - `company_industries.classification_source` (COMPANY_DECLARED par défaut /
 *   CODE_MAPPING / EDITORIAL_VERIFIED — distingue un secteur déduit
 *   automatiquement d'une classification éditoriale vérifiée propre à une
 *   entreprise, voir docs/EDITORIAL_CONTENT.md §4) ;
 * - `company_translations.content_source` (provenance du contenu :
 *   COMPANY_PROVIDED / EDITORIAL / SOURCE_PROVIDED, jamais confondue).
 *
 * Complète la validation locale pglite (qui ne peut pas vérifier la RLS
 * réelle car les requêtes y passent toutes par le rôle propriétaire des
 * tables).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient(): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(label: string) {
  const email = `test-phase8b-${RUN_ID}-${label}@example.com`;
  const password = "MotDePasseTest123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error("Création utilisateur échouée");
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, client };
}

let platformAdmin: Awaited<ReturnType<typeof createConfirmedUser>>;
let regularUser: Awaited<ReturnType<typeof createConfirmedUser>>;
let testCompanyId: string;
const createdUserIds: string[] = [];

beforeAll(async () => {
  [platformAdmin, regularUser] = await Promise.all([
    createConfirmedUser("admin"),
    createConfirmedUser("user"),
  ]);
  createdUserIds.push(platformAdmin.id, regularUser.id);
  await admin
    .from("profiles")
    .update({ platform_role: "admin" })
    .eq("id", platformAdmin.id);

  const { data: company } = await admin
    .from("companies")
    .insert({
      legal_name: `Entreprise Test Secteur ${RUN_ID}`,
      display_name: `Entreprise Test Secteur ${RUN_ID}`,
      slug: `entreprise-test-secteur-${RUN_ID}`,
      country_code: "FR",
      status: "active",
    })
    .select("id")
    .single();
  testCompanyId = company!.id;
}, 60000);

afterAll(async () => {
  await admin.from("companies").delete().eq("id", testCompanyId);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("industry_code_mappings — correspondances du lot pilote (migration 0021)", () => {
  it("contient les 8 codes APE réellement présents dans le lot pilote, avec confiance explicite", async () => {
    const { data } = await admin
      .from("industry_code_mappings")
      .select("code, confidence, internal_industry_id")
      .eq("scheme", "NAF_APE")
      .in("code", [
        "25.62B",
        "30.30Z",
        "26.11Z",
        "22.19Z",
        "28.30Z",
        "26.70Z",
        "71.12B",
        "70.10Z",
      ]);
    expect(data).toHaveLength(8);
  });

  it("ne devine jamais de secteur pour un code administratif ambigu (70.10Z)", async () => {
    const { data } = await admin
      .from("industry_code_mappings")
      .select("confidence, internal_industry_id")
      .eq("scheme", "NAF_APE")
      .eq("code", "70.10Z")
      .single();
    expect(data!.confidence).toBe("REQUIRES_REVIEW");
    expect(data!.internal_industry_id).toBeNull();
  });

  it("un doublon (scheme, code) est rejeté", async () => {
    const { error } = await admin
      .from("industry_code_mappings")
      .insert({ scheme: "NAF_APE", code: "25.62B", confidence: "HIGH" });
    expect(error).not.toBeNull();
  });

  it("la lecture est publique (visiteur non authentifié)", async () => {
    const anon = anonClient();
    const { data, error } = await anon
      .from("industry_code_mappings")
      .select("code")
      .limit(1);
    expect(error).toBeNull();
    expect(data ?? []).not.toEqual([]);
  });

  it("un utilisateur normal ne peut pas écrire", async () => {
    const { error } = await regularUser.client
      .from("industry_code_mappings")
      .insert({ scheme: "NAF_APE", code: `TEST_${RUN_ID}`, confidence: "LOW" });
    expect(error).not.toBeNull();
  });

  it("un administrateur peut écrire", async () => {
    const { data, error } = await platformAdmin.client
      .from("industry_code_mappings")
      .insert({ scheme: "NAF_APE", code: `TEST_${RUN_ID}`, confidence: "LOW" })
      .select("id")
      .single();
    expect(error).toBeNull();
    await admin.from("industry_code_mappings").delete().eq("id", data!.id);
  });
});

describe("company_translations.content_source — provenance du contenu (migration 0021)", () => {
  it("vaut COMPANY_PROVIDED par défaut", async () => {
    const { data, error } = await admin
      .from("company_translations")
      .insert({
        company_id: testCompanyId,
        locale: "fr",
        description: "Texte saisi par l'entreprise",
      })
      .select("content_source")
      .single();
    expect(error).toBeNull();
    expect(data!.content_source).toBe("COMPANY_PROVIDED");
  });

  it("accepte EDITORIAL pour un contenu rédigé par la plateforme", async () => {
    const { data, error } = await admin
      .from("company_translations")
      .insert({
        company_id: testCompanyId,
        locale: "en",
        description: "Editorial text based on verifiable facts",
        content_source: "EDITORIAL",
      })
      .select("content_source")
      .single();
    expect(error).toBeNull();
    expect(data!.content_source).toBe("EDITORIAL");
  });

  it("refuse une valeur hors énumération", async () => {
    const { error } = await admin
      .from("company_translations")
      .update({ content_source: "INVENTED" })
      .eq("company_id", testCompanyId)
      .eq("locale", "fr");
    expect(error).not.toBeNull();
  });
});

describe("company_industries.classification_source — mapping automatique vs classification éditoriale vérifiée (migration 0021)", () => {
  let industryId: string;
  let codeMappingId: string;

  beforeAll(async () => {
    const { data: industry } = await admin
      .from("industries")
      .select("id")
      .eq("slug", "aeronautique-spatial")
      .single();
    industryId = industry!.id;
    const { data: mapping } = await admin
      .from("industry_code_mappings")
      .select("id")
      .eq("scheme", "NAF_APE")
      .eq("code", "25.62B")
      .single();
    codeMappingId = mapping!.id;
  });

  afterAll(async () => {
    await admin
      .from("company_industries")
      .delete()
      .eq("company_id", testCompanyId);
  });

  it("vaut COMPANY_DECLARED par défaut (comportement Phase 3 inchangé)", async () => {
    const { data, error } = await admin
      .from("company_industries")
      .insert({ company_id: testCompanyId, industry_id: industryId })
      .select("classification_source, source_code_mapping_id")
      .single();
    expect(error).toBeNull();
    expect(data!.classification_source).toBe("COMPANY_DECLARED");
    expect(data!.source_code_mapping_id).toBeNull();
    await admin
      .from("company_industries")
      .delete()
      .eq("company_id", testCompanyId)
      .eq("industry_id", industryId);
  });

  it("refuse CODE_MAPPING sans source_code_mapping_id", async () => {
    const { error } = await admin
      .from("company_industries")
      .insert({
        company_id: testCompanyId,
        industry_id: industryId,
        classification_source: "CODE_MAPPING",
      });
    expect(error).not.toBeNull();
  });

  it("refuse EDITORIAL_VERIFIED avec source_code_mapping_id renseigné", async () => {
    const { error } = await admin
      .from("company_industries")
      .insert({
        company_id: testCompanyId,
        industry_id: industryId,
        classification_source: "EDITORIAL_VERIFIED",
        source_code_mapping_id: codeMappingId,
      });
    expect(error).not.toBeNull();
  });

  it("accepte EDITORIAL_VERIFIED sans code — cas SAFRAN : secteur propre à l'entreprise, jamais déduit de 70.10Z", async () => {
    const { data, error } = await admin
      .from("company_industries")
      .insert({
        company_id: testCompanyId,
        industry_id: industryId,
        classification_source: "EDITORIAL_VERIFIED",
        notes: "Test : sources officielles de l'entreprise, jamais le code APE seul",
      })
      .select("classification_source, source_code_mapping_id")
      .single();
    expect(error).toBeNull();
    expect(data!.classification_source).toBe("EDITORIAL_VERIFIED");
    expect(data!.source_code_mapping_id).toBeNull();
  });
});

describe("Préparation à la publication d'une fiche importée (§18, sans publier les 13 réelles)", () => {
  // Reproduit la forme d'une entreprise importée (voir migration 0020) sur
  // une entreprise JETABLE dédiée au test — jamais une des 13 du lot
  // FRANCE_PILOT_001, qui restent non publiées tant que l'autorisation
  // explicite n'a pas été donnée.
  let importedShapedCompanyId: string;

  beforeAll(async () => {
    const { data } = await admin
      .from("companies")
      .insert({
        legal_name: `Entreprise Importee Test ${RUN_ID}`,
        display_name: `Entreprise Importee Test ${RUN_ID}`,
        slug: `entreprise-importee-test-${RUN_ID}`,
        country_code: "FR",
        status: "draft",
      })
      .select("id")
      .single();
    importedShapedCompanyId = data!.id;
  });

  afterAll(async () => {
    await admin.from("companies").delete().eq("id", importedShapedCompanyId);
  });

  it("reste invisible tant qu'elle est en statut draft (visiteur anonyme)", async () => {
    const anon = anonClient();
    const { data } = await anon
      .from("companies")
      .select("id")
      .eq("id", importedShapedCompanyId);
    expect(data ?? []).toEqual([]);
  });

  it("n'a aucune offre ni besoin — jamais inféré depuis le code APE", async () => {
    const { data: offers } = await admin
      .from("company_offers")
      .select("id")
      .eq("company_id", importedShapedCompanyId);
    const { data: needs } = await admin
      .from("company_needs")
      .select("id")
      .eq("company_id", importedShapedCompanyId);
    expect(offers ?? []).toEqual([]);
    expect(needs ?? []).toEqual([]);
  });

  it("devient visible pour un visiteur anonyme une fois passée en statut active (mécanisme déjà existant, Phase 2/7)", async () => {
    await admin
      .from("companies")
      .update({ status: "active" })
      .eq("id", importedShapedCompanyId);
    const anon = anonClient();
    const { data } = await anon
      .from("companies")
      .select("id, status")
      .eq("id", importedShapedCompanyId)
      .maybeSingle();
    expect(data?.status).toBe("active");
  });

  it("reste non revendiquée après publication (claimed_at toujours nul)", async () => {
    const { data } = await admin
      .from("companies")
      .select("claimed_at")
      .eq("id", importedShapedCompanyId)
      .single();
    expect(data!.claimed_at).toBeNull();
  });
});
