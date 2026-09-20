import { describe, expect, it } from "vitest";
import { computeCounters } from "@/lib/import/staging";
import type { ScoredCompanyRow } from "@/lib/import/types";

function row(
  overrides: Partial<
    Pick<ScoredCompanyRow, "validationStatus" | "duplicateLevel">
  >,
): ScoredCompanyRow {
  return {
    rowNumber: 1,
    sourceRecordId: null,
    raw: {
      displayName: null,
      legalName: null,
      registrationNumber: null,
      website: null,
      phone: null,
      email: null,
      country: null,
      region: null,
      city: null,
      postalCode: null,
      address: null,
      sectorCode: null,
      sectorLabel: null,
      description: null,
    },
    normalized: {
      displayName: null,
      legalName: null,
      registrationNumber: null,
      website: null,
      websiteDomain: null,
      phone: null,
      email: null,
      emailClassification: "UNKNOWN",
      countryCode: null,
      region: null,
      city: null,
      postalCode: null,
      address: null,
      description: null,
    },
    rawRecord: {},
    validationStatus: "VALID",
    issues: [],
    duplicateLevel: "NEW",
    duplicateMatches: [],
    ...overrides,
  };
}

describe("computeCounters", () => {
  it("une ligne REJECTED ne compte ni comme nouvelle ni comme doublon", () => {
    const counters = computeCounters([
      row({ validationStatus: "VALID", duplicateLevel: "NEW" }),
      row({ validationStatus: "REJECTED", duplicateLevel: "NEW" }),
      row({ validationStatus: "QUARANTINED", duplicateLevel: "NEW" }),
    ]);
    expect(counters.rows_received).toBe(3);
    expect(counters.rows_rejected).toBe(1);
    expect(counters.rows_quarantined).toBe(1);
    // Seules les 2 lignes NON rejetées comptent dans la dimension doublon.
    expect(counters.rows_new).toBe(2);
    expect(counters.rows_existing).toBe(0);
    expect(counters.rows_duplicates).toBe(0);
  });

  it("répartit correctement EXACT et les niveaux de doublon possible", () => {
    const counters = computeCounters([
      row({ validationStatus: "VALID", duplicateLevel: "EXACT" }),
      row({ validationStatus: "QUARANTINED", duplicateLevel: "POSSIBLE" }),
      row({ validationStatus: "QUARANTINED", duplicateLevel: "VERY_LIKELY" }),
    ]);
    expect(counters.rows_existing).toBe(1);
    expect(counters.rows_duplicates).toBe(2);
    expect(counters.rows_new).toBe(0);
  });
});
