import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 5) pour les opportunités commerciales et
 * leurs réponses : même principe que les suites précédentes (vrai projet
 * Supabase, aucun mock), données créées puis supprimées à chaque exécution.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
const testEmail = (label: string) =>
  `test-phase5-${RUN_ID}-${label}@example.com`;
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

let publisherOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
let publisherMember: Awaited<ReturnType<typeof createConfirmedUser>>;
let publisherViewer: Awaited<ReturnType<typeof createConfirmedUser>>;
let responderOwner: Awaited<ReturnType<typeof createConfirmedUser>>;
let thirdPartyOwner: Awaited<ReturnType<typeof createConfirmedUser>>;

let publisherCompanyId: string;
let responderCompanyId: string;
let thirdPartyCompanyId: string;
let opportunityId: string;
let responseId: string;

beforeAll(async () => {
  [
    publisherOwner,
    publisherMember,
    publisherViewer,
    responderOwner,
    thirdPartyOwner,
  ] = await Promise.all([
    createConfirmedUser("pub-owner"),
    createConfirmedUser("pub-member"),
    createConfirmedUser("pub-viewer"),
    createConfirmedUser("resp-owner"),
    createConfirmedUser("third-owner"),
  ]);
  createdUserIds.push(
    publisherOwner.id,
    publisherMember.id,
    publisherViewer.id,
    responderOwner.id,
    thirdPartyOwner.id,
  );

  const { data: publisherCompany } = await publisherOwner.client
    .rpc("create_company", {
      p_legal_name: "Éditeur Opportunité Test",
      p_display_name: `Éditeur Opportunité Test ${RUN_ID}`,
      p_slug: `editeur-opportunite-test-${RUN_ID}`,
      p_country_code: "FR",
    })
    .single();
  publisherCompanyId = (publisherCompany as { id: string }).id;
  createdCompanyIds.push(publisherCompanyId);

  await admin.from("company_members").insert([
    {
      company_id: publisherCompanyId,
      user_id: publisherMember.id,
      role: "member",
      status: "active",
      joined_at: new Date().toISOString(),
    },
    {
      company_id: publisherCompanyId,
      user_id: publisherViewer.id,
      role: "viewer",
      status: "active",
      joined_at: new Date().toISOString(),
    },
  ]);

  const { data: responderCompany } = await responderOwner.client
    .rpc("create_company", {
      p_legal_name: "Répondant Opportunité Test",
      p_display_name: `Répondant Opportunité Test ${RUN_ID}`,
      p_slug: `repondant-opportunite-test-${RUN_ID}`,
      p_country_code: "CA",
    })
    .single();
  responderCompanyId = (responderCompany as { id: string }).id;
  createdCompanyIds.push(responderCompanyId);

  const { data: thirdPartyCompany } = await thirdPartyOwner.client
    .rpc("create_company", {
      p_legal_name: "Tiers Opportunité Test",
      p_display_name: `Tiers Opportunité Test ${RUN_ID}`,
      p_slug: `tiers-opportunite-test-${RUN_ID}`,
      p_country_code: "FR",
    })
    .single();
  thirdPartyCompanyId = (thirdPartyCompany as { id: string }).id;
  createdCompanyIds.push(thirdPartyCompanyId);
}, 30000);

