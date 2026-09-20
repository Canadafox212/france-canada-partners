// Pas de garde "server-only" ici : ce module doit aussi pouvoir tourner
// en script CLI autonome (scripts/import-companies.ts, via tsx), un
// contexte que "server-only" ne reconnaît pas (il ne détecte que le
// bundler Next.js). Aucune page/Client Component n'importe ce module —
// le risque qu'il visait à prévenir ne s'applique pas ici.
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "../utils";
import { isPublishableAutomatically } from "./emailClassification";
import type { ScoredCompanyRow } from "./types";

/**
 * Écriture RÉELLE dans les tables métier — appelée UNIQUEMENT quand
 * `batch.dry_run = false` (voir pipeline.ts). Une ligne EXACT n'est
 * JAMAIS recréée : elle est rattachée à l'entreprise existante (§7/§15 —
 * ne jamais dupliquer une entreprise déjà en base). Une ligne dont le
 * statut n'est pas VALID/WARNING ou dont le niveau de doublon n'est pas
 * EXACT/NEW n'est jamais créée automatiquement — elle reste en
 * quarantaine pour examen humain (§7 : "un POSSIBLE ne doit jamais être
 * fusionné automatiquement").
 */

async function generateUniqueSlug(
  supabase: SupabaseClient,
  displayName: string,
): Promise<string> {
  const base = slugify(displayName) || "entreprise";
  let candidate = base;
  let suffix = 1;
  // Le volume du pilote (13 lignes) rend cette boucle négligeable en coût ;
  // à revoir avec un batch dans une seule requête si un futur import de
  // grande taille le justifie (§42 : ne pas sur-optimiser avant mesure).
  while (true) {
    const { data } = await supabase
      .from("companies")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

export interface CommitResult {
  companyId: string;
  created: boolean;
}

export async function commitStagingRow(
  supabase: SupabaseClient,
  params: {
    stagingId: string;
    batchId: string;
    sourceId: string;
    row: ScoredCompanyRow;
    /**
     * Certaines sources sont approuvées pour l'IDENTITÉ légale (SIRENE)
     * sans que ce même statut couvre nécessairement un champ "description"
     * séparé, potentiellement issu du site de l'entreprise elle-même
     * (texte commercial propre à l'entreprise, pas un fait de registre) —
     * voir docs/DATA_SOURCES.md et la condition explicite "aucun contenu
     * commercial existant généré par inférence" du lot pilote. Par défaut
     * `true` (une source future pourrait couvrir aussi la description) ;
     * mis à `false` pour ce pilote France par `scripts/import-companies.ts`.
     */
    includeDescription?: boolean;
  },
): Promise<CommitResult> {
  const {
    stagingId,
    batchId,
    sourceId,
    row,
    includeDescription = true,
  } = params;

  if (row.duplicateLevel === "EXACT") {
    const existingCompanyId = row.duplicateMatches.find(
      (m) => m.level === "EXACT",
    )?.existingCompanyId;
    if (!existingCompanyId)
      throw new Error("Niveau EXACT sans entreprise existante référencée.");
    await linkSourceRecord(supabase, existingCompanyId, sourceId, batchId, row);
    await supabase
      .from("staging_companies")
      .update({ created_company_id: existingCompanyId })
      .eq("id", stagingId);
    return { companyId: existingCompanyId, created: false };
  }

  if (row.duplicateLevel !== "NEW") {
    throw new Error(
      `Ligne ${row.rowNumber} en quarantaine (niveau ${row.duplicateLevel}) — ne peut pas être créée automatiquement, nécessite un arbitrage humain.`,
    );
  }
  if (row.validationStatus !== "VALID" && row.validationStatus !== "WARNING") {
    throw new Error(
      `Ligne ${row.rowNumber} au statut ${row.validationStatus} — non éligible à la création.`,
    );
  }
  if (!row.normalized.displayName || !row.normalized.countryCode) {
    throw new Error(
      `Ligne ${row.rowNumber} : nom ou pays manquant, ne devrait pas être VALID/WARNING.`,
    );
  }

  const slug = await generateUniqueSlug(supabase, row.normalized.displayName);
  const professionalEmail = isPublishableAutomatically(
    row.normalized.emailClassification,
  )
    ? row.normalized.email
    : null;

  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      legal_name: row.normalized.legalName || row.normalized.displayName,
      display_name: row.normalized.displayName,
      slug,
      website: row.normalized.website,
      professional_email: professionalEmail,
      phone: row.normalized.phone,
      company_registration_number: row.normalized.registrationNumber,
      country_code: row.normalized.countryCode,
      // Toujours 'draft' à l'import (§13/§22 : IMPORTED_DRAFT) — jamais
      // publiée automatiquement, un contrôle manuel reste nécessaire
      // avant qu'elle apparaisse dans l'annuaire public.
      status: "draft",
    })
    .select("id")
    .single();
  if (error)
    throw new Error(
      `Création de l'entreprise (ligne ${row.rowNumber}) impossible : ${error.message}`,
    );
  const companyId = company.id as string;

  if (row.normalized.city || row.normalized.region || row.normalized.address) {
    await supabase.from("company_locations").insert({
      company_id: companyId,
      location_type: "headquarters",
      is_primary: true,
      address_line_1: row.normalized.address,
      city: row.normalized.city,
      region: row.normalized.region,
      postal_code: row.normalized.postalCode,
      country_code: row.normalized.countryCode,
    });
  }

  if (includeDescription && row.normalized.description) {
    await supabase.from("company_translations").insert({
      company_id: companyId,
      locale: "fr",
      description: row.normalized.description,
    });
  }

  await linkSourceRecord(supabase, companyId, sourceId, batchId, row);
  await supabase
    .from("staging_companies")
    .update({ created_company_id: companyId })
    .eq("id", stagingId);

  return { companyId, created: true };
}

async function linkSourceRecord(
  supabase: SupabaseClient,
  companyId: string,
  sourceId: string,
  batchId: string,
  row: ScoredCompanyRow,
) {
  const { error } = await supabase.from("company_source_records").insert({
    company_id: companyId,
    data_source_id: sourceId,
    source_record_id: row.sourceRecordId,
    import_batch_id: batchId,
    raw_reference: `row:${row.rowNumber}`,
    last_verified_at: new Date().toISOString(),
  });
  if (error)
    throw new Error(
      `Traçabilité de la source (ligne ${row.rowNumber}) impossible : ${error.message}`,
    );
}
