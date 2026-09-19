import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration réels (Phase 4) pour "Nous proposons" / "Nous
 * recherchons" : mêmes principes que tests/integration/rls.test.ts (vrai
 * projet Supabase, aucun mock), données créées puis supprimées à chaque
 * exécution.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
const testEmail = (label: string) =>
  `test-phase4-${RUN_ID}-${label}@example.com`;
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
let owner: Awaited<ReturnType<typeof createConfirmedUser>>;
let adminMember: Awaited<ReturnType<typeof createConfirmedUser>>;
let viewerMember: Awaited<ReturnType<typeof createConfirmedUser>>;
let outsider: Awaited<ReturnType<typeof createConfirmedUser>>;
let companyId: string;
let realProductId: string;
let offerId: string;

beforeAll(async () => {
  [owner, adminMember, viewerMember, outsider] = await Promise.all([
    createConfirmedUser("owner"),
    createConfirmedUser("admin"),
    createConfirmedUser("viewer"),
    createConfirmedUser("outsider"),
  ]);
  createdUserIds.push(owner.id, adminMember.id, viewerMember.id, outsider.id);

  const { data: company } = await owner.client
    .rpc("create_company", {
      p_legal_name: "Offres Besoins Test",
      p_display_name: `Offres Besoins Test ${RUN_ID}`,
      p_slug: `offres-besoins-test-${RUN_ID}`,
      p_country_code: "FR",
    })
    .single();
  companyId = (company as { id: string }).id;

  await admin.from("company_members").insert([
    {
      company_id: companyId,
      user_id: adminMember.id,
      role: "admin",
      status: "active",
      joined_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      user_id: viewerMember.id,
      role: "viewer",
      status: "active",
      joined_at: new Date().toISOString(),
    },
  ]);

  const { data: product } = await admin
    .from("products_services")
    .insert({
      type: "product",
      label_fr: `Produit test ${RUN_ID}`,
      label_en: `Test product ${RUN_ID}`,
      slug: `produit-test-${RUN_ID}`,
    })
    .select("id")
    .single();
  realProductId = product!.id;
}, 30000);

afterAll(async () => {
  await admin.from("companies").delete().eq("id", companyId);
  await admin.from("products_services").delete().eq("id", realProductId);
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("OWNER", () => {
  it("crée une offre", async () => {
    const { data, error } = await owner.client
      .from("company_offers")
      .insert({
        company_id: companyId,
        capability_type_code: "MANUFACTURER",
        title: "Offre test",
      })
      .select("id, status")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("active");
    offerId = data!.id;
  });

  it("crée un besoin", async () => {
    const { error } = await owner.client.from("company_needs").insert({
      company_id: companyId,
      capability_type_code: "DISTRIBUTOR",
      title: "Besoin test",
      target_country_code: "CA",
    });
    expect(error).toBeNull();
  });

  it("modifie l'offre", async () => {
    const { error } = await owner.client
      .from("company_offers")
      .update({ description: "Description mise à jour" })
      .eq("id", offerId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("company_offers")
      .select("description")
      .eq("id", offerId)
      .single();
    expect(data?.description).toBe("Description mise à jour");
  });

  it("désactive l'offre (offre inactive correctement traitée)", async () => {
    const { error } = await owner.client
      .from("company_offers")
      .update({ status: "inactive" })
      .eq("id", offerId);
    expect(error).toBeNull();
    // Toujours lisible par le propriétaire une fois inactive (pas supprimée).
    const { data, error: selectError } = await owner.client
      .from("company_offers")
      .select("status")
      .eq("id", offerId)
      .single();
    expect(selectError).toBeNull();
    expect(data?.status).toBe("inactive");
    await owner.client
      .from("company_offers")
      .update({ status: "active" })
      .eq("id", offerId);
  });

  it("rattache un produit existant, mais pas un produit inexistant", async () => {
    const { error: okError } = await owner.client
      .from("company_offer_products_services")
      .insert({ offer_id: offerId, product_service_id: realProductId });
    expect(okError).toBeNull();

    const { error: badError } = await owner.client
      .from("company_offer_products_services")
      .insert({
        offer_id: offerId,
        product_service_id: "00000000-0000-0000-0000-000000000000",
      });
    expect(badError).not.toBeNull();
  });
});

describe("Contraintes de données", () => {
  it("refuse un capability_type_code invalide", async () => {
    const { error } = await owner.client.from("company_offers").insert({
      company_id: companyId,
      capability_type_code: "NOT_A_REAL_TYPE",
    });
    expect(error).not.toBeNull();
  });

  it("refuse un code pays invalide (géographie)", async () => {
    const { error } = await owner.client.from("company_needs").insert({
      company_id: companyId,
      capability_type_code: "SERVICES",
      target_country_code: "FRA",
    });
    expect(error).not.toBeNull();
  });
});

describe("ADMIN", () => {
  it("peut gérer les offres/besoins de l'entreprise", async () => {
    const { error } = await adminMember.client.from("company_needs").insert({
      company_id: companyId,
      capability_type_code: "SUPPLIER",
      title: "Besoin ajouté par admin",
    });
    expect(error).toBeNull();
  });
});

describe("VIEWER", () => {
  it("ne peut pas créer d'offre", async () => {
    const { error } = await viewerMember.client
      .from("company_offers")
      .insert({ company_id: companyId, capability_type_code: "SERVICES" });
    expect(error).not.toBeNull();
  });

  it("ne peut pas modifier une offre existante", async () => {
    await viewerMember.client
      .from("company_offers")
      .update({ description: "Piraté" })
      .eq("id", offerId);
    const { data } = await admin
      .from("company_offers")
      .select("description")
      .eq("id", offerId)
      .single();
    expect(data?.description).not.toBe("Piraté");
  });

  it("peut consulter (lecture seule)", async () => {
    const { data, error } = await viewerMember.client
      .from("company_offers")
      .select("id")
      .eq("id", offerId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});

describe("Utilisateur externe", () => {
  it("ne peut rien modifier sur cette entreprise", async () => {
    const { error } = await outsider.client
      .from("company_needs")
      .insert({ company_id: companyId, capability_type_code: "SERVICES" });
    expect(error).not.toBeNull();
  });
});

describe("Visiteur non connecté", () => {
  it("ne peut pas écrire", async () => {
    const visitor = anonClient();
    const { error } = await visitor
      .from("company_offers")
      .insert({ company_id: companyId, capability_type_code: "SERVICES" });
    expect(error).not.toBeNull();
  });

  it("peut lire une offre active d'une entreprise active", async () => {
    await admin
      .from("companies")
      .update({ status: "active" })
      .eq("id", companyId);
    const visitor = anonClient();
    const { data, error } = await visitor
      .from("company_offers")
      .select("id")
      .eq("id", offerId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});

describe("Audit", () => {
  it("journalise la création et le changement de statut sans exposer le contenu libre", async () => {
    const { data } = await admin
      .from("audit_logs")
      .select("action, before_summary, after_summary")
      .eq("entity_id", offerId)
      .order("created_at");
    const actions = (data ?? []).map((r) => r.action);
    expect(actions).toContain("offer_created");
    expect(actions).toContain("offer_status_changed");
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("Description mise à jour");
  });
});