afterAll(async () => {
  for (const id of createdCompanyIds) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("Publication (rôles)", () => {
  it("VIEWER ne peut pas publier d'opportunité", async () => {
    const { error } = await publisherViewer.client
      .from("opportunities")
      .insert({
        company_id: publisherCompanyId,
        title: "Test viewer",
        capability_type_code: "DISTRIBUTOR",
        direction: "seeking",
        origin_country_code: "FR",
        language_code: "fr",
      });
    expect(error).not.toBeNull();
  });

  it("MEMBER peut créer une opportunité (brouillon)", async () => {
    const { data, error } = await publisherMember.client
      .from("opportunities")
      .insert({
        company_id: publisherCompanyId,
        title: "Recherche distributeur au Québec",
        description: "Lancement d'une nouvelle gamme de groupes frigorifiques.",
        capability_type_code: "DISTRIBUTOR",
        direction: "seeking",
        origin_country_code: "FR",
        target_country_code: "CA",
        target_region: "Québec",
        language_code: "fr",
      })
      .select("id, status, slug")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("draft");
    expect(data?.slug).toMatch(/^recherche-distributeur-au-quebec-/);
    opportunityId = data!.id;
  });

  it("visiteur ne peut pas voir un brouillon", async () => {
    const visitor = anonClient();
    const { data } = await visitor
      .from("opportunities")
      .select("id")
      .eq("id", opportunityId);
    expect(data).toEqual([]);
  });

  it("OWNER publie l'opportunité", async () => {
    const { error } = await publisherOwner.client
      .from("opportunities")
      .update({ status: "published" })
      .eq("id", opportunityId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("opportunities")
      .select("published_at, expires_at")
      .eq("id", opportunityId)
      .single();
    expect(data?.published_at).not.toBeNull();
    expect(data?.expires_at).not.toBeNull();
  });

  it("visiteur peut désormais consulter l'opportunité publiée", async () => {
    const visitor = anonClient();
    const { data, error } = await visitor
      .from("opportunities")
      .select("id, title")
      .eq("id", opportunityId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("visiteur ne peut pas publier d'opportunité", async () => {
    const visitor = anonClient();
    const { error } = await visitor.from("opportunities").insert({
      company_id: publisherCompanyId,
      title: "Injection visiteur",
      capability_type_code: "DISTRIBUTOR",
      direction: "seeking",
      origin_country_code: "FR",
      language_code: "fr",
    });
    expect(error).not.toBeNull();
  });

  it("une entreprise tierce ne peut pas modifier l'opportunité d'une autre entreprise", async () => {
    await thirdPartyOwner.client
      .from("opportunities")
      .update({ title: "Piraté" })
      .eq("id", opportunityId);
    const { data } = await admin
      .from("opportunities")
      .select("title")
      .eq("id", opportunityId)
      .single();
    expect(data?.title).not.toBe("Piraté");
  });
});

describe("Réponses — création", () => {
  it("un utilisateur ne peut pas répondre au nom d'une entreprise à laquelle il n'appartient pas (y compris inexistante)", async () => {
    const { error: notMineError } = await responderOwner.client
      .from("opportunity_responses")
      .insert({
        opportunity_id: opportunityId,
        responding_company_id: thirdPartyCompanyId,
        responding_user_id: responderOwner.id,
      });
    expect(notMineError).not.toBeNull();

    const { error: notExistError } = await responderOwner.client
      .from("opportunity_responses")
      .insert({
        opportunity_id: opportunityId,
        responding_company_id: "00000000-0000-0000-0000-000000000000",
        responding_user_id: responderOwner.id,
      });
    expect(notExistError).not.toBeNull();
  });

  it("l'entreprise éditrice ne peut pas répondre à sa propre opportunité", async () => {
    const { error } = await publisherOwner.client
      .from("opportunity_responses")
      .insert({
        opportunity_id: opportunityId,
        responding_company_id: publisherCompanyId,
        responding_user_id: publisherOwner.id,
      });
    expect(error).not.toBeNull();
  });

  it("une entreprise répond avec succès", async () => {
    const { data, error } = await responderOwner.client
      .from("opportunity_responses")
      .insert({
        opportunity_id: opportunityId,
        responding_company_id: responderCompanyId,
        responding_user_id: responderOwner.id,
        message:
          "Nous sommes un distributeur établi au Québec, très intéressés.",
      })
      .select("id, status")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("declared_interest");
    responseId = data!.id;
  });

  it("ne peut pas créer une deuxième réponse active pour la même entreprise/opportunité", async () => {
    const { error } = await responderOwner.client
      .from("opportunity_responses")
      .insert({
        opportunity_id: opportunityId,
        responding_company_id: responderCompanyId,
        responding_user_id: responderOwner.id,
      });
    expect(error).not.toBeNull();
  });
});

describe("Confidentialité des réponses", () => {
  it("un tiers ne peut pas consulter la réponse", async () => {
    const { data } = await thirdPartyOwner.client
      .from("opportunity_responses")
      .select("id")
      .eq("id", responseId);
    expect(data).toEqual([]);
  });

  it("un visiteur ne peut pas consulter la réponse", async () => {
    const visitor = anonClient();
    const { data } = await visitor
      .from("opportunity_responses")
      .select("id")
      .eq("id", responseId);
    expect(data).toEqual([]);
  });

  it("l'entreprise répondante peut consulter sa propre réponse", async () => {
    const { data, error } = await responderOwner.client
      .from("opportunity_responses")
      .select("id")
      .eq("id", responseId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("l'éditeur de l'opportunité peut consulter la réponse reçue", async () => {
    const { data, error } = await publisherOwner.client
      .from("opportunity_responses")
      .select("id, message")
      .eq("id", responseId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});

describe("Gestion des réponses (qui peut changer quoi)", () => {
  it("le répondant ne peut pas s'auto-accepter", async () => {
    const { error } = await responderOwner.client
      .from("opportunity_responses")
      .update({ status: "accepted" })
      .eq("id", responseId);
    expect(error).not.toBeNull();
  });

  it("l'éditeur ne peut pas modifier le message du répondant", async () => {
    const { error } = await publisherOwner.client
      .from("opportunity_responses")
      .update({ message: "modifié par le publieur" })
      .eq("id", responseId);
    expect(error).not.toBeNull();
  });

  it("l'éditeur accepte la réponse", async () => {
    const { error } = await publisherOwner.client
      .from("opportunity_responses")
      .update({ status: "accepted" })
      .eq("id", responseId);
    expect(error).toBeNull();
  });

  it("une notification a été créée pour le répondant", async () => {
    const { data } = await admin
      .from("notifications")
      .select("type")
      .eq("user_id", responderOwner.id)
      .eq("type", "opportunity_response_accepted");
    expect(data?.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Audit", () => {
  it("journalise la publication et l'acceptation sans exposer le message", async () => {
    const { data: oppLogs } = await admin
      .from("audit_logs")
      .select("action")
      .eq("entity_id", opportunityId);
    expect((oppLogs ?? []).map((l) => l.action)).toContain(
      "opportunity_status_changed",
    );

    const { data: responseLogs } = await admin
      .from("audit_logs")
      .select("before_summary, after_summary")
      .eq("entity_id", responseId);
    const serialized = JSON.stringify(responseLogs);
    expect(serialized).not.toContain("distributeur établi au Québec");
  });
});

describe("Expiration administrable", () => {
  it("expire_stale_opportunities() fait passer une opportunité expirée en statut expired", async () => {
    await admin
      .from("opportunities")
      .update({ expires_at: new Date(Date.now() - 86400000).toISOString() })
      .eq("id", opportunityId);
    const { data } = await admin.rpc("expire_stale_opportunities");
    expect(data).toBeGreaterThanOrEqual(1);
    const { data: opp } = await admin
      .from("opportunities")
      .select("status")
      .eq("id", opportunityId)
      .single();
    expect(opp?.status).toBe("expired");
  });

  it("une opportunité expirée reste consultable publiquement", async () => {
    const visitor = anonClient();
    const { data } = await visitor
      .from("opportunities")
      .select("id")
      .eq("id", opportunityId);
    expect(data?.length).toBe(1);
  });
});
