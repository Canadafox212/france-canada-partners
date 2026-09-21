import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 9) pour partnership_requests — migration
 * 0023_partnership_requests.sql. NE PEUVENT PAS s'exécuter tant que cette
 * migration n'est pas appliquée sur le vrai projet Supabase (préparés à
 * l'avance, comme tests/integration/sector-mapping.test.ts l'avait été pour
 * la migration 0021 en Phase 8). Complète la validation locale pglite (qui
 * ne peut pas vérifier la RLS/les GRANT réels sans un vrai changement de
 * rôle Postgres — voir le harnais de migration-test pour la version qui le
 * fait via SET ROLE).
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
  const email = `test-phase9-${RUN_ID}-${label}@example.com`;
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

async function createCompany(
  displayName: string,
  status: "draft" | "active",
  claimedAt: string | null,
) {
  const { data, error } = await admin
    .from("companies")
    .insert({
      legal_name: displayName,
      display_name: displayName,
      slug: displayName.toLowerCase().replace(/\s+/g, "-"),
      country_code: "FR",
      status,
      claimed_at: claimedAt,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Création entreprise échouée");
  return data.id as string;
}

async function addMember(
  companyId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "viewer",
) {
  await admin.from("company_members").insert({
    company_id: companyId,
    user_id: userId,
    role,
    status: "active",
    joined_at: new Date().toISOString(),
  });
}

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

let requesterOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
let targetOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
let targetViewer: Awaited<ReturnType<typeof createConfirmedUser>>;
let thirdParty: Awaited<ReturnType<typeof createConfirmedUser>>;
let claimant: Awaited<ReturnType<typeof createConfirmedUser>>;

let requesterCompanyId: string;
let requesterDraftCompanyId: string;
let targetCompanyId: string;
let targetDraftCompanyId: string;
let targetUnclaimedCompanyId: string;
let otherCompanyAId: string;
let otherCompanyBId: string;

let foreignMatchId: string;
let realMatchId: string;
let foreignOpportunityId: string;
let realOpportunityId: string;

beforeAll(async () => {
  [requesterOwner, targetOwner, targetViewer, thirdParty, claimant] =
    await Promise.all([
      createConfirmedUser("requester-owner"),
      createConfirmedUser("target-owner"),
      createConfirmedUser("target-viewer"),
      createConfirmedUser("third-party"),
      createConfirmedUser("claimant"),
    ]);
  createdUserIds.push(
    requesterOwner.id,
    targetOwner.id,
    targetViewer.id,
    thirdParty.id,
    claimant.id,
  );

  requesterCompanyId = await createCompany(
    `Requester PR ${RUN_ID}`,
    "active",
    new Date().toISOString(),
  );
  requesterDraftCompanyId = await createCompany(
    `Requester Draft PR ${RUN_ID}`,
    "draft",
    null,
  );
  targetCompanyId = await createCompany(
    `Target PR ${RUN_ID}`,
    "active",
    new Date().toISOString(),
  );
  targetDraftCompanyId = await createCompany(
    `Target Draft PR ${RUN_ID}`,
    "draft",
    null,
  );
  targetUnclaimedCompanyId = await createCompany(
    `Target Unclaimed PR ${RUN_ID}`,
    "active",
    null,
  );
  otherCompanyAId = await createCompany(`Other A PR ${RUN_ID}`, "active", null);
  otherCompanyBId = await createCompany(`Other B PR ${RUN_ID}`, "active", null);
  createdCompanyIds.push(
    requesterCompanyId,
    requesterDraftCompanyId,
    targetCompanyId,
    targetDraftCompanyId,
    targetUnclaimedCompanyId,
    otherCompanyAId,
    otherCompanyBId,
  );

  await Promise.all([
    addMember(requesterCompanyId, requesterOwner.id, "owner"),
    addMember(requesterDraftCompanyId, requesterOwner.id, "owner"),
    addMember(targetCompanyId, targetOwner.id, "owner"),
    addMember(targetCompanyId, targetViewer.id, "viewer"),
  ]);

  // Match n'impliquant NI requesterCompany NI targetCompany.
  const { data: needOther } = await admin
    .from("company_needs")
    .insert({ company_id: otherCompanyAId, capability_type_code: "DISTRIBUTOR" })
    .select("id")
    .single();
  const { data: offerOther } = await admin
    .from("company_offers")
    .insert({ company_id: otherCompanyBId, capability_type_code: "DISTRIBUTOR" })
    .select("id")
    .single();
  const { data: matchOther } = await admin
    .from("matches")
    .insert({
      company_id: otherCompanyAId,
      need_id: (needOther as { id: string }).id,
      candidate_company_id: otherCompanyBId,
      offer_id: (offerOther as { id: string }).id,
      score: 80,
      confidence: 80,
      score_breakdown: {},
      algorithm_version: "test",
    })
    .select("id")
    .single();
  foreignMatchId = (matchOther as { id: string }).id;

  // Match RÉEL entre requesterCompany (besoin) et targetCompany (offre).
  const { data: needReal } = await admin
    .from("company_needs")
    .insert({ company_id: requesterCompanyId, capability_type_code: "DISTRIBUTOR" })
    .select("id")
    .single();
  const { data: offerReal } = await admin
    .from("company_offers")
    .insert({ company_id: targetCompanyId, capability_type_code: "DISTRIBUTOR" })
    .select("id")
    .single();
  const { data: matchReal } = await admin
    .from("matches")
    .insert({
      company_id: requesterCompanyId,
      need_id: (needReal as { id: string }).id,
      candidate_company_id: targetCompanyId,
      offer_id: (offerReal as { id: string }).id,
      score: 90,
      confidence: 90,
      score_breakdown: {},
      algorithm_version: "test",
    })
    .select("id")
    .single();
  realMatchId = (matchReal as { id: string }).id;

  // Opportunité publiée par une AUTRE entreprise (pas la cible).
  const { data: oppOther } = await admin
    .from("opportunities")
    .insert({
      company_id: otherCompanyAId,
      title: `Opp autre PR ${RUN_ID}`,
      capability_type_code: "DISTRIBUTOR",
      direction: "seeking",
      origin_country_code: "FR",
      language_code: "fr",
      status: "published",
    })
    .select("id")
    .single();
  foreignOpportunityId = (oppOther as { id: string }).id;

  // Opportunité publiée par la vraie cible.
  const { data: oppReal } = await admin
    .from("opportunities")
    .insert({
      company_id: targetCompanyId,
      title: `Opp cible PR ${RUN_ID}`,
      capability_type_code: "DISTRIBUTOR",
      direction: "seeking",
      origin_country_code: "FR",
      language_code: "fr",
      status: "published",
    })
    .select("id")
    .single();
  realOpportunityId = (oppReal as { id: string }).id;
}, 60000);

afterAll(async () => {
  for (const id of createdCompanyIds) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("Création — validations (§4/§7/§8 de la demande)", () => {
  it("création valide (OTHER, sans provenance)", async () => {
    const { data, error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "Sujet de test",
        p_message: "Message de test",
      },
    );
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("pending");
    await admin
      .from("partnership_requests")
      .delete()
      .eq("id", (data as { id: string }).id);
  });

  it("auto-demande interdite", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: requesterCompanyId,
        p_subject: "x",
        p_message: "y",
      },
    );
    expect(error).not.toBeNull();
  });

  it("demandeur non membre de requester_company_id refusé", async () => {
    const { error } = await thirdParty.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "x",
        p_message: "y",
      },
    );
    expect(error).not.toBeNull();
  });

  it("entreprise cible inexistante refusée", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: "00000000-0000-0000-0000-000000000000",
        p_subject: "x",
        p_message: "y",
      },
    );
    expect(error).not.toBeNull();
  });

  it("entreprise demandeuse en draft refusée", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterDraftCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "x",
        p_message: "y",
      },
    );
    expect(error).not.toBeNull();
  });

  it("entreprise cible en draft refusée", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetDraftCompanyId,
        p_subject: "x",
        p_message: "y",
      },
    );
    expect(error).not.toBeNull();
  });

  it("faux source_match_id (match concernant d'autres entreprises) refusé", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "x",
        p_message: "y",
        p_source_type: "MATCH",
        p_source_match_id: foreignMatchId,
      },
    );
    expect(error).not.toBeNull();
  });

  it("vrai source_match_id (concerne bien les deux entreprises) accepté", async () => {
    const { data, error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "Via match",
        p_message: "Via match",
        p_source_type: "MATCH",
        p_source_match_id: realMatchId,
      },
    );
    expect(error).toBeNull();
    await admin
      .from("partnership_requests")
      .delete()
      .eq("id", (data as { id: string }).id);
  });

  it("faux source_opportunity_id (publiée par une autre entreprise que la cible) refusé", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "x",
        p_message: "y",
        p_source_type: "OPPORTUNITY",
        p_source_opportunity_id: foreignOpportunityId,
      },
    );
    expect(error).not.toBeNull();
  });

  it("vrai source_opportunity_id (publiée par la cible) accepté", async () => {
    const { data, error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "Via opportunité",
        p_message: "Via opportunité",
        p_source_type: "OPPORTUNITY",
        p_source_opportunity_id: realOpportunityId,
      },
    );
    expect(error).toBeNull();
    await admin
      .from("partnership_requests")
      .delete()
      .eq("id", (data as { id: string }).id);
  });

  it("appel anonyme refusé (EXECUTE révoqué)", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("create_partnership_request", {
      p_requester_company_id: requesterCompanyId,
      p_target_company_id: targetCompanyId,
      p_subject: "x",
      p_message: "y",
    });
    expect(error).not.toBeNull();
  });
});

