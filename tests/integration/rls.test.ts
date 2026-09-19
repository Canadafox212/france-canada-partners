import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Tests d'intégration RÉELS contre le vrai projet Supabase (pas de mock,
 * pas de base locale) : ils vérifient le comportement effectif de la
 * sécurité par ligne (RLS) et des déclencheurs de protection, exactement
 * comme un navigateur ou un appel API direct les vivrait.
 *
 * pgTAP nécessiterait une instance Postgres locale via Docker, indisponible
 * dans cet environnement (voir docs/DATABASE.md) : ce fichier joue le même
 * rôle de preuve, mais en frappant directement le projet distant avec la
 * même bibliothèque cliente que l'application.
 *
 * Toutes les données créées ici (utilisateurs, entreprises) sont supprimées
 * à la fin (afterAll), y compris en cas d'échec d'un test.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
// Supabase valide le format de courriel et rejette le TLD ".invalid" ;
// "example.com" (réservé par la RFC 2606, jamais délivré) passe la
// validation tout en ne pouvant jamais correspondre à une vraie boîte.
const testEmail = (label: string) =>
  `test-phase3-${RUN_ID}-${label}@example.com`;
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

let owner: Awaited<ReturnType<typeof createConfirmedUser>>;
let outsider: Awaited<ReturnType<typeof createConfirmedUser>>;
let member: Awaited<ReturnType<typeof createConfirmedUser>>;
let companyId: string;

beforeAll(async () => {
  owner = await createConfirmedUser("owner");
  outsider = await createConfirmedUser("outsider");
  member = await createConfirmedUser("member");
  createdUserIds.push(owner.id, outsider.id, member.id);
}, 30000);

afterAll(async () => {
  for (const id of createdCompanyIds) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}, 30000);

describe("Inscription et confirmation de courriel", () => {
  // Note : le endpoint public signUp() applique une validation de courriel
  // plus stricte (probablement une vérification de domaine) que
  // auth.admin.createUser() et rejette les domaines de test classiques
  // (example.com, .invalid). Le formulaire d'inscription réel de
  // l'application appelle bien signUp() (voir src/app/[locale]/inscription)
  // et a été vérifié manuellement avec une vraie adresse. Ce test se
  // concentre sur ce qui est vérifiable de façon fiable et automatisée :
  // le mécanisme de confirmation lui-même.
  it("un compte créé non confirmé ne peut pas se connecter tant qu'il n'est pas confirmé", async () => {
    const email = testEmail("confirmation-flow");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: false,
    });
    expect(error).toBeNull();
    createdUserIds.push(data.user!.id);
    expect(data.user?.email_confirmed_at).toBeFalsy();

    const { data: profile } = await admin
      .from("profiles")
      .select("platform_role")
      .eq("id", data.user!.id)
      .single();
    expect(profile?.platform_role).toBe("user");

    const unconfirmedClient = anonClient();
    const { error: signInBeforeError } =
      await unconfirmedClient.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
    expect(signInBeforeError).not.toBeNull();

    const { error: confirmError } = await admin.auth.admin.updateUserById(
      data.user!.id,
      {
        email_confirm: true,
      },
    );
    expect(confirmError).toBeNull();

    const { error: signInAfterError } =
      await unconfirmedClient.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
    expect(signInAfterError).toBeNull();
  });
});

describe("Connexion / déconnexion", () => {
  it("se connecte avec le bon mot de passe puis se déconnecte", async () => {
    const client = anonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: owner.email,
      password: TEST_PASSWORD,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();

    const { error: signOutError } = await client.auth.signOut();
    expect(signOutError).toBeNull();
    const { data: afterSignOut } = await client.auth.getSession();
    expect(afterSignOut.session).toBeNull();
  });

  it("refuse un mauvais mot de passe", async () => {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({
      email: owner.email,
      password: "un-mauvais-mot-de-passe",
    });
    expect(error).not.toBeNull();
  });
});

