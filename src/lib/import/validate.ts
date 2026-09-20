import type {
  NormalizedCompanyRow,
  RowIssue,
  ValidatedCompanyRow,
  ValidationStatus,
} from "./types";

/**
 * Règles de validation minimales (§23/§24 du cahier des charges Phase 8) :
 * une ligne problématique ne doit jamais faire échouer tout le batch —
 * elle est marquée et continue d'exister en staging pour examen.
 */
export function validateRow(row: NormalizedCompanyRow): ValidatedCompanyRow {
  const issues: RowIssue[] = [];

  if (!row.normalized.displayName) {
    issues.push({
      severity: "ERROR",
      code: "MISSING_NAME",
      message: "Nom d'entreprise absent.",
      fieldName: "displayName",
    });
  }

  if (!row.normalized.countryCode) {
    issues.push({
      severity: "WARNING",
      code: "UNKNOWN_COUNTRY",
      message: "Pays non reconnu — mis en quarantaine pour vérification.",
      fieldName: "country",
    });
  }

  if (row.raw.website && !row.normalized.websiteDomain) {
    issues.push({
      severity: "WARNING",
      code: "INVALID_WEBSITE",
      message: "URL de site invalide, conservée telle quelle.",
      fieldName: "website",
    });
  }

  if (!row.normalized.city && !row.normalized.region) {
    issues.push({
      severity: "WARNING",
      code: "MISSING_LOCATION",
      message: "Aucune localisation renseignée.",
      fieldName: "city",
    });
  }

  if (!row.normalized.registrationNumber) {
    issues.push({
      severity: "WARNING",
      code: "MISSING_REGISTRATION_NUMBER",
      message:
        "Aucun numéro d'entreprise officiel — dédoublonnage moins fiable pour cette ligne.",
      fieldName: "registrationNumber",
    });
  }

  const hasError = issues.some((i) => i.severity === "ERROR");
  const hasUnknownCountry = issues.some((i) => i.code === "UNKNOWN_COUNTRY");

  let status: ValidationStatus;
  if (hasError) status = "REJECTED";
  else if (hasUnknownCountry) status = "QUARANTINED";
  else if (issues.length > 0) status = "WARNING";
  else status = "VALID";

  return { ...row, validationStatus: status, issues };
}