describe("Doublons, lecture, réponse, retrait", () => {
  let requestId: string;

  beforeAll(async () => {
    const { data } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "Sujet principal",
        p_message: "Message principal",
      },
    );
    requestId = (data as { id: string }).id;
  });

  afterAll(async () => {
    await admin.from("partnership_requests").delete().eq("id", requestId);
  });

  it("une demande active en double vers la même cible est refusée", async () => {
    const { error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "Autre sujet",
        p_message: "Autre message",
      },
    );
    expect(error).not.toBeNull();
  });

  it("le demandeur peut lire sa propre demande", async () => {
    const { data } = await requesterOwner.client
      .from("partnership_requests")
      .select("id")
      .eq("id", requestId);
    expect(data).toHaveLength(1);
  });

  it("la cible (owner) peut lire la demande", async () => {
    const { data } = await targetOwner.client
      .from("partnership_requests")
      .select("id")
      .eq("id", requestId);
    expect(data).toHaveLength(1);
  });

  it("un viewer de la cible peut LIRE la demande", async () => {
    const { data } = await targetViewer.client
      .from("partnership_requests")
      .select("id")
      .eq("id", requestId);
    expect(data).toHaveLength(1);
  });

  it("un tiers sans lien avec aucune des deux entreprises ne voit rien", async () => {
    const { data } = await thirdParty.client
      .from("partnership_requests")
      .select("id")
      .eq("id", requestId);
    expect(data ?? []).toEqual([]);
  });

  it("aucune donnée personnelle n'est exposée par la lecture (email/téléphone personnels absents du schéma de la table)", async () => {
    const { data } = await targetOwner.client
      .from("partnership_requests")
      .select("*")
      .eq("id", requestId)
      .single();
    const keys = Object.keys(data as object);
    expect(keys).not.toContain("professional_email");
    expect(keys).not.toContain("phone");
  });

  it("un viewer de la cible ne peut pas accepter", async () => {
    const { error } = await targetViewer.client.rpc(
      "accept_partnership_request",
      { p_request_id: requestId },
    );
    expect(error).not.toBeNull();
  });

  it("un viewer de la cible ne peut pas refuser", async () => {
    const { error } = await targetViewer.client.rpc(
      "decline_partnership_request",
      { p_request_id: requestId },
    );
    expect(error).not.toBeNull();
  });

  it("le demandeur ne peut pas accepter sa propre demande", async () => {
    const { error } = await requesterOwner.client.rpc(
      "accept_partnership_request",
      { p_request_id: requestId },
    );
    expect(error).not.toBeNull();
  });

  it("appel anonyme à accept_partnership_request refusé", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("accept_partnership_request", {
      p_request_id: requestId,
    });
    expect(error).not.toBeNull();
  });

  it("la cible (owner) accepte la demande", async () => {
    const { data, error } = await targetOwner.client.rpc(
      "accept_partnership_request",
      { p_request_id: requestId },
    );
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("accepted");
  });

  it("une notification est créée pour le demandeur", async () => {
    const { data } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", requesterOwner.id)
      .eq("type", "partnership_request_accepted");
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("un audit log est créé pour l'acceptation", async () => {
    const { data } = await admin
      .from("audit_logs")
      .select("id")
      .eq("action", "partnership_request_accepted")
      .eq("entity_id", requestId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe("Refus et retrait", () => {
  it("la cible peut refuser une demande pending", async () => {
    const { data: created } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "À refuser",
        p_message: "À refuser",
      },
    );
    const id = (created as { id: string }).id;
    const { data, error } = await targetOwner.client.rpc(
      "decline_partnership_request",
      { p_request_id: id },
    );
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("declined");
    await admin.from("partnership_requests").delete().eq("id", id);
  });

  it("le demandeur peut retirer une demande pending", async () => {
    const { data: created } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "À retirer",
        p_message: "À retirer",
      },
    );
    const id = (created as { id: string }).id;
    const { data, error } = await requesterOwner.client.rpc(
      "withdraw_partnership_request",
      { p_request_id: id },
    );
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("withdrawn");

    // Une nouvelle demande active redevient possible après un retrait.
    const { data: recreated, error: recreateError } =
      await requesterOwner.client.rpc("create_partnership_request", {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetCompanyId,
        p_subject: "Nouvelle tentative",
        p_message: "Nouvelle tentative",
      });
    expect(recreateError).toBeNull();
    await admin
      .from("partnership_requests")
      .delete()
      .in("id", [id, (recreated as { id: string }).id]);
  });
});

describe("Entreprise cible non revendiquée (§3 de la demande)", () => {
  let unclaimedRequestId: string;

  afterAll(async () => {
    if (unclaimedRequestId) {
      await admin
        .from("partnership_requests")
        .delete()
        .eq("id", unclaimedRequestId);
    }
  });

  it("une demande vers une entreprise non revendiquée est enregistrée en pending_unclaimed, sans notification", async () => {
    const { data, error } = await requesterOwner.client.rpc(
      "create_partnership_request",
      {
        p_requester_company_id: requesterCompanyId,
        p_target_company_id: targetUnclaimedCompanyId,
        p_subject: "Vers non revendiquée",
        p_message: "Vers non revendiquée",
      },
    );
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("pending_unclaimed");
    unclaimedRequestId = (data as { id: string }).id;

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "partnership_request_received")
      .contains("payload", { request_id: unclaimedRequestId });
    expect(notifs ?? []).toEqual([]);
  });

  it("la demande devient visible (pending) après revendication de l'entreprise cible", async () => {
    // Phase 10C (LOT 10C-3) : professional_email vit désormais dans
    // company_contacts, jamais dans companies (colonne legacy contrainte
    // à NULL depuis la migration 0025).
    await admin.from("company_contacts").upsert(
      { company_id: targetUnclaimedCompanyId, professional_email: claimant.email },
      { onConflict: "company_id" },
    );

    const { data: claim, error } = await claimant.client.rpc(
      "submit_company_claim",
      {
        p_company_id: targetUnclaimedCompanyId,
        p_professional_email: claimant.email,
      },
    );
    expect(error).toBeNull();
    expect((claim as { status: string }).status).toBe("approved");

    const { data: after } = await admin
      .from("partnership_requests")
      .select("status")
      .eq("id", unclaimedRequestId)
      .single();
    expect((after as { status: string }).status).toBe("pending");

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", claimant.id)
      .eq("type", "partnership_request_received");
    expect((notifs ?? []).length).toBeGreaterThan(0);
  });
});
