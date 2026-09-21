import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 10C, LOT 10C-4) pour la publication
 * sécurisée d'une entreprise — migration 0026_secure_company_publication.sql.
 * NE PEUVENT PAS s'exécuter tant que cette migration n'est pas appliquée sur
 * le vrai projet Supabase (même situation que companyContacts.test.ts avant
 * 0025) : préparés à l'avance, échec attendu pour cette seule raison avant
 * application.
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
  const email = `test-10c4-${RUN_ID}-${label}@example.com`;
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

async function addMember(
  companyId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "viewer",
) {
  const { error } = await admin.from("company_members").insert({
    company_id: companyId,
    user_id: userId,
    role,
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Complète un profil pour satisfaire is_company_ready_for_publication(). */
async function completeProfile(companyId: string) {
  await admin.from("company_translations").upsert(
    { company_id: companyId, locale: "fr", description: "Description suffisamment complète." },
    { onConflict: "company_id,locale" },
  );
  await admin.from("company_industries").upsert(
    { company_id: companyId, industry_id: industryId, is_primary: true },
    { onConflict: "company_id,industry_id" },
  );
  const { data: existingLocation } = await admin
    .from("company_locations")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existingLocation) {
    await admin.from("company_locations").insert({
      company_id: companyId,
      location_type: "headquarters",
      is_primary: true,
      city: "Paris",
      country_code: "FR",
    });
  }
  await admin.from("company_offers").insert({
    company_id: companyId,
    capability_type_code: capabilityCode,
    target_country_code: "CA",
  });
}

async function makeProfileIncomplete(companyId: string) {
  await admin.from("company_offers").delete().eq("company_id", companyId);
  await admin.from("company_needs").delete().eq("company_id", companyId);
}

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

let owner: Awaited<ReturnType<typeof createConfirmedUser>>;
let admin_: Awaited<ReturnType<typeof createConfirmedUser>>;
let member: Awaited<ReturnType<typeof createConfirmedUser>>;
let viewer: Awaited<ReturnType<typeof createConfirmedUser>>;
let outsider: Awaited<ReturnType<typeof createConfirmedUser>>;
let platformAdmin: Awaited<ReturnType<typeof createConfirmedUser>>;
let platformAdmin2: Awaited<ReturnType<typeof createConfirmedUser>>;

let capabilityCode: string;
let industryId: string;

beforeAll(async () => {
  [owner, admin_, member, viewer, outsider, platformAdmin, platformAdmin2] =
    await Promise.all([
      createConfirmedUser("owner"),
      createConfirmedUser("admin"),
      createConfirmedUser("member"),
      createConfirmedUser("viewer"),
      createConfirmedUser("outsider"),
      createConfirmedUser("platform-admin"),
      createConfirmedUser("platform-admin-2"),
    ]);
  createdUserIds.push(
    owner.id,
    admin_.id,
    member.id,
    viewer.id,
    outsider.id,
    platformAdmin.id,
    platformAdmin2.id,
  );
  await admin
    .from("profiles")
    .update({ platform_role: "admin" })
    .in("id", [platformAdmin.id, platformAdmin2.id]);

  const { data: cap } = await admin
    .from("business_capability_types")
    .select("code")
    .eq("applies_to_offers", true)
    .limit(1)
    .single();
  capabilityCode = cap!.code;
  const { data: industry } = await admin
    .from("industries")
    .select("id")
    .limit(1)
    .single();
  industryId = industry!.id;
}, 30000);

afterAll(async () => {
  await admin
    .from("company_publication_requests")
    .delete()
    .in("company_id", createdCompanyIds);
  await admin.from("company_offers").delete().in("company_id", createdCompanyIds);
  await admin.from("company_needs").delete().in("company_id", createdCompanyIds);
  await admin.from("company_industries").delete().in("company_id", createdCompanyIds);
  await admin.from("company_locations").delete().in("company_id", createdCompanyIds);
  await admin.from("company_translations").delete().in("company_id", createdCompanyIds);
  await admin.from("company_members").delete().in("company_id", createdCompanyIds);
  await admin.from("companies").delete().in("id", createdCompanyIds);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

async function createDraftCompanyDirect(label: string) {
  const slug = `test-10c4-${label}-${RUN_ID}`;
  const { data, error } = await admin
    .from("companies")
    .insert({
      legal_name: `TEST 10C-4 ${label} ${RUN_ID}`,
      display_name: `TEST 10C-4 ${label} ${RUN_ID}`,
      slug,
      country_code: "FR",
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Création entreprise échouée");
  createdCompanyIds.push(data.id as string);
  return data.id as string;
}

describe("request_company_publication()", () => {
  it("A. profil incomplet -> PUBLICATION_PROFILE_INCOMPLETE", async () => {
    const companyId = await createDraftCompanyDirect("incomplete");
    await addMember(companyId, owner.id, "owner");
    const { error } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    expect(error?.message).toBe("PUBLICATION_PROFILE_INCOMPLETE");
  });

  it("B. profil complet -> pending", async () => {
    const companyId = await createDraftCompanyDirect("complete");
    await addMember(companyId, owner.id, "owner");
    await completeProfile(companyId);
    const { data, error } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("pending");
  });

  it("C. deux demandes concurrentes réelles -> une seule pending, l'autre PUBLICATION_ALREADY_PENDING", async () => {
    const companyId = await createDraftCompanyDirect("concurrent");
    await addMember(companyId, owner.id, "owner");
    await addMember(companyId, admin_.id, "admin");
    await completeProfile(companyId);

    const [ownerResult, adminResult] = await Promise.all([
      owner.client.rpc("request_company_publication", { p_company_id: companyId }),
      admin_.client.rpc("request_company_publication", { p_company_id: companyId }),
    ]);
    const results = [ownerResult, adminResult];
    const successes = results.filter((r) => !r.error);
    const failures = results.filter((r) => r.error);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error!.message).toBe("PUBLICATION_ALREADY_PENDING");

    const { count } = await admin
      .from("company_publication_requests")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending");
    expect(count).toBe(1);
  });

  it("H. suspended -> COMPANY_SUSPENDED, archived -> COMPANY_ARCHIVED", async () => {
    const suspendedId = await createDraftCompanyDirect("suspended");
    const archivedId = await createDraftCompanyDirect("archived");
    await admin.from("companies").update({ status: "suspended" }).eq("id", suspendedId);
    await admin.from("companies").update({ status: "archived" }).eq("id", archivedId);
    await addMember(suspendedId, owner.id, "owner");
    await addMember(archivedId, owner.id, "owner");

    const suspendedResult = await owner.client.rpc("request_company_publication", {
      p_company_id: suspendedId,
    });
    expect(suspendedResult.error?.message).toBe("COMPANY_SUSPENDED");

    const archivedResult = await owner.client.rpc("request_company_publication", {
      p_company_id: archivedId,
    });
    expect(archivedResult.error?.message).toBe("COMPANY_ARCHIVED");
  });

  it("déjà active -> ALREADY_PUBLISHED", async () => {
    const companyId = await createDraftCompanyDirect("already-active");
    await admin.from("companies").update({ status: "active" }).eq("id", companyId);
    await addMember(companyId, owner.id, "owner");
    const { error } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    expect(error?.message).toBe("ALREADY_PUBLISHED");
  });

  it("I. member/viewer/tiers ne peuvent pas demander la publication -> NOT_AUTHORIZED", async () => {
    const companyId = await createDraftCompanyDirect("not-authorized");
    await addMember(companyId, owner.id, "owner");
    await addMember(companyId, member.id, "member");
    await addMember(companyId, viewer.id, "viewer");
    await completeProfile(companyId);

    for (const client of [member.client, viewer.client, outsider.client]) {
      const { error } = await client.rpc("request_company_publication", {
        p_company_id: companyId,
      });
      expect(error?.message).toBe("NOT_AUTHORIZED");
    }
  });
});

describe("review_company_publication_request()", () => {
  it("D+E. profil redevenu incomplet -> APPROVE échoue, demande reste pending, company reste draft ; recomplété -> le même APPROVE réussit", async () => {
    const companyId = await createDraftCompanyDirect("revalidate");
    await addMember(companyId, owner.id, "owner");
    await completeProfile(companyId);
    const { data: reqData } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    const requestId = (reqData as { id: string }).id;

    await makeProfileIncomplete(companyId);
    const approveAttempt = await platformAdmin.client.rpc(
      "review_company_publication_request",
      { p_request_id: requestId, p_decision: "approved", p_note: null },
    );
    expect(approveAttempt.error?.message).toBe("PUBLICATION_PROFILE_INCOMPLETE");

    const { data: stillPending } = await admin
      .from("company_publication_requests")
      .select("status, reviewed_at, reviewed_by")
      .eq("id", requestId)
      .single();
    expect(stillPending?.status).toBe("pending");
    expect(stillPending?.reviewed_at).toBeNull();
    expect(stillPending?.reviewed_by).toBeNull();

    const { data: stillDraft } = await admin
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .single();
    expect(stillDraft?.status).toBe("draft");

    // Recomplète : le MÊME APPROVE doit ensuite réussir.
    await admin.from("company_offers").insert({
      company_id: companyId,
      capability_type_code: capabilityCode,
      target_country_code: "CA",
    });
    const approveRetry = await platformAdmin.client.rpc(
      "review_company_publication_request",
      { p_request_id: requestId, p_decision: "approved", p_note: null },
    );
    expect(approveRetry.error).toBeNull();
    expect((approveRetry.data as { status: string }).status).toBe("approved");

    const { data: nowActive } = await admin
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .single();
    expect(nowActive?.status).toBe("active");
  });

  it("F. deux admins concurrents (approve vs reject) -> une seule décision gagne", async () => {
    const companyId = await createDraftCompanyDirect("concurrent-review");
    await addMember(companyId, owner.id, "owner");
    await completeProfile(companyId);
    const { data: reqData } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    const requestId = (reqData as { id: string }).id;

    const [approveResult, rejectResult] = await Promise.all([
      platformAdmin.client.rpc("review_company_publication_request", {
        p_request_id: requestId,
        p_decision: "approved",
        p_note: null,
      }),
      platformAdmin2.client.rpc("review_company_publication_request", {
        p_request_id: requestId,
        p_decision: "rejected",
        p_note: "trop tard",
      }),
    ]);
    const outcomes = [approveResult, rejectResult];
    const successes = outcomes.filter((r) => !r.error);
    const failures = outcomes.filter((r) => r.error);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error!.message).toBe("PUBLICATION_REQUEST_ALREADY_REVIEWED");

    const { data: finalRequest } = await admin
      .from("company_publication_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    expect(["approved", "rejected"]).toContain(finalRequest?.status);
  });

  it("G. REJECT + review_note visible, nouvelle demande possible après correction", async () => {
    const companyId = await createDraftCompanyDirect("reject-resubmit");
    await addMember(companyId, owner.id, "owner");
    await completeProfile(companyId);
    const { data: reqData } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    const requestId = (reqData as { id: string }).id;

    const rejectResult = await platformAdmin.client.rpc(
      "review_company_publication_request",
      {
        p_request_id: requestId,
        p_decision: "rejected",
        p_note: "Merci de préciser votre description.",
      },
    );
    expect(rejectResult.error).toBeNull();
    expect((rejectResult.data as { status: string }).status).toBe("rejected");

    const { data: companyAfterReject } = await admin
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .single();
    expect(companyAfterReject?.status).toBe("draft");

    const { data: noteVisible } = await owner.client
      .from("company_publication_requests")
      .select("review_note")
      .eq("id", requestId)
      .single();
    expect(noteVisible?.review_note).toBe("Merci de préciser votre description.");

    // review_note jamais dans audit_logs.
    const { data: auditRows } = await admin
      .from("audit_logs")
      .select("before_summary, after_summary")
      .eq("entity_id", companyId)
      .eq("action", "company_publication_rejected");
    const auditText = JSON.stringify(auditRows ?? []);
    expect(auditText).not.toContain("préciser votre description");

    const secondRequest = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    expect(secondRequest.error).toBeNull();
    expect((secondRequest.data as { status: string }).status).toBe("pending");
  });

  it("platform admin uniquement — un tiers ne peut pas review -> NOT_AUTHORIZED", async () => {
    const companyId = await createDraftCompanyDirect("review-not-authorized");
    await addMember(companyId, owner.id, "owner");
    await completeProfile(companyId);
    const { data: reqData } = await owner.client.rpc("request_company_publication", {
      p_company_id: companyId,
    });
    const requestId = (reqData as { id: string }).id;

    const { error } = await owner.client.rpc("review_company_publication_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_note: null,
    });
    expect(error?.message).toBe("NOT_AUTHORIZED");
  });
});

describe("company_publication_requests — RLS lecture", () => {
  /**
   * Insère la ligne DIRECTEMENT via le client admin (service_role, RLS
   * contournée), plutôt que via request_company_publication() : ces tests
   * de LECTURE ne doivent dépendre que de la politique SELECT elle-même,
   * jamais de la disponibilité de la RPC d'écriture.
   */
  async function insertPendingRequestFixture(label: string) {
    const companyId = await createDraftCompanyDirect(label);
    const { data, error } = await admin
      .from("company_publication_requests")
      .insert({ company_id: companyId, requested_by: owner.id })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Fixture insert échouée");
    return { companyId, requestId: data.id as string };
  }

  it("owner/admin/member/viewer/platform admin voient la demande", async () => {
    const { companyId, requestId } = await insertPendingRequestFixture("rls-read-positive");
    await addMember(companyId, owner.id, "owner");
    await addMember(companyId, admin_.id, "admin");
    await addMember(companyId, member.id, "member");
    await addMember(companyId, viewer.id, "viewer");

    for (const [label, client] of [
      ["owner", owner.client],
      ["admin", admin_.client],
      ["member", member.client],
      ["viewer", viewer.client],
      ["platform admin", platformAdmin.client],
    ] as const) {
      const { data } = await client
        .from("company_publication_requests")
        .select("id")
        .eq("id", requestId)
        .maybeSingle();
      expect(data, `${label} devrait voir la demande`).not.toBeNull();
    }
  });

  it("M. anon ne voit aucune ligne de company_publication_requests", async () => {
    const { requestId } = await insertPendingRequestFixture("rls-read-anon");
    const { data, error } = await anonClient()
      .from("company_publication_requests")
      .select("id")
      .eq("id", requestId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("N. tiers authentifié (aucun rôle sur l'entreprise) ne voit aucune ligne de company_publication_requests", async () => {
    const { requestId } = await insertPendingRequestFixture("rls-read-outsider");
    const { data, error } = await outsider.client
      .from("company_publication_requests")
      .select("id")
      .eq("id", requestId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("aucune écriture directe possible (pas de politique INSERT/UPDATE pour authenticated)", async () => {
    const companyId = await createDraftCompanyDirect("rls-write");
    await addMember(companyId, owner.id, "owner");
    const { error, data } = await owner.client
      .from("company_publication_requests")
      .insert({ company_id: companyId, requested_by: owner.id })
      .select();
    // RLS silencieuse (aucune politique INSERT) : soit une erreur, soit
    // aucune ligne créée — jamais une insertion réussie.
    if (!error) {
      expect(data ?? []).toEqual([]);
    }
  });
});

describe("protection de companies.status", () => {
  it("H. owner/admin tentent UPDATE status='active' -> refus explicite, 0 ligne affectée, status inchangé", async () => {
    const companyId = await createDraftCompanyDirect("protect-status-owner-admin");
    await addMember(companyId, owner.id, "owner");
    await addMember(companyId, admin_.id, "admin");

    // owner/admin : RLS les laisse atteindre la ligne (companies_update_
    // owner_admin), c'est le TRIGGER qui rejette explicitement — vérifié
    // à la fois par l'erreur ET par une relecture explicite de status.
    for (const [label, client] of [
      ["owner", owner.client],
      ["admin", admin_.client],
    ] as const) {
      const { error, data, count } = await client
        .from("companies")
        .update({ status: "active" }, { count: "exact" })
        .eq("id", companyId)
        .select("id");
      expect(error, `${label} devrait être rejeté par le trigger`).not.toBeNull();
      expect(count ?? 0, `${label} : 0 ligne affectée`).toBe(0);
      expect(data ?? [], `${label} : aucune ligne retournée`).toEqual([]);

      const { data: reread } = await admin
        .from("companies")
        .select("status")
        .eq("id", companyId)
        .single();
      expect(reread?.status, `${label} : status inchangé après tentative`).toBe("draft");
    }
  });

  it("I. member/viewer/tiers tentent UPDATE status='active' -> 0 ligne affectée (RLS silencieuse), status inchangé", async () => {
    const companyId = await createDraftCompanyDirect("protect-status-member-viewer-tiers");
    await addMember(companyId, owner.id, "owner");
    await addMember(companyId, member.id, "member");
    await addMember(companyId, viewer.id, "viewer");

    // member/viewer/tiers : RLS (companies_update_owner_admin) ne leur
    // donne même pas accès à LA LIGNE en écriture — 0 ligne affectée,
    // jamais une exception explicite (même principe que "un utilisateur
    // ne peut PAS modifier claim_status directement", Phase 7). Vérifié
    // explicitement par le compte de lignes affectées (.select() avec
    // count:'exact' après un UPDATE renvoie les lignes réellement
    // modifiées) ET par une relecture indépendante via le client admin,
    // pour chaque acteur séparément.
    for (const [label, client] of [
      ["member", member.client],
      ["viewer", viewer.client],
      ["tiers", outsider.client],
    ] as const) {
      const { error, data, count } = await client
        .from("companies")
        .update({ status: "active" }, { count: "exact" })
        .eq("id", companyId)
        .select("id");
      expect(error, `${label} : aucune exception (RLS silencieuse)`).toBeNull();
      expect(count ?? 0, `${label} : 0 ligne affectée`).toBe(0);
      expect(data ?? [], `${label} : aucune ligne retournée`).toEqual([]);

      const { data: reread } = await admin
        .from("companies")
        .select("status")
        .eq("id", companyId)
        .single();
      expect(reread?.status, `${label} : status inchangé après tentative`).toBe("draft");
    }
  });

  it("platform admin : UPDATE status='active' autorisé (mécanisme de secours validé), tracé dans audit_logs", async () => {
    const companyId = await createDraftCompanyDirect("protect-status-platform-admin");
    await addMember(companyId, owner.id, "owner");

    const { error: adminError, count } = await platformAdmin.client
      .from("companies")
      .update({ status: "active" }, { count: "exact" })
      .eq("id", companyId)
      .select("id");
    expect(adminError).toBeNull();
    expect(count).toBe(1);

    const { data: nowActive } = await admin
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .single();
    expect(nowActive?.status).toBe("active");

    const { data: auditRows } = await admin
      .from("audit_logs")
      .select("id")
      .eq("entity_id", companyId)
      .eq("action", "company_platform_fields_changed");
    expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("parcours libre-service complet (draft -> publication -> matching -> partnership_request)", () => {
  it("aucune écriture directe de status via la clé de service pour franchir le parcours, sauf l'action admin officielle", async () => {
    const e2eOwner = await createConfirmedUser("e2e-owner");
    createdUserIds.push(e2eOwner.id);

    const { data: created, error: createError } = await e2eOwner.client.rpc(
      "create_company",
      {
        p_legal_name: `TEST 10C-4 E2E ${RUN_ID}`,
        p_display_name: `TEST 10C-4 E2E ${RUN_ID}`,
        p_slug: `test-10c4-e2e-${RUN_ID}`,
        p_country_code: "FR",
      },
    );
    expect(createError).toBeNull();
    const companyId = (created as { id: string }).id;
    createdCompanyIds.push(companyId);

    const { data: draftRow } = await admin
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .single();
    expect(draftRow?.status).toBe("draft");

    await completeProfile(companyId);

    const { data: reqData, error: reqError } = await e2eOwner.client.rpc(
      "request_company_publication",
      { p_company_id: companyId },
    );
    expect(reqError).toBeNull();
    expect((reqData as { status: string }).status).toBe("pending");

    const approveResult = await platformAdmin.client.rpc(
      "review_company_publication_request",
      {
        p_request_id: (reqData as { id: string }).id,
        p_decision: "approved",
        p_note: null,
      },
    );
    expect(approveResult.error).toBeNull();

    const { data: activeRow } = await admin
      .from("companies")
      .select("status, slug")
      .eq("id", companyId)
      .single();
    expect(activeRow?.status).toBe("active");

    // Fiche publique visible.
    const { data: publicRow } = await anonClient()
      .from("companies")
      .select("id")
      .eq("slug", activeRow!.slug)
      .eq("status", "active")
      .maybeSingle();
    expect(publicRow).not.toBeNull();

    // partnership_request possible : une AUTRE entreprise active envoie une
    // demande vers celle-ci (cible désormais active).
    const requesterId = await createDraftCompanyDirect("e2e-requester");
    await admin.from("companies").update({ status: "active" }).eq("id", requesterId);
    await addMember(requesterId, outsider.id, "owner");
    const partnershipResult = await outsider.client.rpc("create_partnership_request", {
      p_requester_company_id: requesterId,
      p_target_company_id: companyId,
      p_subject: "Sujet test E2E",
      p_message: "Message test E2E",
    });
    expect(partnershipResult.error).toBeNull();
    expect(["pending", "pending_unclaimed"]).toContain(
      (partnershipResult.data as { status: string }).status,
    );
  });
});

describe("companies — resserrement de l'INSERT direct (status/verification_status/subscription_level)", () => {
  function directInsertPayload(label: string, extra: Record<string, unknown>) {
    return {
      legal_name: `TEST 10C-4 ${label} ${RUN_ID}`,
      display_name: `TEST 10C-4 ${label} ${RUN_ID}`,
      slug: `test-10c4-${label}-${RUN_ID}`,
      country_code: "FR",
      ...extra,
    };
  }

  // O/P/Q : PAS de .select() enchaîné sur l'insert — PostgREST demanderait
  // alors une représentation de la ligne (Prefer: return=representation),
  // ce qui réévalue la politique SELECT (companies_select_public_active)
  // au moment même de l'INSERT. Or cette politique répond TRUE dès que
  // status = 'active', indépendamment de la politique d'INSERT testée ici
  // (voir le test O ci-dessous, qui a justement status='active') ; pour
  // verification_status/subscription_level (status reste 'draft', voir P
  // et Q), le membre n'est pas encore attaché (trigger AFTER INSERT pas
  // encore visible pour ce SELECT) et le RETURNING échouerait pour une
  // raison totalement indépendante du resserrement testé, produisant un
  // faux positif AVANT même l'application de 0026. Ne tester QUE l'erreur
  // de l'INSERT lui-même isole proprement le comportement voulu.
  /**
   * Tente l'INSERT puis, QUOI QU'IL ARRIVE (même si l'insertion réussit
   * de façon inattendue — ex. avant application de 0026), retrouve et
   * enregistre la ligne pour nettoyage : ces tests ne doivent jamais
   * pouvoir laisser une entreprise TEST orpheline en base selon l'état de
   * la migration.
   */
  async function attemptInsertAndTrack(payload: ReturnType<typeof directInsertPayload>) {
    const { error } = await owner.client.from("companies").insert(payload);
    const { data: row } = await admin
      .from("companies")
      .select("id")
      .eq("slug", payload.slug)
      .maybeSingle();
    if (row) createdCompanyIds.push(row.id as string);
    return { error, created: Boolean(row) };
  }

  it("O. INSERT direct avec status='active' -> refus RLS, aucune ligne créée", async () => {
    const payload = directInsertPayload("insert-status", { status: "active" });
    const { error, created } = await attemptInsertAndTrack(payload);
    expect(error).not.toBeNull();
    expect(created).toBe(false);
  });

  it("P. INSERT direct avec verification_status='verified' -> refus RLS, aucune ligne créée", async () => {
    const payload = directInsertPayload("insert-verif", { verification_status: "verified" });
    const { error, created } = await attemptInsertAndTrack(payload);
    expect(error).not.toBeNull();
    expect(created).toBe(false);
  });

  it("Q. INSERT direct avec subscription_level='business' -> refus RLS, aucune ligne créée", async () => {
    const payload = directInsertPayload("insert-sub", { subscription_level: "business" });
    const { error, created } = await attemptInsertAndTrack(payload);
    expect(error).not.toBeNull();
    expect(created).toBe(false);
  });

  it("R. INSERT direct avec les valeurs par défaut (aucun des 3 champs fourni) -> succès", async () => {
    const payload = directInsertPayload("insert-default", {});
    // Pas de .select() enchaîné sur l'insert : PostgREST demande alors une
    // représentation de la ligne (Prefer: return=representation), ce qui
    // réévalue la politique SELECT (companies_select_public_active) au
    // moment même de l'INSERT — avant que le trigger AFTER INSERT
    // (handle_new_company, 0002) n'ait attaché owner comme membre. Ce
    // n'est pas un effet du resserrement de ce lot (même comportement
    // avant 0026) : on vérifie donc le résultat via une requête séparée,
    // après que la transaction d'insertion (et son trigger) soit terminée.
    const { error } = await owner.client.from("companies").insert(payload);
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("companies")
      .select("id, status, verification_status, subscription_level")
      .eq("slug", payload.slug)
      .single();
    expect(row).not.toBeNull();
    createdCompanyIds.push(row!.id as string);
    expect(row!.status).toBe("draft");
    expect(row!.verification_status).toBe("unverified");
    expect(row!.subscription_level).toBe("free");

    // Confirme aussi que owner a bien été attaché comme membre par le
    // trigger AFTER INSERT, maintenant visible dans une requête séparée.
    const { data: ownRow } = await owner.client
      .from("companies")
      .select("id")
      .eq("slug", payload.slug)
      .maybeSingle();
    expect(ownRow).not.toBeNull();
  });

  it("S. create_company() fonctionne toujours normalement après le resserrement RLS", async () => {
    const { data, error } = await owner.client.rpc("create_company", {
      p_legal_name: `TEST 10C-4 create-company-after-rls ${RUN_ID}`,
      p_display_name: `TEST 10C-4 create-company-after-rls ${RUN_ID}`,
      p_slug: `test-10c4-create-company-after-rls-${RUN_ID}`,
      p_country_code: "FR",
    });
    expect(error).toBeNull();
    const companyId = (data as { id: string }).id;
    createdCompanyIds.push(companyId);

    const { data: row } = await admin
      .from("companies")
      .select("status, verification_status, subscription_level")
      .eq("id", companyId)
      .single();
    expect(row?.status).toBe("draft");
    expect(row?.verification_status).toBe("unverified");
    expect(row?.subscription_level).toBe("free");
  });

  it("admin_is_company_ready_for_publication() renvoie une ERREUR (pas false) pour un non-admin", async () => {
    const companyId = await createDraftCompanyDirect("admin-ready-oracle-check");
    const { data, error } = await owner.client.rpc(
      "admin_is_company_ready_for_publication",
      { p_company_id: companyId },
    );
    expect(error?.message).toBe("NOT_AUTHORIZED");
    expect(data).toBeNull();
  });
});
