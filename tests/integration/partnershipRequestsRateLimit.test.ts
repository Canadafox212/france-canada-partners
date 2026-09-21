import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 10C, LOT 10C-2) pour la limitation
 * anti-rafale ajoutée à create_partnership_request() — migration
 * 0024_dedup_search_and_rate_limit.sql. NE PEUVENT PAS s'exécuter tant que
 * cette migration n'est pas appliquée (même situation que
 * tests/integration/partnershipRequests.test.ts avant 0023).
 *
 * Seuil courant : 20 demandes créées (tous statuts) par
 * requester_company_id sur une heure glissante — voir la migration pour la
 * justification. Ces tests figent ce seuil ; s'il change, ce fichier doit
 * être mis à jour en même temps que la migration.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
const TEST_PASSWORD = "MotDePasseTest123!";
const RATE_LIMIT_THRESHOLD = 20;

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient(): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(label: string) {
  const email = `test-ratelimit-${RUN_ID}-${label}@example.com`;
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

async function createActiveCompany(name: string) {
  const { data, error } = await admin
    .from("companies")
    .insert({
      legal_name: name,
      display_name: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      country_code: "FR",
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Création entreprise échouée");
  return data.id as string;
}

async function addMember(
  companyId: string,
  userId: string,
  role: "owner" | "admin" | "member",
) {
  await admin.from("company_members").insert({
    company_id: companyId,
    user_id: userId,
    role,
    status: "active",
    joined_at: new Date().toISOString(),
  });
}

/** Insertion directe (bypass RLS/RPC) pour pré-remplir des demandes "déjà créées" sans dépendre de 20 appels RPC réels. */
async function seedRequests(
  requesterCompanyId: string,
  targetCompanyIds: string[],
  createdBy: string,
  createdAt?: string,
) {
  const rows = targetCompanyIds.map((targetId) => ({
    requester_company_id: requesterCompanyId,
    target_company_id: targetId,
    created_by: createdBy,
    status: "declined",
    subject: "Sujet de test (rate limit)",
    message: "Message de test pour la limitation anti-rafale.",
    source_type: "OTHER",
    ...(createdAt ? { created_at: createdAt } : {}),
  }));
  const { error } = await admin.from("partnership_requests").insert(rows);
  if (error) throw error;
}

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

let requesterOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
let requesterSecondMember: Awaited<ReturnType<typeof createConfirmedUser>>;
let otherCompanyOwner: Awaited<ReturnType<typeof createConfirmedUser>>;

let requesterCompanyId: string;
let otherCompanyId: string;
let staleCompanyId: string;
const targetCompanyIds: string[] = [];

beforeAll(async () => {
  requesterOwner = await createConfirmedUser("owner");
  requesterSecondMember = await createConfirmedUser("member");
  otherCompanyOwner = await createConfirmedUser("other-owner");
  createdUserIds.push(
    requesterOwner.id,
    requesterSecondMember.id,
    otherCompanyOwner.id,
  );

  requesterCompanyId = await createActiveCompany(
    `TEST RateLimit Requester ${RUN_ID}`,
  );
  otherCompanyId = await createActiveCompany(
    `TEST RateLimit Other ${RUN_ID}`,
  );
  staleCompanyId = await createActiveCompany(
    `TEST RateLimit Stale ${RUN_ID}`,
  );
  createdCompanyIds.push(requesterCompanyId, otherCompanyId, staleCompanyId);

  await addMember(requesterCompanyId, requesterOwner.id, "owner");
  await addMember(requesterCompanyId, requesterSecondMember.id, "member");
  await addMember(otherCompanyId, otherCompanyOwner.id, "owner");

  // 25 entreprises cibles distinctes : assez pour dépasser le seuil tout
  // en respectant la contrainte "une seule demande active par paire"
  // (chaque cible n'est utilisée qu'une fois).
  for (let i = 0; i < 25; i++) {
    const id = await createActiveCompany(
      `TEST RateLimit Target ${RUN_ID} ${i}`,
    );
    targetCompanyIds.push(id);
    createdCompanyIds.push(id);
  }
}, 60000);

afterAll(async () => {
  await admin
    .from("partnership_requests")
    .delete()
    .in("requester_company_id", [
      requesterCompanyId,
      otherCompanyId,
      staleCompanyId,
    ]);
  await admin.from("company_members").delete().in("company_id", createdCompanyIds);
  await admin.from("companies").delete().in("id", createdCompanyIds);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("Anti-rafale de create_partnership_request() (Phase 10C, LOT 10C-2)", () => {
  it(`sous le seuil (${RATE_LIMIT_THRESHOLD - 1} déjà créées) -> la création suivante est autorisée`, async () => {
    await seedRequests(
      requesterCompanyId,
      targetCompanyIds.slice(0, RATE_LIMIT_THRESHOLD - 1),
      requesterOwner.id,
    );
    const { data, error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyIds[RATE_LIMIT_THRESHOLD - 1],
        p_subject: "Sujet",
        p_message: "Message",
      },
    );
    expect(error).toBeNull();
    expect(data.status).toBe("pending_unclaimed");
  });

  it(`au seuil (${RATE_LIMIT_THRESHOLD} déjà créées) -> la demande suivante est refusée`, async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyIds[RATE_LIMIT_THRESHOLD],
        p_subject: "Sujet",
        p_message: "Message",
      },
    );
    expect(error).not.toBeNull();
    expect(error!.message).toContain("RATE_LIMIT_EXCEEDED");
  });

  it("un second membre (role member) de la même entreprise est bloqué par la même limite", async () => {
    const { error } = await requesterSecondMember.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyIds[RATE_LIMIT_THRESHOLD + 1],
        p_subject: "Sujet",
        p_message: "Message",
      },
    );
    expect(error).not.toBeNull();
    expect(error!.message).toContain("RATE_LIMIT_EXCEEDED");
  });

  it("une autre entreprise, sans historique, n'est pas affectée par la limite de la première", async () => {
    const { data, error } = await otherCompanyOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: otherCompanyId,
        p_target_company_id: targetCompanyIds[RATE_LIMIT_THRESHOLD + 2],
        p_subject: "Sujet",
        p_message: "Message",
      },
    );
    expect(error).toBeNull();
    expect(data.status).toBe("pending_unclaimed");
  });

  it("des demandes historiques hors de la fenêtre d'une heure ne comptent plus", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await seedRequests(
      staleCompanyId,
      targetCompanyIds.slice(0, RATE_LIMIT_THRESHOLD + 5),
      requesterOwner.id,
      twoHoursAgo,
    );
    await addMember(staleCompanyId, otherCompanyOwner.id, "owner");
    const { data, error } = await otherCompanyOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: staleCompanyId,
        p_target_company_id: targetCompanyIds[RATE_LIMIT_THRESHOLD + 3],
        p_subject: "Sujet",
        p_message: "Message",
      },
    );
    expect(error).toBeNull();
    expect(data.status).toBe("pending_unclaimed");
  });
});

