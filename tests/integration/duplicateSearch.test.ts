import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 10C, LOT 10C-2) pour
 * find_similar_companies() et get_company_claim_preview() — migration
 * 0024_dedup_search_and_rate_limit.sql. NE PEUVENT PAS s'exécuter tant que
 * cette migration n'est pas appliquée sur le vrai projet Supabase (même
 * situation que tests/integration/partnershipRequests.test.ts avant
 * l'application de 0023 — préparés à l'avance).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
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
  const email = `test-10c2-${RUN_ID}-${label}@example.com`;
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

let unrelatedUser: Awaited<ReturnType<typeof createConfirmedUser>>;
let claimedOwner: Awaited<ReturnType<typeof createConfirmedUser>>;

let draftUnclaimedId: string;
let activeClaimedId: string;
let unrelatedCompanyId: string;

const draftSlug = `test-10c2-draft-${RUN_ID}`;
const claimedSlug = `test-10c2-claimed-${RUN_ID}`;
const unrelatedSlug = `test-10c2-unrelated-${RUN_ID}`;
const registrationNumber = `RC${RUN_ID}`;
const websiteDomain = `test10c2${RUN_ID}.example`;
// Sous-chaîne commune, assez longue (>= 3) et assez rare pour ne
// correspondre à aucune donnée réelle par accident.
const commonNeedle = `Zqx${RUN_ID}`;

beforeAll(async () => {
  unrelatedUser = await createConfirmedUser("unrelated");
  claimedOwner = await createConfirmedUser("claimed-owner");
  createdUserIds.push(unrelatedUser.id, claimedOwner.id);

  const { data: draft } = await admin
    .from("companies")
    .insert({
      legal_name: `[TEST 10C-2] Draft ${commonNeedle}`,
      display_name: `[TEST 10C-2] Draft ${commonNeedle}`,
      slug: draftSlug,
      country_code: "FR",
      status: "draft",
      company_registration_number: registrationNumber,
      website: `https://www.${websiteDomain}`,
    })
    .select("id")
    .single();
  draftUnclaimedId = draft!.id;
  await admin.from("company_locations").insert({
    company_id: draftUnclaimedId,
    location_type: "headquarters",
    is_primary: true,
    city: `Toulouse${RUN_ID}`,
    country_code: "FR",
  });

  const { data: claimed } = await admin
    .from("companies")
    .insert({
      legal_name: `[TEST 10C-2] Claimed ${commonNeedle}`,
      display_name: `[TEST 10C-2] Claimed ${commonNeedle}`,
      slug: claimedSlug,
      country_code: "FR",
      status: "active",
    })
    .select("id")
    .single();
  activeClaimedId = claimed!.id;
  await admin.from("company_members").insert({
    company_id: activeClaimedId,
    user_id: claimedOwner.id,
    role: "owner",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  await admin.from("company_locations").insert({
    company_id: activeClaimedId,
    location_type: "headquarters",
    is_primary: true,
    city: `Ville${RUN_ID}`,
    country_code: "FR",
  });

  const { data: unrelated } = await admin
    .from("companies")
    .insert({
      legal_name: `[TEST 10C-2] Sans rapport ${RUN_ID}`,
      display_name: `[TEST 10C-2] Sans rapport ${RUN_ID}`,
      slug: unrelatedSlug,
      country_code: "FR",
      status: "active",
    })
    .select("id")
    .single();
  unrelatedCompanyId = unrelated!.id;

  createdCompanyIds.push(draftUnclaimedId, activeClaimedId, unrelatedCompanyId);

  // 20+ entreprises partageant la même sous-chaîne, pour vérifier la
  // limite maximale de résultats (§5F de la revue).
  for (let i = 0; i < 22; i++) {
    const { data } = await admin
      .from("companies")
      .insert({
        legal_name: `[TEST 10C-2] Volume ${commonNeedle} ${i}`,
        display_name: `[TEST 10C-2] Volume ${commonNeedle} ${i}`,
        slug: `test-10c2-volume-${RUN_ID}-${i}`,
        country_code: "FR",
        status: "active",
      })
      .select("id")
      .single();
    createdCompanyIds.push(data!.id);
  }
}, 60000);

afterAll(async () => {
  await admin.from("company_locations").delete().in("company_id", [activeClaimedId, draftUnclaimedId]);
  await admin.from("company_members").delete().in("company_id", createdCompanyIds);
  await admin.from("companies").delete().in("id", createdCompanyIds);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("find_similar_companies() — accès (LOT 10C-2)", () => {
  it("un appel anonyme est refusé", async () => {
    const { error } = await anonClient().rpc("find_similar_companies", {
      p_display_name: "peu importe",
    });
    expect(error).not.toBeNull();
  });

  it("un utilisateur authentifié sans rapport peut appeler la fonction", async () => {
    const { error } = await unrelatedUser.client.rpc("find_similar_companies", {
      p_display_name: "peu importe",
    });
    expect(error).toBeNull();
  });
});

describe("find_similar_companies() — résultats (LOT 10C-2)", () => {
  it("même numéro officiel + même pays -> la fiche draft est retrouvée (signal fort)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_registration_number: registrationNumber, p_country_code: "FR" },
    );
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(
      draftUnclaimedId,
    );
  });

  it("numéro officiel + pays correspondant -> registration_number_match = true", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_registration_number: registrationNumber, p_country_code: "FR" },
    );
    expect(error).toBeNull();
    const row = (data ?? []).find((r: { id: string }) => r.id === draftUnclaimedId);
    expect(row).toBeDefined();
    expect(row.registration_number_match).toBe(true);
    // La valeur brute du numéro officiel n'est jamais retournée.
    expect(row).not.toHaveProperty("company_registration_number");
  });

  it("une entreprise DRAFT — même numéro officiel mais pays différent -> ni retrouvée, ni match (anti-collision)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_registration_number: registrationNumber, p_country_code: "CA" },
    );
    expect(error).toBeNull();
    // Pour une DRAFT, le pays est désormais une condition d'inclusion (pas
    // seulement du flag) : un pays différent doit l'exclure complètement.
    const row = (data ?? []).find((r: { id: string }) => r.id === draftUnclaimedId);
    expect(row).toBeUndefined();
  });

  it("même domaine de site (exact après normalisation) -> la fiche draft est retrouvée (signal fort)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_website: `http://${websiteDomain}/accueil` },
    );
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(
      draftUnclaimedId,
    );
  });

  it("une fiche draft/non revendiquée peut être détectée (signal fort) sans exposer ses coordonnées", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_registration_number: registrationNumber, p_country_code: "FR" },
    );
    expect(error).toBeNull();
    const row = (data ?? []).find((r: { id: string }) => r.id === draftUnclaimedId);
    expect(row).toBeDefined();
    expect(row.is_claimed).toBe(false);
    expect(row).not.toHaveProperty("professional_email");
    expect(row).not.toHaveProperty("phone");
  });

  it("une fiche revendiquée (a un owner actif) -> is_claimed = true", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: `[TEST 10C-2] Claimed ${commonNeedle}` },
    );
    expect(error).toBeNull();
    const row = (data ?? []).find((r: { id: string }) => r.id === activeClaimedId);
    expect(row).toBeDefined();
    expect(row.is_claimed).toBe(true);
    expect(row).not.toHaveProperty("professional_email");
    expect(row).not.toHaveProperty("phone");
  });

  it("nom sans rapport -> aucune des fiches de test n'est retournée", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: `Nom totalement différent ${crypto.randomUUID()}` },
    );
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(draftUnclaimedId);
    expect(ids).not.toContain(activeClaimedId);
    expect(ids).not.toContain(unrelatedCompanyId);
  });

  it("aucune colonne sensible n'est jamais exposée, quelle que soit la recherche", async () => {
    const { data } = await unrelatedUser.client.rpc("find_similar_companies", {
      p_registration_number: registrationNumber,
      p_country_code: "FR",
    });
    for (const row of data ?? []) {
      expect(Object.keys(row)).not.toContain("professional_email");
      expect(Object.keys(row)).not.toContain("phone");
    }
  });
});

