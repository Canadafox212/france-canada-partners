// Vérification SIRENE des entreprises françaises restantes (Phase 8, §15
// de la demande) — LECTURE SEULE, aucune écriture en base, aucun import.
//
// Usage :
//   npx tsx scripts/verify-siren-87.ts
//   npx tsx scripts/verify-siren-87.ts --out=rapport-siren-87.json
//
// Interroge l'API ouverte officielle recherche-entreprises.api.gouv.fr
// (Base Sirene / RNE, réutilisation libre) pour chacune des lignes du
// fichier source qui ne font PAS partie du lot pilote déjà importé (les
// 13 SIREN de scripts/import-companies.ts). Ce script ne fait que
// PRODUIRE UN RAPPORT ; quel que soit le résultat, aucune de ces
// entreprises n'est importée ici — voir docs/IMPORT_PIPELINE.md §15.
//
// Statuts possibles par ligne :
//   CONFIRMED           : le SIREN déclaré existe et le nom officiel
//                         correspond raisonnablement au nom déclaré.
//   NOT_FOUND           : aucun établissement ne correspond à ce SIREN
//                         dans le registre officiel.
//   IDENTIFIER_MISMATCH : le SIREN déclaré existe bel et bien, mais sous
//                         un nom officiel très différent du nom déclaré
//                         (indice d'une erreur de saisie ou de SIREN).
//   AMBIGUOUS           : le SIREN déclaré n'est pas au format attendu
//                         (9 chiffres) — aucune vérification fiable
//                         possible par identifiant. Dans ce cas, le script
//                         tente en complément une recherche par NOM (même
//                         API) pour signaler un ou plusieurs candidats
//                         officiels possibles — mais ne les élève JAMAIS
//                         au rang de CONFIRMED : sans SIREN déclaré, aucun
//                         moyen fiable de trancher entre homonymes.
//   ERROR               : échec technique (réseau, timeout, réponse
//                         invalide) — à retenter, pas une conclusion sur
//                         l'entreprise elle-même.
//
// Constat important (voir le champ "candidate_*" du rapport JSON) :
// contrairement à ce que documentait initialement docs/DATA_INVENTORY.md,
// les 87 lignes restantes n'ont PAS de SIREN exploitable dans le fichier
// source (valeur littérale "Non disponible") — seules les 13 déjà
// importées en avaient un réel. La vérification par identifiant est donc
// structurellement impossible pour ces 87 lignes ; seule une recherche
// par nom (moins fiable, jamais assez pour un import) est possible.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { readCsvFile } from "../src/lib/import/csvReader";
import { normalizeRegistrationNumber } from "../src/lib/import/normalization";
import { PILOT_APPROVED_SIRENS } from "../src/lib/import/pilotAllowlist";

const FRANCE_CSV_PATH = path.resolve(
  process.cwd(),
  "data/raw/france/entreprises_france_5000.csv",
);
const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const REQUEST_TIMEOUT_MS = 10_000;
// L'API est publique et non authentifiée ; un espacement raisonnable
// évite de la solliciter en rafale pour 87 requêtes séquentielles.
const DELAY_BETWEEN_REQUESTS_MS = 300;

type Status =
  | "CONFIRMED"
  | "NOT_FOUND"
  | "IDENTIFIER_MISMATCH"
  | "AMBIGUOUS"
  | "ERROR";

interface NameCandidate {
  siren: string;
  name: string;
  city: string | null;
  status: string | null;
}

interface RowResult {
  row_number: number;
  declared_name: string;
  declared_siren_raw: string;
  declared_siren_normalized: string | null;
  official_name: string | null;
  official_siren: string | null;
  official_status: string | null; // etat_administratif (A = actif, C = cessé)
  status: Status;
  detail: string;
  // Renseigné uniquement en secours (SIREN source absent/invalide) : un ou
  // plusieurs candidats trouvés par recherche NOMINATIVE, jamais assez
  // fiable pour valoir CONFIRMED — à vérifier manuellement au cas par cas.
  name_search_candidates?: NameCandidate[];
}

