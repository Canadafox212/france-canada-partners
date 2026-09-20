// Pipeline d'import (Phase 8) — commande CLI explicite (§10 de la demande).
//
// Usage :
//   npx tsx scripts/import-companies.ts --mode=dry-run --batch-name=FRANCE_PILOT_DRYRUN_001
//   npx tsx scripts/import-companies.ts --mode=real --batch-name=FRANCE_PILOT_001
//
// `--mode=dry-run` (par défaut) : lit, normalise, valide, cherche les
// doublons, écrit dans staging_companies — N'ÉCRIT JAMAIS dans companies.
// `--mode=real` : en plus, crée réellement les entreprises éligibles
// (statut VALID/WARNING + niveau NEW, ou rattachement si EXACT). Toujours
// avec confirmation explicite (voir README d'utilisation ci-dessous) —
// jamais lancé automatiquement par un autre script.
//
// Le lot pilote est volontairement restreint aux 13 entreprises classées
// APPROVED_FOR_IMPORT lors de l'audit (docs/DATA_SOURCES.md, identité
// légale confirmée par la source SIRENE ouverte) — jamais les 100 lignes
// du fichier. Cette liste est un ALLOWLIST explicite, pas un filtre
// générique sur une colonne : le choix des 13 a été fait par vous
// (Décision 1), pas déduit automatiquement ici.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runImportBatch } from "../src/lib/import/pipeline";
import { buildBatchReport } from "../src/lib/import/report";

const PILOT_APPROVED_SIRENS = new Set([
  "349357343",
  "314397696",
  "562082909",
  "778127613",
  "560801706",
  "552059024",
  "572050169",
  "384711909",
  "414969584",
  "500212188",
  "819252701",
  "818791840",
  "414127605",
]);

const APPROVED_SOURCE_NAME =
  "Annuaire des Entreprises / API Recherche d'entreprises";
const FRANCE_CSV_PATH = path.resolve(
  process.cwd(),
  "data/raw/france/entreprises_france_5000.csv",
);

function loadEnvLocal() {
  const env: Record<string, string> = {};
  const content = readFileSync(
    path.resolve(process.cwd(), ".env.local"),
    "utf8",
  );
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? "dry-run";
  if (mode !== "dry-run" && mode !== "real") {
    throw new Error("--mode doit être 'dry-run' ou 'real'.");
  }
  const batchName =
    args["batch-name"] ??
    `FRANCE_PILOT_${mode === "dry-run" ? "DRYRUN" : "REAL"}_${Date.now()}`;

  const env = loadEnvLocal();
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const { data: source, error: sourceError } = await supabase
    .from("data_sources")
    .select("id, license_status, commercial_use_allowed")
    .eq("name", APPROVED_SOURCE_NAME)
    .single();
  if (sourceError || !source) {
    throw new Error(
      `Source "${APPROVED_SOURCE_NAME}" introuvable — la migration 0020 a-t-elle bien été appliquée ? (${sourceError?.message})`,
    );
  }

  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("platform_role", "admin")
    .limit(1)
    .maybeSingle();

  console.log(`Mode : ${mode.toUpperCase()}`);
  console.log(`Batch : ${batchName}`);
  console.log(
    `Source : ${APPROVED_SOURCE_NAME} (statut ${source.license_status})`,
  );
  console.log(
    `Lignes autorisées pour ce pilote (SIREN) : ${PILOT_APPROVED_SIRENS.size}`,
  );

  const result = await runImportBatch(supabase, {
    filePath: FRANCE_CSV_PATH,
    filename: "entreprises_france_5000.csv",
    sourceId: source.id,
    countryCode: "FR",
    batchName,
    dryRun: mode === "dry-run",
    createdBy: adminProfile?.id ?? null,
    // Le statut APPROVED_FOR_IMPORT de cette source a été accordé pour
    // l'IDENTITÉ légale (SIRENE, Licence Ouverte 2.0) — jamais vérifié
    // pour la colonne "Description" du fichier, probablement issue du
    // site propre de chaque entreprise (contenu commercial de tiers, pas
    // un fait de registre). Exclue de ce lot par prudence, conformément à
    // la condition explicite du lot pilote ("aucun contenu commercial
    // existant ne doit être généré [ou repris] par inférence").
    includeDescription: false,
    rowFilter: (sourceRecordId) =>
      !!sourceRecordId && PILOT_APPROVED_SIRENS.has(sourceRecordId),
  });

  console.log(`\nBatch créé : ${result.batchId}`);
  console.log(`Lignes traitées (allowlist appliquée) : ${result.rows.length}`);

  const report = await buildBatchReport(supabase, result.batchId);
  console.log(`\n${report}`);
}

main().catch((err) => {
  console.error("\n=== ÉCHEC DE L'IMPORT ===");
  console.error(err);
  process.exitCode = 1;
});
