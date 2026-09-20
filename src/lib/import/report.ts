// Pas de garde "server-only" ici : ce module doit aussi pouvoir tourner
// en script CLI autonome (scripts/import-companies.ts, via tsx), un
// contexte que "server-only" ne reconnaît pas (il ne détecte que le
// bundler Next.js). Aucune page/Client Component n'importe ce module —
// le risque qu'il visait à prévenir ne s'applique pas ici.
import type { SupabaseClient } from "@supabase/supabase-js";

/** supabase-js type parfois une relation embarquée en tableau — voir la même précaution ailleurs dans le projet. */
function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/**
 * Rapport lisible après dry run/import (§11/§25 de la demande Phase 8).
 * Lit uniquement les tables du pipeline — jamais de recalcul, pour que le
 * rapport reflète exactement ce qui a été écrit en staging.
 */
export async function buildBatchReport(
  supabase: SupabaseClient,
  batchId: string,
): Promise<string> {
  const { data: batch } = await supabase
    .from("import_batches")
    .select(
      "*, data_sources(name, license_status, commercial_use_allowed, license_name)",
    )
    .eq("id", batchId)
    .single();
  if (!batch) throw new Error(`Batch ${batchId} introuvable.`);

  const { data: rows } = await supabase
    .from("staging_companies")
    .select(
      `row_number, normalized_display_name, normalized_registration_number, normalized_website_domain,
       normalized_email, email_classification, validation_status, duplicate_level, created_company_id`,
    )
    .eq("batch_id", batchId)
    .order("row_number");

  const { data: issues } = await supabase
    .from("import_row_issues")
    .select(
      "staging_company_id, severity, code, message, field_name, staging_companies(row_number)",
    )
    .eq("batch_id", batchId);

  const { data: duplicates } = await supabase
    .from("import_duplicate_candidates")
    .select(
      "match_level, match_signal, staging_companies(row_number, normalized_display_name)",
    )
    .eq("batch_id", batchId);

  const source = one(batch.data_sources);

  const lines: string[] = [];
  lines.push(`# Batch ${batch.batch_name}`);
  lines.push(`Fichier : ${batch.filename}`);
  lines.push(
    `Source : ${source?.name ?? "inconnue"} (licence : ${source?.license_status ?? "inconnue"})`,
  );
  lines.push(
    `Mode : ${batch.dry_run ? "DRY RUN (aucune écriture réelle)" : "IMPORT RÉEL"}`,
  );
  lines.push(`Statut : ${batch.status}`);
  lines.push("");
  lines.push(`Lignes reçues : ${batch.rows_received}`);
  lines.push(`Valides : ${batch.rows_valid}`);
  lines.push(`Avec avertissement : ${batch.rows_warning}`);
  lines.push(`Mises en quarantaine : ${batch.rows_quarantined}`);
  lines.push(`Rejetées : ${batch.rows_rejected}`);
  lines.push(`Nouvelles entreprises candidates : ${batch.rows_new}`);
  lines.push(
    `Doublons exacts (rattachées à une entreprise existante) : ${batch.rows_existing}`,
  );
  lines.push(`Doublons possibles (quarantaine) : ${batch.rows_duplicates}`);
  if (!batch.dry_run) {
    lines.push(`Entreprises créées : ${batch.rows_created}`);
    lines.push(
      `Entreprises existantes mises à jour/rattachées : ${batch.rows_updated}`,
    );
  }
  lines.push("");

  lines.push("## Détail par ligne");
  for (const row of rows ?? []) {
    const emailNote =
      row.email_classification && row.email_classification !== "UNKNOWN"
        ? ` — courriel : ${row.email_classification}`
        : "";
    lines.push(
      `- Ligne ${row.row_number} : ${row.normalized_display_name ?? "(nom absent)"} ` +
        `[${row.validation_status}, doublon=${row.duplicate_level ?? "NEW"}]${emailNote}` +
        (row.created_company_id
          ? ` → companies.id=${row.created_company_id}`
          : ""),
    );
  }
  lines.push("");

  if ((issues ?? []).length > 0) {
    lines.push("## Anomalies");
    for (const issue of issues ?? []) {
      const staging = one(issue.staging_companies);
      lines.push(
        `- [${issue.severity}] Ligne ${staging?.row_number} — ${issue.code} : ${issue.message}`,
      );
    }
    lines.push("");
  }

  if ((duplicates ?? []).length > 0) {
    lines.push(
      "## Doublons candidats (arbitrage humain requis, jamais fusionnés automatiquement)",
    );
    for (const dup of duplicates ?? []) {
      const staging = one(dup.staging_companies);
      lines.push(
        `- Ligne ${staging?.row_number} (${staging?.normalized_display_name}) — ${dup.match_level} via ${dup.match_signal}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
