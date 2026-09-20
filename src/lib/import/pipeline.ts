// Pas de garde "server-only" ici : ce module doit aussi pouvoir tourner
// en script CLI autonome (scripts/import-companies.ts, via tsx), un
// contexte que "server-only" ne reconnaît pas (il ne détecte que le
// bundler Next.js). Aucune page/Client Component n'importe ce module —
// le risque qu'il visait à prévenir ne s'applique pas ici.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapFranceCsvRow } from "./columnMapping";
import { commitStagingRow } from "./commit";
import { readCsvFile } from "./csvReader";
import {
  computeCounters,
  createImportBatch,
  findDuplicateMatches,
  insertDuplicateCandidates,
  insertIssues,
  insertStagingRow,
  scoreRow,
  updateBatch,
} from "./staging";
import { validateRow } from "./validate";
import type { ScoredCompanyRow } from "./types";

export interface RunImportBatchParams {
  filePath: string;
  filename: string;
  sourceId: string;
  countryCode: string;
  batchName: string;
  dryRun: boolean;
  createdBy: string | null;
  licenseOverrideJustification?: string;
  licenseOverrideBy?: string;
  /** Limite le nombre de lignes traitées (utile pour un lot pilote issu d'un fichier plus large). */
  rowFilter?: (sourceRecordId: string | null, rowNumber: number) => boolean;
  /** Voir commit.ts : n'écrit la description que si la licence de la source la couvre explicitement. */
  includeDescription?: boolean;
}

export interface RunImportBatchResult {
  batchId: string;
  rows: ScoredCompanyRow[];
  createdCompanyIds: string[];
  linkedExistingCompanyIds: string[];
}

type StagedRow = ScoredCompanyRow & { stagingId: string };

/**
 * Exécute UNE fois le pipeline sur UN fichier (voir docs/IMPORT_PIPELINE.md).
 * `dryRun = true` s'arrête après avoir rempli `staging_companies` : AUCUNE
 * ligne n'est jamais créée dans `companies`. Le garde-fou de licence est
 * appliqué par la base elle-même (déclencheur sur `import_batches`,
 * migration 0020) — createImportBatch() peut lever une erreur AVANT même
 * de lire le fichier si la source n'est pas autorisée.
 */
export async function runImportBatch(
  supabase: SupabaseClient,
  params: RunImportBatchParams,
): Promise<RunImportBatchResult> {
  const batchId = await createImportBatch(supabase, {
    sourceId: params.sourceId,
    batchName: params.batchName,
    filename: params.filename,
    countryCode: params.countryCode,
    dryRun: params.dryRun,
    createdBy: params.createdBy,
    licenseOverrideJustification: params.licenseOverrideJustification,
    licenseOverrideBy: params.licenseOverrideBy,
  });

  const rawRows = readCsvFile(params.filePath);
  const scoredRows: StagedRow[] = [];

  let rowNumber = 0;
  for (const rawRow of rawRows) {
    rowNumber += 1;
    const normalized = mapFranceCsvRow(rawRow, rowNumber);
    if (
      params.rowFilter &&
      !params.rowFilter(normalized.sourceRecordId, rowNumber)
    )
      continue;

    const validated = validateRow(normalized);
    const duplicateMatches =
      validated.validationStatus === "REJECTED"
        ? []
        : await findDuplicateMatches(supabase, {
            registrationNumber: validated.normalized.registrationNumber,
            websiteDomain: validated.normalized.websiteDomain,
            legalName: validated.normalized.legalName,
            displayName: validated.normalized.displayName,
            city: validated.normalized.city,
          });
    const scored = scoreRow(validated, duplicateMatches);
    const stagingId = await insertStagingRow(supabase, batchId, scored);
    await insertIssues(supabase, batchId, stagingId, scored.issues);
    await insertDuplicateCandidates(
      supabase,
      batchId,
      stagingId,
      scored.duplicateMatches,
    );
    scoredRows.push({ ...scored, stagingId });
  }

  const counters = computeCounters(scoredRows);
  await updateBatch(supabase, batchId, {
    ...counters,
    status: params.dryRun ? "COMPLETED" : "IMPORTING",
  });

  const createdCompanyIds: string[] = [];
  const linkedExistingCompanyIds: string[] = [];

  if (!params.dryRun) {
    for (const row of scoredRows) {
      const eligible =
        (row.validationStatus === "VALID" ||
          row.validationStatus === "WARNING") &&
        (row.duplicateLevel === "NEW" || row.duplicateLevel === "EXACT");
      if (!eligible) continue;
      const result = await commitStagingRow(supabase, {
        stagingId: row.stagingId,
        batchId,
        sourceId: params.sourceId,
        row,
        includeDescription: params.includeDescription,
      });
      if (result.created) createdCompanyIds.push(result.companyId);
      else linkedExistingCompanyIds.push(result.companyId);
    }

    await updateBatch(supabase, batchId, {
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
      rows_created: createdCompanyIds.length,
      rows_updated: linkedExistingCompanyIds.length,
    });
  } else {
    await updateBatch(supabase, batchId, {
      completed_at: new Date().toISOString(),
    });
  }

  return {
    batchId,
    rows: scoredRows,
    createdCompanyIds,
    linkedExistingCompanyIds,
  };
}