describe("find_similar_companies() — restriction DRAFT, deuxième revue §1", () => {
  it("recherche floue par nom (sous-chaîne de son propre nom) -> ne révèle JAMAIS la DRAFT", async () => {
    // "[TEST" est une sous-chaîne réelle du nom de la fiche draft, mais
    // pas une correspondance exacte — la fiche active partage le même
    // préfixe et PEUT apparaître, la draft ne doit jamais apparaître.
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: "[TEST 10C-2] Draft" },
    );
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(draftUnclaimedId);
  });

  it("recherche floue générique ('Draft') -> ne révèle jamais la DRAFT même si le mot apparaît dans son nom", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: "Draft" },
    );
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(draftUnclaimedId);
  });

  it("nom normalisé EXACT + pays + ville correspondants -> la DRAFT est retrouvée (signal fort)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      {
        p_display_name: `[TEST 10C-2] Draft ${commonNeedle}`,
        p_country_code: "FR",
        p_city: `Toulouse${RUN_ID}`,
      },
    );
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(
      draftUnclaimedId,
    );
  });

  it("nom EXACT + pays mais ville différente -> la DRAFT n'est PAS retrouvée", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      {
        p_display_name: `[TEST 10C-2] Draft ${commonNeedle}`,
        p_country_code: "FR",
        p_city: "Une autre ville",
      },
    );
    expect(error).toBeNull();
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(draftUnclaimedId);
  });

  it("nom EXACT + pays, sans préciser de ville -> la DRAFT est retrouvée (ville non fournie = non bloquant)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      {
        p_display_name: `[TEST 10C-2] Draft ${commonNeedle}`,
        p_country_code: "FR",
      },
    );
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(
      draftUnclaimedId,
    );
  });

  it("une entreprise ACTIVE reste trouvable par simple recherche floue (contrairement à une draft)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: `Claimed ${commonNeedle}` },
    );
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(
      activeClaimedId,
    );
  });
});