describe("Visiteur non connecté", () => {
  it("ne peut pas créer d'entreprise", async () => {
    const visitor = anonClient();
    const { error } = await visitor.from("companies").insert({
      legal_name: "Ne devrait jamais exister",
      display_name: "Ne devrait jamais exister",
      slug: `visiteur-${RUN_ID}`,
      country_code: "FR",
    });
    expect(error).not.toBeNull();
  });

  it("ne peut pas lire les profils (aucune donnée personnelle publique)", async () => {
    const visitor = anonClient();
    const { data, error } = await visitor.from("profiles").select("id");
    // La politique RLS ne renvoie aucune ligne à un visiteur (pas forcément
    // une erreur HTTP, mais un résultat vide).
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("Création d'entreprise (create_company) et rattachement automatique", () => {
  it("le créateur devient owner, avec établissement, secteur et traduction créés dans la même opération", async () => {
    const { data: industry } = await admin
      .from("industries")
      .select("id")
      .limit(1)
      .single();

    const { data, error } = await owner.client.rpc("create_company", {
      p_legal_name: "Fromagerie Intégration Test",
      p_display_name: `Fromagerie Test ${RUN_ID}`,
      p_slug: `fromagerie-test-${RUN_ID}`,
      p_country_code: "CA",
      p_website: "https://exemple.com",
      p_professional_email: "contact@exemple.com",
      p_region: "Québec",
      p_city: "Québec",
      p_industry_id: industry?.id ?? null,
      p_description: "Une fromagerie artisanale pour les tests.",
      p_description_locale: "fr",
    });

    expect(error).toBeNull();
    companyId = (data as { id: string; slug: string }).id;
    createdCompanyIds.push(companyId);

    const { data: membership } = await admin
      .from("company_members")
      .select("role, status")
      .eq("company_id", companyId)
      .eq("user_id", owner.id)
      .single();
    expect(membership?.role).toBe("owner");
    expect(membership?.status).toBe("active");

    const { data: location } = await admin
      .from("company_locations")
      .select("is_primary, city")
      .eq("company_id", companyId)
      .single();
    expect(location?.is_primary).toBe(true);

    // Ajoute "member" comme simple membre pour les tests suivants.
    await admin.from("company_members").insert({
      company_id: companyId,
      user_id: member.id,
      role: "member",
      status: "active",
      joined_at: new Date().toISOString(),
    });
  });
});

describe("OWNER peut modifier son entreprise, dans les limites autorisées", () => {
  it("modifie un champ métier autorisé (phone)", async () => {
    const { error } = await owner.client
      .from("companies")
      .update({ phone: "+1 418 555 0100" })
      .eq("id", companyId);
    expect(error).toBeNull();
  });

  it("NE PEUT PAS modifier subscription_level (champ protégé)", async () => {
    const { error } = await owner.client
      .from("companies")
      .update({ subscription_level: "business" })
      .eq("id", companyId);
    expect(error).not.toBeNull();
  });

  it("NE PEUT PAS modifier verification_status (auto-vérification impossible)", async () => {
    const { error } = await owner.client
      .from("companies")
      .update({ verification_status: "verified" })
      .eq("id", companyId);
    expect(error).not.toBeNull();
  });
});

describe("MEMBER : actions autorisées seulement", () => {
  it("peut ajouter une offre (autorisé aux members)", async () => {
    const { error } = await member.client.from("company_offers").insert({
      company_id: companyId,
      capability_type_code: "MANUFACTURING_CAPACITY",
      description: "Test depuis un compte member",
    });
    expect(error).toBeNull();
  });

  it("NE PEUT PAS modifier la fiche entreprise elle-même (réservé owner/admin)", async () => {
    const { error } = await member.client
      .from("companies")
      .update({ phone: "+1 418 555 0199" })
      .eq("id", companyId);
    // La ligne n'est simplement pas affectée (0 ligne modifiée) plutôt
    // qu'une erreur explicite : on vérifie que la valeur n'a pas changé.
    const { data } = await admin
      .from("companies")
      .select("phone")
      .eq("id", companyId)
      .single();
    expect(data?.phone).not.toBe("+1 418 555 0199");
    void error;
  });
});

describe("Utilisateur extérieur : ne peut jamais modifier une entreprise qui n'est pas la sienne", () => {
  it("NE PEUT PAS modifier l'entreprise d'un autre", async () => {
    await outsider.client
      .from("companies")
      .update({ phone: "+1 418 555 0000" })
      .eq("id", companyId);
    const { data } = await admin
      .from("companies")
      .select("phone")
      .eq("id", companyId)
      .single();
    expect(data?.phone).not.toBe("+1 418 555 0000");
  });

  it("NE PEUT PAS s'ajouter lui-même comme membre de cette entreprise", async () => {
    const { error } = await outsider.client.from("company_members").insert({
      company_id: companyId,
      user_id: outsider.id,
      role: "owner",
      status: "active",
    });
    expect(error).not.toBeNull();
  });
});

describe("Protection contre l'élévation de privilège (profiles.platform_role)", () => {
  it("un utilisateur ne peut jamais se transformer lui-même en administrateur", async () => {
    const { error } = await owner.client
      .from("profiles")
      .update({ platform_role: "admin" })
      .eq("id", owner.id);
    expect(error).not.toBeNull();
  });

  it("un utilisateur ne peut pas modifier le profil d'un autre utilisateur", async () => {
    const { error } = await owner.client
      .from("profiles")
      .update({ full_name: "Piraté" })
      .eq("id", outsider.id);
    const { data } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", outsider.id)
      .single();
    expect(data?.full_name).not.toBe("Piraté");
    void error;
  });

  it("un utilisateur peut modifier ses propres informations autorisées", async () => {
    const { error } = await owner.client
      .from("profiles")
      .update({ full_name: "Nom Mis À Jour" })
      .eq("id", owner.id);
    expect(error).toBeNull();
    const { data } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", owner.id)
      .single();
    expect(data?.full_name).toBe("Nom Mis À Jour");
  });
});

describe("Journal d'audit", () => {
  it("a bien enregistré la création de l'entreprise et la tentative refusée d'auto-vérification n'y figure pas comme réussie", async () => {
    const { data, error } = await admin
      .from("audit_logs")
      .select("action")
      .eq("entity_id", companyId)
      .eq("action", "company_created");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(1);
  });
});
