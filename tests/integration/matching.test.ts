import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getPartnersForCompany,
  getCompaniesForOpportunity,
  getCompatibilityBetweenCompanies,
} from "@/lib/matching/service";

/**
 * Tests d'intégration réels (Phase 6) pour le moteur de matching : mêmes
 * principes que les suites précédentes (vrai projet Supabase, aucun mock,
 * nettoyage systématique). Couvre à la fois la cohérence métier (§34) et
 * la sécurité (§35) — notamment ce que pglite (validation locale) ne peut
 * PAS vérifier : l'application réelle de la RLS sur matches/opportunity_matches.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
const testEmail = (label: string) =>
  `test-phase6-${RUN_ID}-${label}@example.com`;
const TEST_PASSWORD = "MotDePasseTest123!";

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient(): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(label: string) {
  const email = testEmail(label);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error("Création utilisateur échouée");
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

let ownerA: Awaited<ReturnType<typeof createConfirmedUser>>;
let ownerB: Awaited<ReturnType<typeof createConfirmedUser>>;
let ownerThird: Awaited<ReturnType<typeof createConfirmedUser>>;
let platformAdmin: Awaited<ReturnType<typeof createConfirmedUser>>;

let companyAId: string; // FR — a un besoin DISTRIBUTOR (CA/Québec)
let companyBId: string; // CA — a une offre DISTRIBUTOR compatible
let companyIncompatibleId: string; // offre INVESTOR (incompatibilité fondamentale)
let companyInactiveId: string; // offre DISTRIBUTOR mais INACTIVE

let needAId: string;
let opportunitySeekingId: string;
let opportunityExpiredId: string;

async function createCompany(
  owner: Awaited<ReturnType<typeof createConfirmedUser>>,
  label: string,
  countryCode: string,
) {
  const { data } = await owner.client
    .rpc("create_company", {
      p_legal_name: `${label} ${RUN_ID}`,
      p_display_name: `${label} ${RUN_ID}`,
      p_slug: `${label.toLowerCase().replace(/\s+/g, "-")}-${RUN_ID}`,
      p_country_code: countryCode,
    })
    .single();
  const id = (data as { id: string }).id;
  createdCompanyIds.push(id);
  await admin.from("companies").update({ status: "active" }).eq("id", id);
  return id;
}

beforeAll(async () => {
  [ownerA, ownerB, ownerThird, platformAdmin] = await Promise.all([
    createConfirmedUser("owner-a"),
    createConfirmedUser("owner-b"),
    createConfirmedUser("owner-third"),
    createConfirmedUser("admin"),
  ]);
  createdUserIds.push(ownerA.id, ownerB.id, ownerThird.id, platformAdmin.id);
  await admin
    .from("profiles")
    .update({ platform_role: "admin" })
    .eq("id", platformAdmin.id);

  [companyAId, companyBId, companyIncompatibleId, companyInactiveId] =
    await Promise.all([
      createCompany(ownerA, "Match Entreprise A", "FR"),
      createCompany(ownerB, "Match Entreprise B", "CA"),
      createCompany(ownerB, "Match Entreprise Incompatible", "CA"),
      createCompany(ownerB, "Match Entreprise Inactive", "CA"),
      createCompany(ownerThird, "Match Entreprise Tiers", "FR"),
    ]);

  const { data: need } = await ownerA.client
    .from("company_needs")
    .insert({
      company_id: companyAId,
      capability_type_code: "DISTRIBUTOR",
      target_country_code: "CA",
      target_region: "Québec",
    })
    .select("id")
    .single();
  needAId = (need as { id: string }).id;

  await ownerB.client.from("company_offers").insert({
    company_id: companyBId,
    capability_type_code: "DISTRIBUTOR",
    target_country_code: "CA",
  });

  await ownerB.client.from("company_offers").insert({
    company_id: companyIncompatibleId,
    capability_type_code: "INVESTOR",
  });

  const { data: inactiveOffer } = await ownerB.client
    .from("company_offers")
    .insert({
      company_id: companyInactiveId,
      capability_type_code: "DISTRIBUTOR",
    })
    .select("id")
    .single();
  await admin
    .from("company_offers")
    .update({ status: "inactive" })
    .eq("id", (inactiveOffer as { id: string }).id);

  const { data: opp } = await ownerA.client
    .from("opportunities")
    .insert({
      company_id: companyAId,
      title: "Recherche distributeur test",
      capability_type_code: "DISTRIBUTOR",
      direction: "seeking",
      origin_country_code: "FR",
      language_code: "fr",
      status: "published",
    })
    .select("id")
    .single();
  opportunitySeekingId = (opp as { id: string }).id;

  const { data: expiredOpp } = await ownerA.client
    .from("opportunities")
    .insert({
      company_id: companyAId,
      title: "Opportunité expirée test",
      capability_type_code: "DISTRIBUTOR",
      direction: "seeking",
      origin_country_code: "FR",
      language_code: "fr",
      status: "published",
    })
    .select("id")
    .single();
  opportunityExpiredId = (expiredOpp as { id: string }).id;
  // status reste 'published' délibérément : §40 exige que l'expiration
  // seule (expires_at < now()) suffise à exclure, sans recalcul de statut.
  await admin
    .from("opportunities")
    .update({ expires_at: new Date(Date.now() - 86400000).toISOString() })
    .eq("id", opportunityExpiredId);
}, 60000);

afterAll(async () => {
  for (const id of createdCompanyIds) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("Cohérence métier (§34)", () => {
  it("propose un candidat compatible avec un score cohérent", async () => {
    const partners = await getPartnersForCompany(ownerA.client, companyAId);
    const match = partners.find((p) => p.companyId === companyBId);
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThanOrEqual(60);
  });

  it("exclut totalement un candidat fondamentalement incompatible (pas de score, pas de proposition)", async () => {
    const partners = await getPartnersForCompany(ownerA.client, companyAId);
    expect(partners.some((p) => p.companyId === companyIncompatibleId)).toBe(
      false,
    );
  });

  it("exclut une offre inactive", async () => {
    const partners = await getPartnersForCompany(ownerA.client, companyAId);
    expect(partners.some((p) => p.companyId === companyInactiveId)).toBe(false);
  });

  it("n'inclut jamais l'entreprise elle-même comme candidate", async () => {
    const partners = await getPartnersForCompany(ownerA.client, companyAId);
    expect(partners.some((p) => p.companyId === companyAId)).toBe(false);
  });

  it("exclut une opportunité expirée même si son statut affiche encore 'published' (§40)", async () => {
    const companies = await getCompaniesForOpportunity(
      ownerA.client,
      opportunityExpiredId,
    );
    expect(companies).toEqual([]);
  });

  it("persiste le match avec la version de l'algorithme et un score détaillé", async () => {
    await getPartnersForCompany(ownerA.client, companyAId);
    const { data } = await admin
      .from("matches")
      .select("score, confidence, algorithm_version, score_breakdown")
      .eq("need_id", needAId)
      .eq("candidate_company_id", companyBId)
      .maybeSingle();
    expect(data).toBeDefined();
    expect(data!.algorithm_version).toBe("MATCH_V1");
    expect(Array.isArray(data!.score_breakdown)).toBe(true);
  });
});

describe("Sécurité — visibilité des matchs (§35)", () => {
  beforeAll(async () => {
    // S'assure qu'un match persiste avant les tests de lecture directe.
    await getPartnersForCompany(ownerA.client, companyAId);
    await getCompaniesForOpportunity(ownerA.client, opportunitySeekingId);
  });

  it("l'entreprise A (côté besoin) voit le match", async () => {
    const { data } = await ownerA.client
      .from("matches")
      .select("id")
      .eq("need_id", needAId)
      .eq("candidate_company_id", companyBId);
    expect(data && data.length).toBeGreaterThan(0);
  });

  it("l'entreprise B (côté offre candidate) voit aussi le match", async () => {
    const { data } = await ownerB.client
      .from("matches")
      .select("id")
      .eq("need_id", needAId)
      .eq("candidate_company_id", companyBId);
    expect(data && data.length).toBeGreaterThan(0);
  });

  it("une entreprise tierce ne voit PAS le match entre A et B", async () => {
    const { data } = await ownerThird.client
      .from("matches")
      .select("id")
      .eq("need_id", needAId)
      .eq("candidate_company_id", companyBId);
    expect(data ?? []).toEqual([]);
  });

  it("un visiteur non authentifié ne voit aucun match", async () => {
    const anon = anonClient();
    const { data } = await anon.from("matches").select("id").limit(1);
    expect(data ?? []).toEqual([]);
  });

  it("un administrateur de la plateforme peut consulter les matchs à des fins de diagnostic", async () => {
    const { data } = await platformAdmin.client
      .from("matches")
      .select("id")
      .eq("need_id", needAId)
      .eq("candidate_company_id", companyBId);
    expect(data && data.length).toBeGreaterThan(0);
  });

  it("l'entreprise éditrice de l'opportunité voit les entreprises compatibles", async () => {
    const { data } = await ownerA.client
      .from("opportunity_matches")
      .select("id")
      .eq("opportunity_id", opportunitySeekingId)
      .eq("candidate_company_id", companyBId);
    expect(data && data.length).toBeGreaterThan(0);
  });

  it("une entreprise tierce ne voit pas les entreprises compatibles d'une opportunité qui ne la concerne pas", async () => {
    const { data } = await ownerThird.client
      .from("opportunity_matches")
      .select("id")
      .eq("opportunity_id", opportunitySeekingId)
      .eq("candidate_company_id", companyBId);
    expect(data ?? []).toEqual([]);
  });

  it("une entreprise impliquée ne peut pas fabriquer/modifier elle-même un score", async () => {
    const { data: existing } = await ownerA.client
      .from("matches")
      .select("id")
      .eq("need_id", needAId)
      .eq("candidate_company_id", companyBId)
      .single();
    const { error } = await ownerA.client
      .from("matches")
      .update({ score: 100 })
      .eq("id", (existing as { id: string }).id);
    expect(error).not.toBeNull();
  });
});

/**
 * Vérification demandée par une revue externe (Phase 9, §18/§7) : "une
 * entreprise sans offre et sans besoin pourrait recevoir un score de
 * matching uniquement grâce aux valeurs neutres des données manquantes".
 * Test en LECTURE SEULE du comportement déjà existant : ne modifie ni
 * scoring.ts, ni les pondérations, ni les seuils, ni la génération de
 * candidats. Complète la lecture de code déjà faite (candidateGeneration.ts
 * part toujours de company_offers/company_needs, jamais de companies —
 * une entreprise sans aucun des deux ne peut structurellement générer
 * aucun candidat) par une preuve d'exécution réelle contre le vrai moteur.
 */
