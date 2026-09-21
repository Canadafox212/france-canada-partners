import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runImportBatch } from "@/lib/import/pipeline";

/**
 * Tests d'intégration réels (Phase 8) pour le pipeline d'import : vrai
 * projet Supabase, aucun mock. Utilise de petits fichiers CSV de test
 * (pas les vrais fichiers data/raw/, gardés hors de tout test automatisé)
 * pour rester rapide et déterministe. Complète la validation locale
 * (pglite, qui ne peut pas vérifier l'application réelle de la RLS).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const RUN_ID = crypto.randomUUID().slice(0, 8);
// RUN_ID est hexadécimal (peut contenir des lettres a-f) : impropre pour un
// numéro d'entreprise, que normalizeRegistrationNumber() ne conserve que
// sous forme de chiffres. RUN_NUM reste purement numérique pour tous les
// SIREN de test, afin que la comparaison de dédoublonnage reste exacte.
const RUN_NUM = String(Date.now()).slice(-6);
const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient(): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(label: string) {
  const email = `test-phase8-${RUN_ID}-${label}@example.com`;
  const password = "MotDePasseTest123!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error("Création utilisateur échouée");
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, client };
}

const CSV_HEADER =
  "Nom_Entreprise,Raison_Sociale,SIREN,Site_Web,Telephone,Email,Secteur,Code_APE,Description,Adresse,Code_Postal,Ville,Region,Pays";

function csvRow(fields: Record<string, string>): string {
  const cols = CSV_HEADER.split(",");
  return cols
    .map((c) => `"${(fields[c] ?? "").replace(/"/g, '""')}"`)
    .join(",");
}

let tmpDir: string;
let approvedSourceId: string;
let blockedSourceId: string;
let unknownSourceId: string;
let platformAdmin: Awaited<ReturnType<typeof createConfirmedUser>>;
let regularUser: Awaited<ReturnType<typeof createConfirmedUser>>;
let preExistingCompanyId: string;
let claimedCompanyId: string;

const createdCompanyIds: string[] = [];
const createdBatchIds: string[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "fcp-import-test-"));

  [platformAdmin, regularUser] = await Promise.all([
    createConfirmedUser("admin"),
    createConfirmedUser("user"),
  ]);
  createdUserIds.push(platformAdmin.id, regularUser.id);
  await admin
    .from("profiles")
    .update({ platform_role: "admin" })
    .eq("id", platformAdmin.id);

  const { data: approvedSource } = await admin
    .from("data_sources")
    .select("id")
    .eq("name", "Annuaire des Entreprises / API Recherche d'entreprises")
    .single();
  approvedSourceId = approvedSource!.id;

  const { data: blockedSource } = await admin
    .from("data_sources")
    .insert({
      name: `Source bloquée test ${RUN_ID}`,
      source_type: "registry",
      license_status: "DO_NOT_IMPORT",
      commercial_use_allowed: false,
    })
    .select("id")
    .single();
  blockedSourceId = blockedSource!.id;

  const { data: unknownSource } = await admin
    .from("data_sources")
    .insert({
      name: `Source inconnue test ${RUN_ID}`,
      source_type: "manual_entry",
    })
    .select("id")
    .single();
  unknownSourceId = unknownSource!.id;

  // Entreprise déjà existante (pour tester EXACT + protection du contenu revendiqué).
  const { data: existing } = await admin
    .from("companies")
    .insert({
      legal_name: `Entreprise Preexistante ${RUN_ID}`,
      display_name: `Entreprise Preexistante ${RUN_ID}`,
      slug: `entreprise-preexistante-${RUN_ID}`,
      country_code: "FR",
      company_registration_number: `900000${RUN_NUM}`,
      status: "active",
    })
    .select("id")
    .single();
  preExistingCompanyId = existing!.id;
  createdCompanyIds.push(preExistingCompanyId);

  // Entreprise revendiquée avec un contenu commercial à protéger.
  const { data: claimed } = await admin
    .from("companies")
    .insert({
      legal_name: `Entreprise Revendiquee ${RUN_ID}`,
      display_name: `Entreprise Revendiquee ${RUN_ID}`,
      slug: `entreprise-revendiquee-${RUN_ID}`,
      country_code: "FR",
      company_registration_number: `900001${RUN_NUM}`,
      status: "active",
      claimed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  claimedCompanyId = claimed!.id;
  createdCompanyIds.push(claimedCompanyId);
  await admin.from("company_translations").insert({
    company_id: claimedCompanyId,
    locale: "fr",
    description:
      "Description saisie par le propriétaire — ne doit JAMAIS être écrasée par un import.",
  });
}, 60000);

afterAll(async () => {
  for (const id of createdBatchIds) {
    await admin.from("import_batches").delete().eq("id", id);
  }
  for (const id of createdCompanyIds) {
    await admin.from("companies").delete().eq("id", id);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
  rmSync(tmpDir, { recursive: true, force: true });
  await admin
    .from("data_sources")
    .delete()
    .in("id", [blockedSourceId, unknownSourceId]);
}, 30000);

function writeCsv(name: string, rows: string[]): string {
  const filePath = path.join(tmpDir, name);
  writeFileSync(filePath, `${CSV_HEADER}\n${rows.join("\n")}\n`, "utf8");
  return filePath;
}

describe("Garde-fou de licence (§4 de la demande, réel)", () => {
  it("bloque un batch sur une source DO_NOT_IMPORT", async () => {
    const file = writeCsv("blocked.csv", [
      csvRow({ Nom_Entreprise: "X", Pays: "France" }),
    ]);
    await expect(
      runImportBatch(admin, {
        filePath: file,
        filename: "blocked.csv",
        sourceId: blockedSourceId,
        countryCode: "FR",
        batchName: `BLOCKED_${RUN_ID}`,
        dryRun: true,
        createdBy: platformAdmin.id,
      }),
    ).rejects.toThrow();
  });

  it("bloque un batch sur une source UNKNOWN", async () => {
    const file = writeCsv("unknown.csv", [
      csvRow({ Nom_Entreprise: "X", Pays: "France" }),
    ]);
    await expect(
      runImportBatch(admin, {
        filePath: file,
        filename: "unknown.csv",
        sourceId: unknownSourceId,
        countryCode: "FR",
        batchName: `UNKNOWN_${RUN_ID}`,
        dryRun: true,
        createdBy: platformAdmin.id,
      }),
    ).rejects.toThrow();
  });

  it("accepte un batch sur la source approuvée", async () => {
    const file = writeCsv("approved-ok.csv", [
      csvRow({
        Nom_Entreprise: `OK Company ${RUN_ID}`,
        Pays: "France",
        SIREN: `11111${RUN_NUM}`,
      }),
    ]);
    const result = await runImportBatch(admin, {
      filePath: file,
      filename: "approved-ok.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `APPROVED_OK_${RUN_ID}`,
      dryRun: true,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(result.batchId);
    expect(result.rows.length).toBe(1);
  });
});

describe("Dry run n'écrit jamais dans companies (§10 de la demande)", () => {
  it("le nombre d'entreprises reste inchangé après un dry run", async () => {
    // Vérifie l'ABSENCE de LA société précise de ce test plutôt qu'un
    // COMPTE GLOBAL : d'autres suites créent/suppriment des entreprises en
    // parallèle dans le même projet Supabase partagé, ce qui rendrait un
    // simple avant/après sur le total de `companies` intrinsèquement
    // instable (faux positifs/négatifs selon le minutage des autres tests).
    const dryRunDisplayName = `Nouvelle Entreprise Dryrun ${RUN_ID}`;
    const file = writeCsv("dryrun-mix.csv", [
      csvRow({
        Nom_Entreprise: dryRunDisplayName,
        Pays: "France",
        SIREN: `22222${RUN_NUM}`,
        Ville: "Lyon",
      }),
      csvRow({ Nom_Entreprise: "", Pays: "France" }), // REJECTED : nom absent
      csvRow({ Nom_Entreprise: `Pays Inconnu ${RUN_ID}`, Pays: "Ruritanie" }), // QUARANTINED
    ]);
    const result = await runImportBatch(admin, {
      filePath: file,
      filename: "dryrun-mix.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `DRYRUN_MIX_${RUN_ID}`,
      dryRun: true,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(result.batchId);

    const { data: shouldNotExist } = await admin
      .from("companies")
      .select("id")
      .eq("display_name", dryRunDisplayName)
      .maybeSingle();
    expect(shouldNotExist).toBeNull();

    const { data: batch } = await admin
      .from("import_batches")
      .select("*")
      .eq("id", result.batchId)
      .single();
    expect(batch!.rows_received).toBe(3);
    expect(batch!.rows_rejected).toBe(1);
    expect(batch!.rows_quarantined).toBe(1);
    // La ligne REJETÉE (nom absent) ne compte ni comme nouvelle ni comme
    // doublon (jamais un candidat valable pour le dédoublonnage) ; la
    // ligne QUARANTINED (pays inconnu) reste "nouvelle" au sens du
    // dédoublonnage (aucune correspondance trouvée), en plus de la ligne
    // VALID — d'où 2, pas 3 (REJECTED exclue) ni 1 (QUARANTINED oubliée).
    expect(batch!.rows_new).toBe(2);
    expect(batch!.rows_created).toBe(0);
  });
});

describe("Dédoublonnage réel (§7/§13)", () => {
  it("une correspondance EXACT (numéro officiel) est rattachée, jamais recréée", async () => {
    const { data: existing } = await admin
      .from("companies")
      .select("company_registration_number")
      .eq("id", preExistingCompanyId)
      .single();
    const file = writeCsv("exact.csv", [
      csvRow({
        Nom_Entreprise: "Nom différent mais même SIREN",
        SIREN: existing!.company_registration_number!,
        Pays: "France",
      }),
    ]);
    const dry = await runImportBatch(admin, {
      filePath: file,
      filename: "exact.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `EXACT_DRY_${RUN_ID}`,
      dryRun: true,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(dry.batchId);
    expect(dry.rows[0].duplicateLevel).toBe("EXACT");

    const real = await runImportBatch(admin, {
      filePath: file,
      filename: "exact.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `EXACT_REAL_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(real.batchId);
    expect(real.linkedExistingCompanyIds).toContain(preExistingCompanyId);
    expect(real.createdCompanyIds).toHaveLength(0);
  });

  it("une correspondance POSSIBLE (nom + ville) est mise en quarantaine, jamais fusionnée automatiquement", async () => {
    const { data: existing } = await admin
      .from("companies")
      .select("display_name")
      .eq("id", preExistingCompanyId)
      .single();
    await admin.from("company_locations").insert({
      company_id: preExistingCompanyId,
      location_type: "headquarters",
      is_primary: true,
      city: "Marseille",
      country_code: "FR",
    });

    const file = writeCsv("possible.csv", [
      csvRow({
        Nom_Entreprise: existing!.display_name,
        Ville: "Marseille",
        SIREN: `33333${RUN_NUM}`, // numéro DIFFÉRENT, donc pas EXACT
        Pays: "France",
      }),
    ]);
    const dry = await runImportBatch(admin, {
      filePath: file,
      filename: "possible.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `POSSIBLE_DRY_${RUN_ID}`,
      dryRun: true,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(dry.batchId);
    expect(dry.rows[0].duplicateLevel).toBe("POSSIBLE");
    expect(dry.rows[0].validationStatus).toBe("QUARANTINED");

    const real = await runImportBatch(admin, {
      filePath: file,
      filename: "possible.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `POSSIBLE_REAL_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(real.batchId);
    expect(real.createdCompanyIds).toHaveLength(0);
    expect(real.linkedExistingCompanyIds).toHaveLength(0);
  });
});

describe("Idempotence (§29 de l'original / import réel répété)", () => {
  it("importer deux fois le même fichier ne crée pas deux fois la même entreprise", async () => {
    const siren = `44444${RUN_NUM}`;
    const file = writeCsv("idempotent.csv", [
      csvRow({
        Nom_Entreprise: `Entreprise Idempotente ${RUN_ID}`,
        SIREN: siren,
        Pays: "France",
      }),
    ]);

    const first = await runImportBatch(admin, {
      filePath: file,
      filename: "idempotent.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `IDEMPOTENT_1_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(first.batchId);
    expect(first.createdCompanyIds).toHaveLength(1);
    createdCompanyIds.push(first.createdCompanyIds[0]);

    const second = await runImportBatch(admin, {
      filePath: file,
      filename: "idempotent.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `IDEMPOTENT_2_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(second.batchId);
    expect(second.createdCompanyIds).toHaveLength(0);
    expect(second.linkedExistingCompanyIds).toEqual(first.createdCompanyIds);
  });
});

describe("Protection d'une entreprise revendiquée (§8/§15/§16)", () => {
  it("un import ne modifie jamais la description d'une entreprise revendiquée, même en cas de correspondance EXACT", async () => {
    const { data: existing } = await admin
      .from("companies")
      .select("company_registration_number")
      .eq("id", claimedCompanyId)
      .single();
    const file = writeCsv("claimed.csv", [
      csvRow({
        Nom_Entreprise: "Nom issu du fichier, ne doit rien écraser",
        SIREN: existing!.company_registration_number!,
        Description:
          "Description du fichier source — ne doit JAMAIS remplacer celle du propriétaire.",
        Pays: "France",
      }),
    ]);
    const real = await runImportBatch(admin, {
      filePath: file,
      filename: "claimed.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `CLAIMED_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(real.batchId);
    expect(real.linkedExistingCompanyIds).toContain(claimedCompanyId);

    const { data: translation } = await admin
      .from("company_translations")
      .select("description")
      .eq("company_id", claimedCompanyId)
      .eq("locale", "fr")
      .single();
    expect(translation!.description).toContain("propriétaire");
  });
});

describe("Courriel nominatif jamais publié automatiquement (§6, réel)", () => {
  it("une adresse nominative n'est jamais copiée dans professional_email", async () => {
    const file = writeCsv("named-email.csv", [
      csvRow({
        Nom_Entreprise: `Entreprise Courriel Nominatif ${RUN_ID}`,
        SIREN: `55555${RUN_NUM}`,
        Email: "philippe.dupont@entreprise-test.example",
        Pays: "France",
      }),
    ]);
    const real = await runImportBatch(admin, {
      filePath: file,
      filename: "named-email.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `NAMED_EMAIL_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(real.batchId);
    createdCompanyIds.push(...real.createdCompanyIds);

    // Phase 10C (LOT 10C-3) : professional_email vit désormais dans
    // company_contacts (companies.professional_email est structurellement
    // toujours NULL depuis la migration 0025 — vérifier cette seule
    // colonne ne prouverait donc plus rien ; c'est company_contacts qui
    // doit rester vide ou nulle pour cette entreprise).
    const { data: contact } = await admin
      .from("company_contacts")
      .select("professional_email")
      .eq("company_id", real.createdCompanyIds[0])
      .maybeSingle();
    expect(contact?.professional_email ?? null).toBeNull();
  });
});

describe("Valeur source conservée après normalisation (§5 de l'original)", () => {
  it("raw_website conserve la valeur telle quelle même si elle est invalide", async () => {
    const file = writeCsv("raw-preserved.csv", [
      csvRow({
        Nom_Entreprise: `Entreprise URL Invalide ${RUN_ID}`,
        SIREN: `66666${RUN_NUM}`,
        Site_Web: "pas une url ///",
        Pays: "France",
      }),
    ]);
    const dry = await runImportBatch(admin, {
      filePath: file,
      filename: "raw-preserved.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `RAW_PRESERVED_${RUN_ID}`,
      dryRun: true,
      createdBy: platformAdmin.id,
    });
    createdBatchIds.push(dry.batchId);
    expect(dry.rows[0].raw.website).toBe("pas une url ///");
    expect(dry.rows[0].normalized.websiteDomain).toBeNull();
  });
});

describe("Description exclue quand la licence ne la couvre pas explicitement (lot pilote France)", () => {
  it("includeDescription=false n'écrit aucune company_translations même si la source en fournit une", async () => {
    const file = writeCsv("no-description.csv", [
      csvRow({
        Nom_Entreprise: `Entreprise Sans Description Publiee ${RUN_ID}`,
        SIREN: `77777${RUN_NUM}`,
        Description:
          "Texte commercial du site de l'entreprise — ne doit PAS être copié ici.",
        Pays: "France",
      }),
    ]);
    const real = await runImportBatch(admin, {
      filePath: file,
      filename: "no-description.csv",
      sourceId: approvedSourceId,
      countryCode: "FR",
      batchName: `NO_DESCRIPTION_${RUN_ID}`,
      dryRun: false,
      createdBy: platformAdmin.id,
      includeDescription: false,
    });
    createdBatchIds.push(real.batchId);
    createdCompanyIds.push(...real.createdCompanyIds);

    expect(real.rows[0].normalized.description).not.toBeNull(); // la valeur EST normalisée en staging...
    const { data: translations } = await admin
      .from("company_translations")
      .select("id")
      .eq("company_id", real.createdCompanyIds[0]);
    expect(translations ?? []).toEqual([]); // ...mais jamais écrite dans companies.
  });
});

describe("Sécurité RLS réelle (§39 de l'original)", () => {
  it("un utilisateur normal ne voit aucun batch ni ligne de staging", async () => {
    const { data: batches } = await regularUser.client
      .from("import_batches")
      .select("id");
    expect(batches ?? []).toEqual([]);
    const { data: staging } = await regularUser.client
      .from("staging_companies")
      .select("id");
    expect(staging ?? []).toEqual([]);
  });

  it("un administrateur de la plateforme peut consulter les batches", async () => {
    const { data: batches } = await platformAdmin.client
      .from("import_batches")
      .select("id")
      .limit(1);
    expect(batches).not.toBeNull();
  });

  it("un visiteur non authentifié ne voit rien", async () => {
    const anon = anonClient();
    const { data } = await anon.from("import_batches").select("id");
    expect(data ?? []).toEqual([]);
  });
});
