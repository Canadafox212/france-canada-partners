import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 10C, LOT 10C-3) pour company_contacts —
 * migration 0025_protect_company_contacts.sql. NE PEUVENT PAS s'exécuter
 * tant que cette migration n'est pas appliquée sur le vrai projet Supabase
 * (même situation que tests/integration/partnershipRequests.test.ts avant
 * 0023, ou duplicateSearch.test.ts avant 0024 — préparés à l'avance).
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

async function createConfirmedUser(label: string, customEmail?: string) {
  const email = customEmail ?? `test-10c3-${RUN_ID}-${label}@example.com`;
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

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

let owner: Awaited<ReturnType<typeof createConfirmedUser>>;
let admin_: Awaited<ReturnType<typeof createConfirmedUser>>;
let member: Awaited<ReturnType<typeof createConfirmedUser>>;
let viewer: Awaited<ReturnType<typeof createConfirmedUser>>;
let outsider: Awaited<ReturnType<typeof createConfirmedUser>>;
let platformAdmin: Awaited<ReturnType<typeof createConfirmedUser>>;

let companyId: string;

beforeAll(async () => {
  [owner, admin_, member, viewer, outsider, platformAdmin] = await Promise.all([
    createConfirmedUser("owner"),
    createConfirmedUser("admin"),
    createConfirmedUser("member"),
    createConfirmedUser("viewer"),
    createConfirmedUser("outsider"),
    createConfirmedUser("platform-admin"),
  ]);
  createdUserIds.push(
    owner.id,
    admin_.id,
    member.id,
    viewer.id,
    outsider.id,
    platformAdmin.id,
  );
  await admin.from("profiles").update({ platform_role: "admin" }).eq("id", platformAdmin.id);

  companyId = await createActiveCompany(`TEST 10C-3 Company ${RUN_ID}`);
  createdCompanyIds.push(companyId);
  await addMember(companyId, owner.id, "owner");
  await addMember(companyId, admin_.id, "admin");
  await addMember(companyId, member.id, "member");
  await addMember(companyId, viewer.id, "viewer");

  await admin.from("company_contacts").insert({
    company_id: companyId,
    professional_email: `contact-${RUN_ID}@example.com`,
    phone: "+33100000000",
  });
}, 30000);

afterAll(async () => {
  await admin.from("company_contacts").delete().in("company_id", createdCompanyIds);
  await admin.from("company_members").delete().in("company_id", createdCompanyIds);
  await admin.from("companies").delete().in("id", createdCompanyIds);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("company_contacts — lecture (RLS)", () => {
  it("owner peut lire", async () => {
    const { data, error } = await owner.client
      .from("company_contacts")
      .select("professional_email, phone")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.professional_email).toBe(`contact-${RUN_ID}@example.com`);
  });

  it("admin peut lire", async () => {
    const { data, error } = await admin_.client
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("member peut lire", async () => {
    const { data, error } = await member.client
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("viewer peut lire", async () => {
    const { data, error } = await viewer.client
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("platform admin peut lire", async () => {
    const { data, error } = await platformAdmin.client
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("un tiers authentifié ne voit rien", async () => {
    const { data } = await outsider.client
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("anon ne voit rien", async () => {
    const { data } = await anonClient()
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

describe("company_contacts — écriture (RLS)", () => {
  it("owner peut modifier", async () => {
    const { error } = await owner.client
      .from("company_contacts")
      .update({ phone: "+33100000001" })
      .eq("company_id", companyId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("company_contacts")
      .select("phone")
      .eq("company_id", companyId)
      .single();
    expect(data?.phone).toBe("+33100000001");
  });

  it("admin peut modifier", async () => {
    const { error } = await admin_.client
      .from("company_contacts")
      .update({ phone: "+33100000002" })
      .eq("company_id", companyId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("company_contacts")
      .select("phone")
      .eq("company_id", companyId)
      .single();
    expect(data?.phone).toBe("+33100000002");
  });

  it("member NE PEUT PAS modifier", async () => {
    await member.client
      .from("company_contacts")
      .update({ phone: "+33199999999" })
      .eq("company_id", companyId);
    const { data } = await admin
      .from("company_contacts")
      .select("phone")
      .eq("company_id", companyId)
      .single();
    expect(data?.phone).not.toBe("+33199999999");
  });

  it("viewer NE PEUT PAS modifier", async () => {
    await viewer.client
      .from("company_contacts")
      .update({ phone: "+33188888888" })
      .eq("company_id", companyId);
    const { data } = await admin
      .from("company_contacts")
      .select("phone")
      .eq("company_id", companyId)
      .single();
    expect(data?.phone).not.toBe("+33188888888");
  });

  it("un tiers NE PEUT PAS modifier", async () => {
    await outsider.client
      .from("company_contacts")
      .update({ phone: "+33177777777" })
      .eq("company_id", companyId);
    const { data } = await admin
      .from("company_contacts")
      .select("phone")
      .eq("company_id", companyId)
      .single();
    expect(data?.phone).not.toBe("+33177777777");
  });

  it("aucun DELETE normal : owner ne peut que mettre à NULL, jamais supprimer la ligne", async () => {
    const { error } = await owner.client
      .from("company_contacts")
      .delete()
      .eq("company_id", companyId);
    // Sans politique DELETE, la ligne n'est simplement pas supprimée
    // (0 ligne affectée) plutôt qu'une erreur explicite.
    void error;
    const { data } = await admin
      .from("company_contacts")
      .select("company_id")
      .eq("company_id", companyId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it("owner peut mettre les coordonnées à NULL (méthode de suppression prévue)", async () => {
    const { error } = await owner.client
      .from("company_contacts")
      .update({ professional_email: null, phone: null })
      .eq("company_id", companyId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("company_contacts")
      .select("professional_email, phone")
      .eq("company_id", companyId)
      .single();
    expect(data?.professional_email).toBeNull();
    expect(data?.phone).toBeNull();
  });
});

describe("Colonnes legacy companies.professional_email/phone — neutralisées", () => {
  it("toute valeur non nulle est rejetée par la contrainte CHECK", async () => {
    const { error } = await admin
      .from("companies")
      .update({ professional_email: "leak@example.com" })
      .eq("id", companyId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/companies_professional_email_legacy_null/);
  });

  it("phone non nul est également rejeté", async () => {
    const { error } = await admin
      .from("companies")
      .update({ phone: "+33100000099" })
      .eq("id", companyId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/companies_phone_legacy_null/);
  });

  it("la valeur NULL explicite reste acceptée (aucune régression sur les écritures normales)", async () => {
    const { error } = await admin
      .from("companies")
      .update({ professional_email: null, phone: null })
      .eq("id", companyId);
    expect(error).toBeNull();
  });
});

describe("create_company() — écrit dans company_contacts, jamais dans companies", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    await admin.from("company_contacts").delete().in("company_id", createdIds);
    await admin.from("company_members").delete().in("company_id", createdIds);
    await admin.from("companies").delete().in("id", createdIds);
  });

  it("professional_email/phone finissent dans company_contacts, companies reste NULL", async () => {
    const { data, error } = await owner.client.rpc("create_company", {
      p_legal_name: `Nouvelle Entreprise ${RUN_ID}`,
      p_display_name: `Nouvelle Entreprise ${RUN_ID}`,
      p_slug: `nouvelle-entreprise-10c3-${RUN_ID}`,
      p_country_code: "FR",
      p_professional_email: `nouvelle-${RUN_ID}@example.com`,
      p_phone: "+33100000123",
    });
    expect(error).toBeNull();
    const newId = data.id;
    createdIds.push(newId);

    const { data: companyRow } = await admin
      .from("companies")
      .select("professional_email, phone")
      .eq("id", newId)
      .single();
    expect(companyRow?.professional_email).toBeNull();
    expect(companyRow?.phone).toBeNull();

    const { data: contactRow } = await admin
      .from("company_contacts")
      .select("professional_email, phone")
      .eq("company_id", newId)
      .single();
    expect(contactRow?.professional_email).toBe(`nouvelle-${RUN_ID}@example.com`);
    expect(contactRow?.phone).toBe("+33100000123");
  });
});

describe("submit_company_claim() — non-régression après migration (lit company_contacts)", () => {
  const createdIds: string[] = [];
  const createdClaimantIds: string[] = [];

  afterAll(async () => {
    await admin.from("company_claims").delete().in("company_id", createdIds);
    await admin.from("company_contacts").delete().in("company_id", createdIds);
    await admin.from("company_members").delete().in("company_id", createdIds);
    await admin.from("companies").delete().in("id", createdIds);
    for (const id of createdClaimantIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("auto-approbation (domaine fort, compte réel du même domaine, 0 membre) fonctionne toujours à l'identique", async () => {
    const domain = `domaine-fort-10c3-${RUN_ID}.example`;
    const co = await createActiveCompany(`Domaine Fort 10C-3 ${RUN_ID}`);
    createdIds.push(co);
    await admin.from("company_contacts").insert({
      company_id: co,
      professional_email: `contact@${domain}`,
    });

    // Le compte réel de connexion (auth.users.email) partage le MÊME
    // domaine que la demande — condition nécessaire à l'auto-approbation
    // (§19 : le champ soumis dans le formulaire seul ne suffit jamais).
    const claimant = await createConfirmedUser("claimant-domain", `nouveau@${domain}`);
    createdClaimantIds.push(claimant.id);
    const { data, error } = await claimant.client.rpc("submit_company_claim", {
      p_company_id: co,
      p_professional_email: `nouveau@${domain}`,
    });
    expect(error).toBeNull();
    expect(data.status).toBe("approved");

    const { data: memberRow } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", co)
      .eq("user_id", claimant.id)
      .single();
    expect(memberRow?.role).toBe("owner");
  });

  it("aucune coordonnée dans company_contacts -> reste 'pending' (comportement inchangé)", async () => {
    const co = await createActiveCompany(`Sans Contact 10C-3 ${RUN_ID}`);
    createdIds.push(co);
    const claimant = await createConfirmedUser(`claimant-nocontact-${RUN_ID}`);
    createdClaimantIds.push(claimant.id);
    const { data, error } = await claimant.client.rpc("submit_company_claim", {
      p_company_id: co,
      p_professional_email: `moi@sans-contact-10c3-${RUN_ID}.example`,
    });
    expect(error).toBeNull();
    expect(data.status).toBe("pending");
  });
});