describe("Régression — une entreprise sans offre et sans besoin ne peut recevoir aucun score (§18 de la demande)", () => {
  let emptyOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
  let withNeedOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
  let emptyCompanyId: string;
  let withNeedCompanyId: string;
  const localCreatedCompanyIds: string[] = [];
  const localCreatedUserIds: string[] = [];

  beforeAll(async () => {
    emptyOwner = await createConfirmedUser("empty-company");
    withNeedOwner = await createConfirmedUser("with-need-company");
    localCreatedUserIds.push(emptyOwner.id, withNeedOwner.id);

    emptyCompanyId = await createCompany(emptyOwner, "Match Entreprise Vide", "FR");
    withNeedCompanyId = await createCompany(withNeedOwner, "Match Entreprise Avec Besoin", "CA");
    localCreatedCompanyIds.push(emptyCompanyId, withNeedCompanyId);

    // withNeedCompany a un besoin actif ; emptyCompany n'a NI offre NI
    // besoin, actif ou non — c'est le cas précis de la question posée.
    await withNeedOwner.client.from("company_needs").insert({
      company_id: withNeedCompanyId,
      capability_type_code: "DISTRIBUTOR",
    });
  }, 30000);

  afterAll(async () => {
    for (const id of localCreatedCompanyIds) {
      await admin.from("companies").delete().eq("id", id);
    }
    for (const id of localCreatedUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 30000);

  it("getCompatibilityBetweenCompanies() retourne null quand une des deux entreprises n'a ni offre ni besoin actif", async () => {
    const result = await getCompatibilityBetweenCompanies(
      admin,
      withNeedCompanyId,
      emptyCompanyId,
    );
    expect(result).toBeNull();
  });

  it("aucune ligne matches n'est créée impliquant l'entreprise sans offre ni besoin", async () => {
    const { data } = await admin
      .from("matches")
      .select("id")
      .or(`company_id.eq.${emptyCompanyId},candidate_company_id.eq.${emptyCompanyId}`);
    expect(data ?? []).toEqual([]);
  });
});
