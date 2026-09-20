import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCompatibilityBetweenCompanies } from "@/lib/matching/service";

/**
 * Tests d'intégration réels (Phase 7) pour l'annuaire public (recherche,
 * fiche, compatibilité) et la revendication d'entreprise. Même principe que
 * les suites précédentes : vrai projet Supabase, aucun mock, nettoyage
 * systématique. Complète la validation locale (pglite, qui ne peut pas
 * vérifier l'application réelle de la RLS) — voir
 * supabase/migrations/0017_public_directory_search.sql et
 * 0018_company_claims.sql.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
const testEmail = (label: string) =>
  `test-phase7-${RUN_ID}-${label}@example.com`;
const TEST_PASSWORD = "MotDePasseTest123!";

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient(): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(label: string, email?: string) {
  const finalEmail = email ?? testEmail(label);
  const { data, error } = await admin.auth.admin.createUser({
    email: finalEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error("Création utilisateur échouée");
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: finalEmail,
    password: TEST_PASSWORD,
  });
  if (signInError) throw signInError;
  return { id: data.user.id, email: finalEmail, client };
}

async function createCompany(
  owner: Awaited<ReturnType<typeof createConfirmedUser>> | null,
  label: string,
  countryCode: string,
  extra: Record<string, unknown> = {},
) {
  const slug = `${label.toLowerCase().replace(/\s+/g, "-")}-${RUN_ID}`;
  if (owner) {
    const { data } = await owner.client
      .rpc("create_company", {
        p_legal_name: `${label} ${RUN_ID}`,
        p_display_name: `${label} ${RUN_ID}`,
        p_slug: slug,
        p_country_code: countryCode,
      })
      .single();
    const id = (data as { id: string }).id;
    await admin
      .from("companies")
      .update({ status: "active", ...extra })
      .eq("id", id);
    return id;
  }
  const { data } = await admin
    .from("companies")
    .insert({
      legal_name: `${label} ${RUN_ID}`,
      display_name: `${label} ${RUN_ID}`,
      slug,
      country_code: countryCode,
      status: "active",
      ...extra,
    })
    .select("id")
    .single();
  return (data as { id: string }).id;
}

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

let ownerA: Awaited<ReturnType<typeof createConfirmedUser>>;
let claimant: Awaited<ReturnType<typeof createConfirmedUser>>;
let spoofer: Awaited<ReturnType<typeof createConfirmedUser>>;
let thirdParty: Awaited<ReturnType<typeof createConfirmedUser>>;
let platformAdmin: Awaited<ReturnType<typeof createConfirmedUser>>;

let unclaimedCompanyId: string;
let unclaimedCompanySlug: string;
let inactiveCompanyId: string;

beforeAll(async () => {
  const claimantDomain = `nordique-${RUN_ID}.example`;
  [ownerA, claimant, spoofer, thirdParty, platformAdmin] = await Promise.all([
    createConfirmedUser("owner-a"),
    createConfirmedUser("claimant", `nouveau@${claimantDomain}`),
    createConfirmedUser("spoofer"),
    createConfirmedUser("third"),
    createConfirmedUser("admin"),
  ]);
  createdUserIds.push(
    ownerA.id,
    claimant.id,
    spoofer.id,
    thirdParty.id,
    platformAdmin.id,
  );
  await admin
    .from("profiles")
    .update({ platform_role: "admin" })
    .eq("id", platformAdmin.id);

  const label = `Recherche Directoire ${RUN_ID}`;
  unclaimedCompanySlug = `recherche-directoire-${RUN_ID}`;
  const { data: company } = await admin
    .from("companies")
    .insert({
      legal_name: label,
      display_name: label,
      slug: unclaimedCompanySlug,
      country_code: "CA",
      professional_email: `contact@${claimantDomain}`,
      status: "active",
    })
    .select("id")
    .single();
  unclaimedCompanyId = (company as { id: string }).id;
  createdCompanyIds.push(unclaimedCompanyId);
  await admin.from("company_locations").insert({
    company_id: unclaimedCompanyId,
    location_type: "headquarters",
    is_primary: true,
    region: "Québec",
    city: "Québec",
    country_code: "CA",
  });

  inactiveCompanyId = await createCompany(
    null,
    "Entreprise Brouillon Test",
    "FR",
    { status: "draft" },
  );
  createdCompanyIds.push(inactiveCompanyId);
}, 60000);

afterAll(async () => {
  for (const id of createdCompanyIds) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("Recherche publique (§36)", () => {
  it("un visiteur non authentifié trouve une entreprise active par son nom", async () => {
    const anon = anonClient();
    const { data, error } = await anon.rpc("search_companies", {
      p_query: `Recherche Directoire ${RUN_ID}`,
    });
    expect(error).toBeNull();
    expect(data?.some((r: { id: string }) => r.id === unclaimedCompanyId)).toBe(
      true,
    );
  });

  it("insensible aux accents : 'Quebec' trouve une entreprise localisée à 'Québec'", async () => {
    const anon = anonClient();
    const { data } = await anon.rpc("search_companies", { p_region: "Quebec" });
    expect(data?.some((r: { id: string }) => r.id === unclaimedCompanyId)).toBe(
      true,
    );
  });

  it("ne renvoie jamais une entreprise brouillon", async () => {
    const anon = anonClient();
    const { data } = await anon.rpc("search_companies", {
      p_query: "Entreprise Brouillon Test",
    });
    expect(data?.some((r: { id: string }) => r.id === inactiveCompanyId)).toBe(
      false,
    );
  });

  it("aucun résultat pour une requête sans correspondance", async () => {
    const anon = anonClient();
    const { data } = await anon.rpc("search_companies", {
      p_query: "xyzabc-inexistant-123",
    });
    expect(data ?? []).toEqual([]);
  });

  it("la pagination (limit/offset) fonctionne réellement", async () => {
    const anon = anonClient();
    const { data } = await anon.rpc("search_companies", {
      p_limit: 1,
      p_offset: 0,
    });
    expect(data?.length).toBeLessThanOrEqual(1);
  });
});

describe("Revendication — sécurité réelle (§19/§35)", () => {
  it("auto-approuve une correspondance de domaine forte sur une entreprise sans membre", async () => {
    const { data, error } = await claimant.client.rpc("submit_company_claim", {
      p_company_id: unclaimedCompanyId,
      p_professional_email: claimant.email,
      p_justification: null,
    });
    expect(error).toBeNull();
    expect(data.status).toBe("approved");

    const { data: membership } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", unclaimedCompanyId)
      .eq("user_id", claimant.id)
      .maybeSingle();
    expect(membership?.role).toBe("owner");
  });

  it("un changement de paramètre côté client ne suffit pas : un courriel usurpé ne correspondant pas au domaine du compte réel reste en attente", async () => {
    // Le "spoofer" prétend avoir un courriel du même domaine que
    // l'entreprise dans le FORMULAIRE, mais son compte authentifié réel
    // (Supabase) est sur un tout autre domaine (@example.com) : la fonction
    // vérifie le courriel du COMPTE, jamais seulement la valeur soumise.
    const otherCompanyId = await createCompany(
      null,
      "Autre Entreprise Test",
      "FR",
      {
        professional_email: "contact@usurpation-test.example",
      },
    );
    createdCompanyIds.push(otherCompanyId);

    const { data, error } = await spoofer.client.rpc("submit_company_claim", {
      p_company_id: otherCompanyId,
      p_professional_email: "quelquun@usurpation-test.example",
      p_justification: null,
    });
    expect(error).toBeNull();
    expect(data.status).toBe("pending");

    const { data: membership } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", otherCompanyId)
      .eq("user_id", spoofer.id)
      .maybeSingle();
    expect(membership).toBeNull();
  });

  it("un utilisateur ne peut PAS modifier claim_status directement (aucune politique RLS ne l'autorise)", async () => {
    const { data: claim } = await admin
      .from("company_claims")
      .select("id")
      .eq("company_id", unclaimedCompanyId)
      .eq("user_id", claimant.id)
      .single();

    const { error, data } = await claimant.client
      .from("company_claims")
      .update({ status: "rejected" })
      .eq("id", (claim as { id: string }).id)
      .select();
    // RLS silencieuse : aucune ligne affectée plutôt qu'une erreur explicite.
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("un utilisateur non-admin ne peut pas appeler review_company_claim avec effet", async () => {
    const secondCompanyId = await createCompany(
      null,
      "Entreprise Deuxieme Demande",
      "FR",
      {
        professional_email: `contact@tiers-${RUN_ID}.example`,
      },
    );
    createdCompanyIds.push(secondCompanyId);
    const { data: claim } = await thirdParty.client.rpc(
      "submit_company_claim",
      {
        p_company_id: secondCompanyId,
        p_professional_email: thirdParty.email,
        p_justification: "test",
      },
    );
    expect(claim.status).toBe("pending");

    const { error } = await thirdParty.client.rpc("review_company_claim", {
      p_claim_id: claim.id,
      p_decision: "approved",
      p_notes: null,
    });
    expect(error).not.toBeNull();

    const { data: membership } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", secondCompanyId)
      .eq("user_id", thirdParty.id)
      .maybeSingle();
    expect(membership).toBeNull();
  });

  it("un administrateur peut approuver, et un second demandeur sur une entreprise déjà revendiquée devient admin (pas owner)", async () => {
    const { data: pendingClaim } = await admin
      .from("company_claims")
      .select("id")
      .eq("company_id", unclaimedCompanyId)
      .eq("user_id", spoofer.id)
      .maybeSingle();

    // Le spoofer soumet une VRAIE revendication (avec son propre domaine),
    // sur l'entreprise déjà revendiquée par "claimant" — doit rester en
    // attente (déjà un owner), puis être approuvée manuellement par l'admin.
    if (!pendingClaim) {
      await spoofer.client.rpc("submit_company_claim", {
        p_company_id: unclaimedCompanyId,
        p_professional_email: spoofer.email,
        p_justification: "je travaille aussi ici",
      });
    }
    const { data: claimToApprove } = await admin
      .from("company_claims")
      .select("id")
      .eq("company_id", unclaimedCompanyId)
      .eq("user_id", spoofer.id)
      .single();

    const { data: decision, error } = await platformAdmin.client.rpc(
      "review_company_claim",
      {
        p_claim_id: (claimToApprove as { id: string }).id,
        p_decision: "approved",
        p_notes: "vérifié",
      },
    );
    expect(error).toBeNull();
    expect(decision.status).toBe("approved");

    const { data: membership } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", unclaimedCompanyId)
      .eq("user_id", spoofer.id)
      .single();
    expect(membership?.role).toBe("admin");

    const { data: originalOwner } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", unclaimedCompanyId)
      .eq("user_id", claimant.id)
      .single();
    expect(originalOwner?.role).toBe("owner");
  });

  it("une revendication refusée n'accorde aucun droit", async () => {
    const rejectCompanyId = await createCompany(
      null,
      "Entreprise Refus Test",
      "FR",
    );
    createdCompanyIds.push(rejectCompanyId);
    const { data: claim } = await thirdParty.client.rpc(
      "submit_company_claim",
      {
        p_company_id: rejectCompanyId,
        p_professional_email: thirdParty.email,
        p_justification: null,
      },
    );

    await platformAdmin.client.rpc("review_company_claim", {
      p_claim_id: claim.id,
      p_decision: "rejected",
      p_notes: null,
    });

    const { data: membership } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", rejectCompanyId)
      .eq("user_id", thirdParty.id)
      .maybeSingle();
    expect(membership).toBeNull();
  });
});

describe("Compatibilité ciblée sur la fiche publique (§10, réutilise le moteur Phase 6)", () => {
  it("calcule et persiste un match consultable uniquement par les deux entreprises concernées", async () => {
    const viewerCompanyId = await createCompany(
      thirdParty,
      "Vue Compatibilite Test",
      "FR",
    );
    createdCompanyIds.push(viewerCompanyId);
    await thirdParty.client.from("company_needs").insert({
      company_id: viewerCompanyId,
      capability_type_code: "DISTRIBUTOR",
      target_country_code: "CA",
    });
    await claimant.client.from("company_offers").insert({
      company_id: unclaimedCompanyId,
      capability_type_code: "DISTRIBUTOR",
      target_country_code: "CA",
    });

    const result = await getCompatibilityBetweenCompanies(
      thirdParty.client,
      viewerCompanyId,
      unclaimedCompanyId,
    );
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);

    const { data: visibleToOutsider } = await admin.auth.admin.createUser({
      email: testEmail("outsider-compat"),
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(visibleToOutsider.user!.id);
    const outsiderClient = anonClient();
    await outsiderClient.auth.signInWithPassword({
      email: testEmail("outsider-compat"),
      password: TEST_PASSWORD,
    });
    const { data: outsiderView } = await outsiderClient
      .from("matches")
      .select("id")
      .eq("company_id", viewerCompanyId);
    expect(outsiderView ?? []).toEqual([]);
  });
});
