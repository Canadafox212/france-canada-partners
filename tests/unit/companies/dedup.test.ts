import { describe, expect, it } from "vitest";
import {
  compareForDuplicate,
  highestDuplicateLevel,
} from "@/lib/companies/dedup";
import type { DedupProfile } from "@/lib/companies/dedup";

/**
 * Déplacé depuis tests/unit/import/dedup.test.ts (Phase 10C, LOT 10C-2) en
 * même temps que la logique elle-même — comportement inchangé, voir
 * src/lib/companies/dedup.ts. Le pipeline d'import (src/lib/import/staging.ts)
 * réutilise ce même module sans aucune divergence de règle.
 */

function profile(overrides: Partial<DedupProfile> = {}): DedupProfile {
  return {
    registrationNumber: null,
    websiteDomain: null,
    legalName: null,
    displayName: null,
    city: null,
    ...overrides,
  };
}

describe("compareForDuplicate (§7/§13/§14 de la demande Phase 8, déplacé Phase 10C)", () => {
  it("numéro d'entreprise identique -> EXACT", () => {
    const result = compareForDuplicate(
      profile({ registrationNumber: "349357343" }),
      profile({ registrationNumber: "349357343" }),
    );
    expect(result).toEqual({ level: "EXACT", signal: "registration_number" });
  });

  it("domaine identique -> VERY_LIKELY", () => {
    const result = compareForDuplicate(
      profile({ websiteDomain: "figeac-aero.com" }),
      profile({ websiteDomain: "figeac-aero.com" }),
    );
    expect(result).toEqual({ level: "VERY_LIKELY", signal: "website_domain" });
  });

  it("nom + ville -> POSSIBLE", () => {
    const result = compareForDuplicate(
      profile({ displayName: "Figeac Aero", city: "Figeac" }),
      profile({ displayName: "Figeac Aero", city: "Figeac" }),
    );
    expect(result).toEqual({ level: "POSSIBLE", signal: "name_location" });
  });

  it("nom seul, sans ville commune -> UNLIKELY, jamais une preuve suffisante à lui seul", () => {
    const result = compareForDuplicate(
      profile({ displayName: "Figeac Aero", city: "Figeac" }),
      profile({ displayName: "Figeac Aero", city: "Lyon" }),
    );
    expect(result).toEqual({ level: "UNLIKELY", signal: "name_only" });
  });

  it("aucune correspondance -> null (NEW)", () => {
    const result = compareForDuplicate(
      profile({ displayName: "Entreprise A" }),
      profile({ displayName: "Entreprise B" }),
    );
    expect(result).toBeNull();
  });

  it("priorise le numéro officiel même si le domaine diffère", () => {
    const result = compareForDuplicate(
      profile({
        registrationNumber: "349357343",
        websiteDomain: "autre-domaine.com",
      }),
      profile({
        registrationNumber: "349357343",
        websiteDomain: "figeac-aero.com",
      }),
    );
    expect(result?.level).toBe("EXACT");
  });
});

describe("highestDuplicateLevel", () => {
  it("retourne NEW si aucune correspondance", () => {
    expect(highestDuplicateLevel([])).toBe("NEW");
  });

  it("retourne le niveau le plus élevé parmi plusieurs correspondances", () => {
    expect(
      highestDuplicateLevel([
        { level: "UNLIKELY", signal: "name_only" },
        { level: "EXACT", signal: "registration_number" },
        { level: "POSSIBLE", signal: "name_location" },
      ]),
    ).toBe("EXACT");
  });
});
