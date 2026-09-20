import { describe, expect, it } from "vitest";
import { validateRow } from "@/lib/import/validate";
import type { NormalizedCompanyRow } from "@/lib/import/types";

function row(
  overrides: Partial<NormalizedCompanyRow["normalized"]> = {},
): NormalizedCompanyRow {
  return {
    rowNumber: 1,
    sourceRecordId: "349357343",
    raw: {
      displayName: "FIGEAC AERO",
      legalName: "FIGEAC AERO",
      registrationNumber: "349357343",
      website: "https://figeac-aero.com",
      phone: null,
      email: null,
      country: "France",
      region: "Occitanie",
      city: "Figeac",
      postalCode: "46100",
      address: null,
      sectorCode: "3316Z",
      sectorLabel: "Aéronautique / spatial",
      description: null,
    },
    normalized: {
      displayName: "FIGEAC AERO",
      legalName: "FIGEAC AERO",
      registrationNumber: "349357343",
      website: "https://figeac-aero.com",
      websiteDomain: "figeac-aero.com",
      phone: null,
      email: null,
      emailClassification: "UNKNOWN",
      countryCode: "FR",
      region: "Occitanie",
      city: "Figeac",
      postalCode: "46100",
      address: null,
      description: null,
      ...overrides,
    },
    rawRecord: {},
  };
}

describe("validateRow (§23/§24 de la demande Phase 8)", () => {
  it("une ligne complète est VALID", () => {
    expect(validateRow(row()).validationStatus).toBe("VALID");
  });

  it("nom absent -> REJECTED", () => {
    const result = validateRow(row({ displayName: null }));
    expect(result.validationStatus).toBe("REJECTED");
    expect(
      result.issues.some(
        (i) => i.code === "MISSING_NAME" && i.severity === "ERROR",
      ),
    ).toBe(true);
  });

  it("pays inconnu -> QUARANTINED", () => {
    const result = validateRow(row({ countryCode: null }));
    expect(result.validationStatus).toBe("QUARANTINED");
  });

  it("URL invalide -> WARNING (jamais rejetée pour ce seul motif)", () => {
    const result = validateRow(row({ websiteDomain: null }));
    expect(result.validationStatus).toBe("WARNING");
    expect(result.issues.some((i) => i.code === "INVALID_WEBSITE")).toBe(true);
  });

  it("le rejet (ERROR) prime toujours sur les avertissements", () => {
    const result = validateRow(row({ displayName: null, countryCode: null }));
    expect(result.validationStatus).toBe("REJECTED");
  });
});