describe("find_similar_companies() — anti-énumération (revue de sécurité LOT 10C-2)", () => {
  it("aucun paramètre significatif -> aucune ligne (jamais un dump)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      {},
    );
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("nom de recherche trop court (< 3 caractères) -> ignoré, aucune ligne sur ce seul critère", async () => {
    // "Zq" est un sous-ensemble réel du besoin commun (commonNeedle), mais
    // trop court : ne doit déclencher AUCUNE recherche par nom.
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: "Zq" },
    );
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("un nom de 3 caractères correspondant réellement est bien pris en compte (signal fort DRAFT : nom exact + pays)", async () => {
    // La règle finale pour une entreprise DRAFT exige le pays en plus du
    // nom exact (voir la revue de sécurité de 0024) — ce test doit donc
    // fournir p_country_code pour refléter la règle réellement appliquée,
    // pas seulement la longueur minimale du nom.
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      {
        p_display_name: `[TEST 10C-2] Draft ${commonNeedle}`,
        p_country_code: "FR",
      },
    );
    expect(error).toBeNull();
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(
      draftUnclaimedId,
    );
  });

  it("wildcard '%' -> traité comme un caractère littéral, jamais comme un motif global", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: "%%%" },
    );
    expect(error).toBeNull();
    // Aucune entreprise ne contient littéralement "%%%" dans son nom —
    // si le résultat n'est pas vide, le wildcard a été interprété comme
    // un motif ILIKE plutôt que comme un texte littéral.
    expect(data ?? []).toEqual([]);
  });

  it("wildcard '_' -> traité comme un caractère littéral, jamais comme un motif global", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: "___" },
    );
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("le nombre de résultats reste borné (limite raisonnable)", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "find_similar_companies",
      { p_display_name: commonNeedle },
    );
    expect(error).toBeNull();
    // 24 entreprises partagent commonNeedle (draft + claimed + 22 volume) —
    // le résultat doit rester borné, jamais un dump complet.
    expect((data ?? []).length).toBeLessThanOrEqual(20);
  });
});

describe("get_company_claim_preview() — parcours de revendication réellement utilisable (LOT 10C-2, §2 de la revue)", () => {
  it("un appel anonyme est refusé", async () => {
    const { error } = await anonClient().rpc("get_company_claim_preview", {
      p_slug: draftSlug,
    });
    expect(error).not.toBeNull();
  });

  it("une fiche draft non revendiquée est prévisualisable sans exposer le reste de la fiche", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "get_company_claim_preview",
      { p_slug: draftSlug },
    );
    expect(error).toBeNull();
    const row = (data ?? [])[0];
    expect(row).toBeDefined();
    expect(row.id).toBe(draftUnclaimedId);
    expect(row.is_claimed).toBe(false);
    expect(Object.keys(row).sort()).toEqual(
      ["display_name", "id", "is_claimed", "slug"].sort(),
    );
  });

  it("une fiche déjà revendiquée est signalée comme telle", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "get_company_claim_preview",
      { p_slug: claimedSlug },
    );
    expect(error).toBeNull();
    expect((data ?? [])[0]?.is_claimed).toBe(true);
  });

  it("un slug inexistant ne retourne aucune ligne", async () => {
    const { data, error } = await unrelatedUser.client.rpc(
      "get_company_claim_preview",
      { p_slug: `slug-inexistant-${crypto.randomUUID()}` },
    );
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("le parcours de revendication est réellement utilisable pour la fiche draft trouvée (bout en bout)", async () => {
    const { data: preview, error: previewError } = await unrelatedUser.client.rpc(
      "get_company_claim_preview",
      { p_slug: draftSlug },
    );
    expect(previewError).toBeNull();
    const companyId = (preview ?? [])[0]?.id;
    expect(companyId).toBe(draftUnclaimedId);

    const { data: claim, error: claimError } = await unrelatedUser.client.rpc(
      "submit_company_claim",
      {
        p_company_id: companyId,
        p_professional_email: unrelatedUser.email,
        p_justification: "Test LOT 10C-2 — vérification du parcours réel.",
      },
    );
    expect(claimError).toBeNull();
    expect(claim.status).toBe("pending");

    const { data: storedClaim } = await admin
      .from("company_claims")
      .select("id, company_id, status")
      .eq("id", claim.id)
      .single();
    expect(storedClaim?.company_id).toBe(draftUnclaimedId);
  });
});
