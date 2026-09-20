/**
 * Formes communes du pipeline d'import (Phase 8). Voir docs/IMPORT_PIPELINE.md
 * pour l'architecture complète. Les valeurs des unions ci-dessous DOIVENT
 * rester synchronisées avec les contraintes CHECK de
 * supabase/migrations/0020_import_pipeline.sql.
 */

export type BatchStatus =
  | "PENDING"
  | "VALIDATING"
  | "READY"
  | "IMPORTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ValidationStatus = "VALID" | "WARNING" | "REJECTED" | "QUARANTINED";

export type DuplicateLevel =
  "EXACT" | "VERY_LIKELY" | "POSSIBLE" | "UNLIKELY" | "NEW";

export type EmailClassification =
  | "GENERIC_BUSINESS"
  | "NAMED_BUSINESS"
  | "PUBLIC_PROVIDER"
  | "INVALID"
  | "UNKNOWN";

export type IssueSeverity = "WARNING" | "ERROR";

export interface RowIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  fieldName?: string;
}

/**
 * Une ligne source déjà normalisée, prête à être écrite dans
 * staging_companies. Une valeur `null` signifie "absente ou reconnue comme
 * jeton de valeur manquante" (voir normalization.ts) — jamais une chaîne
 * vide silencieuse.
 */
export interface NormalizedCompanyRow {
  rowNumber: number;
  sourceRecordId: string | null;

  raw: {
    displayName: string | null;
    legalName: string | null;
    registrationNumber: string | null;
    website: string | null;
    phone: string | null;
    email: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    postalCode: string | null;
    address: string | null;
    sectorCode: string | null;
    sectorLabel: string | null;
    description: string | null;
  };

  normalized: {
    displayName: string | null;
    legalName: string | null;
    registrationNumber: string | null;
    website: string | null;
    websiteDomain: string | null;
    phone: string | null;
    email: string | null;
    emailClassification: EmailClassification;
    countryCode: string | null;
    region: string | null;
    city: string | null;
    postalCode: string | null;
    address: string | null;
    description: string | null;
  };

  /** Copie brute complète de la ligne source — audit uniquement, voir migration 0020. */
  rawRecord: Record<string, string>;
}

export interface ValidatedCompanyRow extends NormalizedCompanyRow {
  validationStatus: ValidationStatus;
  issues: RowIssue[];
}

export interface DuplicateMatch {
  level: Exclude<DuplicateLevel, "NEW">;
  signal:
    "registration_number" | "website_domain" | "name_location" | "name_only";
  existingCompanyId?: string;
  otherRowNumber?: number;
}

export interface ScoredCompanyRow extends ValidatedCompanyRow {
  duplicateLevel: DuplicateLevel;
  duplicateMatches: DuplicateMatch[];
}