function normalizeForComparison(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Comparaison volontairement tolérante (sous-chaîne dans un sens ou
// l'autre) : les raisons sociales officielles incluent souvent des
// suffixes juridiques (SAS, SA, SNC...) absents du nom d'usage déclaré
// dans le fichier source, et inversement.
function namesLikelyMatch(declared: string, official: string): boolean {
  const a = normalizeForComparison(declared);
  const b = normalizeForComparison(official);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchByName(name: string): Promise<NameCandidate[]> {
  const response = await fetchWithTimeout(
    `${API_BASE}?q=${encodeURIComponent(name)}&per_page=5`,
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    results?: Array<{
      siren: string;
      nom_complet?: string | null;
      nom_raison_sociale?: string | null;
      etat_administratif?: string | null;
      siege?: { libelle_commune?: string | null } | null;
    }>;
  };
  const declaredNorm = normalizeForComparison(name);
  return (payload.results ?? [])
    .filter((r) => {
      const officialName = r.nom_complet ?? r.nom_raison_sociale ?? "";
      return namesLikelyMatch(declaredNorm, normalizeForComparison(officialName));
    })
    .map((r) => ({
      siren: r.siren,
      name: r.nom_complet ?? r.nom_raison_sociale ?? "",
      city: r.siege?.libelle_commune ?? null,
      status: r.etat_administratif ?? null,
    }));
}

async function verifyOne(
  rowNumber: number,
  declaredName: string,
  declaredSirenRaw: string,
): Promise<RowResult> {
  const base: Omit<RowResult, "status" | "detail"> = {
    row_number: rowNumber,
    declared_name: declaredName,
    declared_siren_raw: declaredSirenRaw,
    declared_siren_normalized: normalizeRegistrationNumber(declaredSirenRaw),
    official_name: null,
    official_siren: null,
    official_status: null,
  };

  const siren = base.declared_siren_normalized;
  if (!siren || siren.length !== 9) {
    try {
      const candidates = await searchByName(declaredName);
      if (candidates.length === 0) {
        return {
          ...base,
          status: "AMBIGUOUS",
          detail: `Aucun SIREN dans la source ("${declaredSirenRaw}") ; recherche par nom sans résultat officiel plausible — identité à établir manuellement.`,
        };
      }
      if (candidates.length === 1) {
        return {
          ...base,
          status: "AMBIGUOUS",
          detail:
            `Aucun SIREN dans la source ; un seul candidat officiel trouvé par nom ` +
            `(SIREN ${candidates[0].siren}, ${candidates[0].city ?? "ville inconnue"}, statut ${candidates[0].status ?? "inconnu"}) ` +
            `— à confirmer manuellement avant toute utilisation, aucun identifiant source pour trancher.`,
          name_search_candidates: candidates,
        };
      }
      return {
        ...base,
        status: "AMBIGUOUS",
        detail: `Aucun SIREN dans la source ; ${candidates.length} candidats homonymes trouvés par nom — aucun moyen fiable de trancher sans localisation.`,
        name_search_candidates: candidates,
      };
    } catch (err) {
      return {
        ...base,
        status: "AMBIGUOUS",
        detail: `SIREN déclaré non conforme au format attendu (9 chiffres) : "${declaredSirenRaw}". Recherche par nom échouée : ${err instanceof Error ? err.message : String(err)}.`,
      };
    }
  }

  try {
    const response = await fetchWithTimeout(
      `${API_BASE}?q=${encodeURIComponent(siren)}&per_page=1`,
    );
    if (!response.ok) {
      return {
        ...base,
        status: "ERROR",
        detail: `Réponse HTTP ${response.status} de l'API.`,
      };
    }
    const payload = (await response.json()) as {
      results?: Array<{
        siren: string;
        nom_complet?: string | null;
        nom_raison_sociale?: string | null;
        etat_administratif?: string | null;
      }>;
    };
    const result = payload.results?.[0];
    if (!result) {
      return {
        ...base,
        status: "NOT_FOUND",
        detail: "Aucun établissement trouvé pour ce SIREN dans le registre officiel.",
      };
    }
    const officialName = result.nom_complet ?? result.nom_raison_sociale ?? "";
    const match: RowResult = {
      ...base,
      official_name: officialName || null,
      official_siren: result.siren,
      official_status: result.etat_administratif ?? null,
      status: "CONFIRMED",
      detail: "",
    };
    if (!namesLikelyMatch(declaredName, officialName)) {
      match.status = "IDENTIFIER_MISMATCH";
      match.detail = `Le SIREN existe sous un nom officiel très différent du nom déclaré ("${officialName}" vs "${declaredName}").`;
      return match;
    }
    match.detail = `Nom officiel "${officialName}" (statut ${result.etat_administratif ?? "inconnu"}).`;
    return match;
  } catch (err) {
    return {
      ...base,
      status: "ERROR",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const rows = readCsvFile(FRANCE_CSV_PATH);

  const remaining = rows
    .map((row, index) => ({ row, rowNumber: index + 2 })) // +2 : ligne 1 = en-tête
    .filter(({ row }) => {
      const siren = normalizeRegistrationNumber(row.SIREN);
      return !siren || !PILOT_APPROVED_SIRENS.has(siren);
    });

  console.log(
    `Fichier : ${FRANCE_CSV_PATH}\n` +
      `Lignes totales : ${rows.length} — déjà importées (lot pilote) : ${PILOT_APPROVED_SIRENS.size} — à vérifier ici : ${remaining.length}\n` +
      `Aucune écriture en base, aucun import — rapport en lecture seule uniquement.\n`,
  );

  const results: RowResult[] = [];
  for (const { row, rowNumber } of remaining) {
    const declaredName = row.Nom_Entreprise || row.Raison_Sociale || "(nom manquant)";
    const result = await verifyOne(rowNumber, declaredName, row.SIREN ?? "");
    results.push(result);
    console.log(
      `[${String(rowNumber).padStart(4, " ")}] ${result.status.padEnd(20, " ")} ${declaredName} (SIREN ${row.SIREN || "?"}) — ${result.detail}`,
    );
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const synthesis = results.reduce<Record<Status, number>>(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { CONFIRMED: 0, NOT_FOUND: 0, IDENTIFIER_MISMATCH: 0, AMBIGUOUS: 0, ERROR: 0 },
  );

  console.log("\n=== SYNTHÈSE ===");
  console.log(`Total vérifié     : ${results.length}`);
  console.log(`CONFIRMED         : ${synthesis.CONFIRMED}`);
  console.log(`NOT_FOUND         : ${synthesis.NOT_FOUND}`);
  console.log(`IDENTIFIER_MISMATCH : ${synthesis.IDENTIFIER_MISMATCH}`);
  console.log(`AMBIGUOUS         : ${synthesis.AMBIGUOUS}`);
  console.log(`ERROR             : ${synthesis.ERROR}`);
  console.log(
    "\nRappel : ce rapport ne déclenche AUCUN import, quel que soit le résultat.",
  );

  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out);
    writeFileSync(
      outPath,
      JSON.stringify({ generated_at: new Date().toISOString(), synthesis, results }, null, 2),
      "utf8",
    );
    console.log(`\nRapport détaillé écrit dans : ${outPath}`);
  }
}

main().catch((err) => {
  console.error("\n=== ÉCHEC DE LA VÉRIFICATION ===");
  console.error(err);
  process.exitCode = 1;
});