/**
 * Scénario de concurrence réelle isolé et auto-suffisant : crée une
 * entreprise + owner dédiés, pré-remplit `existingCount` demandes
 * (immédiates, ou hors fenêtre d'une heure si `stale` est vrai), puis
 * déclenche `concurrentCount` VRAIS appels HTTP simultanés (Promise.all —
 * chacun sa propre transaction Postgres) et vérifie le nombre exact de
 * succès/échecs et le total final en base.
 */
async function runConcurrencyScenario(params: {
  label: string;
  existingCount: number;
  concurrentCount: number;
  expectedSuccesses: number;
  stale?: boolean;
}) {
  const { label, existingCount, concurrentCount, expectedSuccesses, stale } = params;
  const scenarioId = `${label}-${crypto.randomUUID().slice(0, 6)}`;
  const owner = await createConfirmedUser(`scenario-${scenarioId}`);
  createdUserIds.push(owner.id);
  const companyId = await createActiveCompany(`TEST RateLimit Scenario ${scenarioId}`);
  createdCompanyIds.push(companyId);
  await addMember(companyId, owner.id, "owner");

  if (existingCount > 0) {
    const seedTargetIds: string[] = [];
    for (let i = 0; i < existingCount; i++) {
      const id = await createActiveCompany(
        `TEST RateLimit Scenario ${scenarioId} Seed ${i}`,
      );
      seedTargetIds.push(id);
      createdCompanyIds.push(id);
    }
    await seedRequests(
      companyId,
      seedTargetIds,
      owner.id,
      stale ? new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() : undefined,
    );
  }

  const concurrentTargetIds: string[] = [];
  for (let i = 0; i < concurrentCount; i++) {
    const id = await createActiveCompany(
      `TEST RateLimit Scenario ${scenarioId} Concurrent ${i}`,
    );
    concurrentTargetIds.push(id);
    createdCompanyIds.push(id);
  }

  const results = await Promise.all(
    concurrentTargetIds.map((targetId) =>
      owner.client.rpc("create_partnership_request", {
        p_requester_company_id: companyId,
        p_target_company_id: targetId,
        p_subject: "Sujet",
        p_message: "Message",
      }),
    ),
  );

  const succeeded = results.filter((r) => r.error === null);
  const rateLimited = results.filter(
    (r) => r.error !== null && r.error.message.includes("RATE_LIMIT_EXCEEDED"),
  );

  expect(succeeded.length).toBe(expectedSuccesses);
  expect(rateLimited.length).toBe(concurrentCount - expectedSuccesses);

  const { count } = await admin
    .from("partnership_requests")
    .select("id", { count: "exact", head: true })
    .eq("requester_company_id", companyId);
  // Nombre total de lignes PHYSIQUEMENT présentes dans la table — les
  // demandes pré-existantes ne sont jamais supprimées, qu'elles soient ou
  // non comptées par la fenêtre glissante d'une heure de la fonction
  // anti-rafale (cette dernière distinction est déjà vérifiée séparément
  // par expect(succeeded.length)/expect(rateLimited.length) ci-dessus).
  expect(count).toBe(existingCount + succeeded.length);
}

describe("Anti-rafale — appels concurrents réels (§3 de la revue de sécurité)", () => {
  it("19 existantes + 5 simultanées -> exactement 1 succès, 4 RATE_LIMIT_EXCEEDED, total final 20", async () => {
    await runConcurrencyScenario({
      label: "19plus5",
      existingCount: 19,
      concurrentCount: 5,
      expectedSuccesses: 1,
    });
  });

  it("18 existantes + 5 simultanées -> exactement 2 succès, 3 refus", async () => {
    await runConcurrencyScenario({
      label: "18plus5",
      existingCount: 18,
      concurrentCount: 5,
      expectedSuccesses: 2,
    });
  });

  it("20 existantes + 1 simultanée -> 0 succès, 1 refus", async () => {
    await runConcurrencyScenario({
      label: "20plus1",
      existingCount: 20,
      concurrentCount: 1,
      expectedSuccesses: 0,
    });
  });

  it("21 anciennes hors fenêtre + 1 -> succès (la fenêtre glissante reste respectée sous concurrence)", async () => {
    await runConcurrencyScenario({
      label: "stale21plus1",
      existingCount: 21,
      concurrentCount: 1,
      expectedSuccesses: 1,
      stale: true,
    });
  });
});
