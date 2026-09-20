// Pas de garde "server-only" ici : ce module doit aussi pouvoir tourner
// en script CLI autonome (scripts/import-companies.ts, via tsx), un
// contexte que "server-only" ne reconnaît pas (il ne détecte que le
// bundler Next.js). Aucune page/Client Component n'importe ce module —
// le risque qu'il visait à prévenir ne s'applique pas ici.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareForDuplicate,
  highestDuplicateLevel,
  type DedupProfile,
} from "./dedup";
import type {
  DuplicateMatch,
  RowIssue,
  ScoredCompanyRow,
  ValidatedCompanyRow,
} from "./types";

/**
 * Accès base de données du pipeline (server-only, clé secrète — voir
 * commit.ts et docs/IMPORT_PIPELINE.md). Toute écriture métier passe par
 * ces fonctions plutôt que par des appels Supabase épars dans pipeline.ts,
 * pour garder un seul endroit qui connaît la forme exacte des tables.
 */

export interface CreateBatchParams {
  sourceId: string;
  batchName: string;
  filename: string;
  countryCode: string;
  dryRun: boolean;
  createdBy: string | null;
  licenseOverrideJustification?: string;
  licenseOverrideBy?: string;
}

export async function createImportBatch(
  supabase: SupabaseClient,
  params: CreateBatchParams,
) {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      source_id: params.sourceId,
      batch_name: params.batchName,
      filename: params.filename,
      country_code: params.countryCode,
      dry_run: params.dryRun,
      created_by: params.createdBy,
      license_override_justification:
        params.licenseOverrideJustification ?? null,
      license_override_by: params.licenseOverrideBy ?? null,
      status: "VALIDATING",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Création du batch impossible : ${error.message}`);
  return data.id as string;
}

export async function insertStagingRow(
  supabase: SupabaseClient,
  batchId: string,
  row: ScoredCompanyRow,
): Promise<string> {
  const { data, error } = await supabase
    .from("staging_companies")
    .insert({
      batch_id: batchId,
      row_number: row.rowNumber,
      source_record_id: row.sourceRecordId,
      raw_display_name: row.raw.displayName,
      raw_legal_name: row.raw.legalName,
      raw_registration_number: row.raw.registrationNumber,
      raw_website: row.raw.website,
      raw_phone: row.raw.phone,
      raw_email: row.raw.email,
      raw_country: row.raw.country,
      raw_region: row.raw.region,
      raw_city: row.raw.city,
      raw_postal_code: row.raw.postalCode,
      raw_address: row.raw.address,
      raw_sector_code: row.raw.sectorCode,
      raw_sector_label: row.raw.sectorLabel,
      raw_description: row.raw.description,
      normalized_display_name: row.normalized.displayName,
      normalized_legal_name: row.normalized.legalName,
      normalized_registration_number: row.normalized.registrationNumber,
      normalized_website: row.normalized.website,
      normalized_website_domain: row.normalized.websiteDomain,
      normalized_phone: row.normalized.phone,
      normalized_email: row.normalized.email,
      email_classification: row.normalized.emailClassification,
      normalized_country_code: row.normalized.countryCode,
      normalized_region: row.normalized.region,
      normalized_city: row.normalized.city,
      normalized_postal_code: row.normalized.postalCode,
      normalized_address: row.normalized.address,
      normalized_description: row.normalized.description,
      validation_status: row.validationStatus,
      duplicate_level: row.duplicateLevel,
      duplicate_of_company_id:
        row.duplicateMatches.find((m) => m.level === "EXACT")
          ?.existingCompanyId ?? null,
      raw_record: row.rawRecord,
    })
    .select("id")
    .single();
  if (error)
    throw new Error(
      `Insertion staging (ligne ${row.rowNumber}) impossible : ${error.message}`,
    );
  return data.id as string;
}

export async function insertIssues(
  supabase: SupabaseClient,
  batchId: string,
  stagingCompanyId: string,
  issues: RowIssue[],
) {
  if (issues.length === 0) return;
  const { error } = await supabase.from("import_row_issues").insert(
    issues.map((issue) => ({
      batch_id: batchId,
      staging_company_id: stagingCompanyId,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      field_name: issue.fieldName ?? null,
    })),
  );
  if (error)
    throw new Error(`Insertion des anomalies impossible : ${error.message}`);
}

/**
 * Ne trace ici que les correspondances contre une entreprise DÉJÀ EN BASE
 * (`existingCompanyId` renseigné). EXACT est déjà tracé par
 * `staging_companies.duplicate_of_company_id`, pas dupliqué ici. La
 * détection de doublons ENTRE deux lignes d'un même batch
 * (`other_staging_company_id`) n'est pas implémentée cette phase — le lot
 * pilote (13 lignes déjà vérifiées sans doublon interne lors de l'audit)
 * ne le nécessite pas ; la colonne existe pour une évolution future.
 */
export async function insertDuplicateCandidates(
  supabase: SupabaseClient,
  batchId: string,
  stagingCompanyId: string,
  matches: DuplicateMatch[],
) {
  const toInsert = matches
    .filter((m) => m.level !== "EXACT" && m.existingCompanyId)
    .map((m) => ({
      batch_id: batchId,
      staging_company_id: stagingCompanyId,
      existing_company_id: m.existingCompanyId,
      match_level: m.level,
      match_signal: m.signal,
    }));
  if (toInsert.length === 0) return;
  const { error } = await supabase
    .from("import_duplicate_candidates")
    .insert(toInsert);
  if (error)
    throw new Error(
      `Insertion des doublons candidats impossible : ${error.message}`,
    );
}

export interface BatchCounters {
  rows_received: number;
  rows_valid: number;
  rows_warning: number;
  rows_quarantined: number;
  rows_rejected: number;
  rows_new: number;
  rows_existing: number;
  rows_duplicates: number;
}

export function computeCounters(rows: ScoredCompanyRow[]): BatchCounters {
  const counters: BatchCounters = {
    rows_received: rows.length,
    rows_valid: 0,
    rows_warning: 0,
    rows_quarantined: 0,
    rows_rejected: 0,
    rows_new: 0,
    rows_existing: 0,
    rows_duplicates: 0,
  };
  for (const row of rows) {
    if (row.validationStatus === "VALID") counters.rows_valid += 1;
    if (row.validationStatus === "WARNING") counters.rows_warning += 1;
    if (row.validationStatus === "QUARANTINED") counters.rows_quarantined += 1;
    if (row.validationStatus === "REJECTED") counters.rows_rejected += 1;
    // Une ligne REJETÉE (ex. nom absent) n'a jamais été un candidat valable
    // pour le dédoublonnage — elle ne doit compter ni comme "nouvelle" ni
    // comme "existante"/"doublon", sous peine de fausser ces compteurs.
    if (row.validationStatus === "REJECTED") continue;
    if (row.duplicateLevel === "NEW") counters.rows_new += 1;
    else if (row.duplicateLevel === "EXACT") counters.rows_existing += 1;
    else counters.rows_duplicates += 1;
  }
  return counters;
}

export async function updateBatch(
  supabase: SupabaseClient,
  batchId: string,
  fields: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("import_batches")
    .update(fields)
    .eq("id", batchId);
  if (error)
    throw new Error(`Mise à jour du batch impossible : ${error.message}`);
}

/**
 * Recherche des candidats existants pour le dédoublonnage — trois requêtes
 * ciblées (numéro officiel, domaine, nom) plutôt qu'une requête par ligne
 * source, pour rester raisonnable même à plusieurs milliers de lignes
 * (§42 : "ne sur-optimise pas avant mesure", mais éviter le N+1 évident
 * reste la moindre des choses dès la conception).
 */
export async function findDuplicateMatches(
  supabase: SupabaseClient,
  candidate: DedupProfile,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];

  if (candidate.registrationNumber) {
    const { data } = await supabase
      .from("companies")
      .select(
        "id, company_registration_number, website, legal_name, display_name",
      )
      .eq("company_registration_number", candidate.registrationNumber)
      .limit(1);
    for (const existing of data ?? []) {
      const result = compareForDuplicate(candidate, toDedupProfile(existing));
      if (result) matches.push({ ...result, existingCompanyId: existing.id });
    }
  }

  if (matches.length === 0 && candidate.websiteDomain) {
    const { data } = await supabase
      .from("companies")
      .select(
        "id, company_registration_number, website, legal_name, display_name",
      )
      .ilike("website", `%${candidate.websiteDomain}%`)
      .limit(5);
    for (const existing of data ?? []) {
      const result = compareForDuplicate(candidate, toDedupProfile(existing));
      if (result) matches.push({ ...result, existingCompanyId: existing.id });
    }
  }

  if (matches.length === 0 && candidate.displayName) {
    const { data } = await supabase
      .from("companies")
      .select(
        "id, company_registration_number, website, legal_name, display_name, company_locations(city, is_primary)",
      )
      .or(
        `display_name.ilike.%${candidate.displayName}%,legal_name.ilike.%${candidate.displayName}%`,
      )
      .limit(5);
    for (const existing of data ?? []) {
      const city = (existing.company_locations ?? []).find(
        (l: { is_primary: boolean }) => l.is_primary,
      )?.city;
      const result = compareForDuplicate(candidate, {
        ...toDedupProfile(existing),
        city: city ?? null,
      });
      if (result) matches.push({ ...result, existingCompanyId: existing.id });
    }
  }

  return matches;
}

function toDedupProfile(existing: {
  company_registration_number: string | null;
  website: string | null;
  legal_name: string | null;
  display_name: string | null;
}): DedupProfile {
  let domain: string | null = null;
  if (existing.website) {
    try {
      domain = new URL(
        /^https?:\/\//i.test(existing.website)
          ? existing.website
          : `https://${existing.website}`,
      ).hostname.replace(/^www\./i, "");
    } catch {
      domain = null;
    }
  }
  return {
    registrationNumber: existing.company_registration_number,
    websiteDomain: domain,
    legalName: existing.legal_name,
    displayName: existing.display_name,
    city: null,
  };
}

export function scoreRow(
  row: ValidatedCompanyRow,
  matches: DuplicateMatch[],
): ScoredCompanyRow {
  const duplicateLevel = highestDuplicateLevel(matches);
  const validationStatus =
    duplicateLevel !== "NEW" &&
    duplicateLevel !== "EXACT" &&
    row.validationStatus === "VALID"
      ? "QUARANTINED"
      : row.validationStatus;
  return {
    ...row,
    duplicateLevel,
    duplicateMatches: matches,
    validationStatus,
  };
}
