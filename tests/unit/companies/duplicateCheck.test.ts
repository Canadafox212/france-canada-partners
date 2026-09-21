import { describe, expect, it } from "vitest";
import {
  scoreSimilarCompanies,
  hasBlockingDuplicate,
  type SimilarCompanyCandidate,
} from "@/lib/companies/duplicateCheck";

function candidate(
  overrides: Partial<SimilarCompanyCandidate> = {},
): SimilarCompanyCandidate {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    displayName: "Figeac Aero",
    legalName: "Figeac Aero SAS",
    slug: "figeac-aero",
    website: "https://www.figeac-aero.com",
    countryCode: "FR",
    region: "Occitanie",
    city: "Figeac",
    isClaimed: false,
    registrationNumberMatch: false,
    ...overrides,
  };
}

describe("scoreSimilarCompanies (Phase 10C, LOT 10C-2)", () => {
  it("registrationNumberMatch=true (calculé côté SQL) -> EXACT, sans jamais comparer de numéro brut", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Nom totalement différent" },
      [candidate({ registrationNumberMatch: true, displayName: "Autre nom", legalName: null })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].comparison).toEqual({
      level: "EXACT",
      signal: "registration_number",
    });
  });

  it("registrationNumberMatch=false n'entraîne jamais un signal registration_number à lui seul", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Nom totalement différent" },
      [candidate({ registrationNumberMatch: false, displayName: "Autre nom", legalName: null, website: null })],
    );
    expect(result).toEqual([]);
  });

  it("domaine identique (même sans protocole ni www) -> VERY_LIKELY", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Figeac Aéro", website: "figeac-aero.com" },
      [candidate()],
    );
    expect(result).toHaveLength(1);
    expect(result[0].comparison.level).toBe("VERY_LIKELY");
  });

  it("nom + ville identiques -> POSSIBLE", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Figeac Aero", city: "Figeac" },
      [candidate({ website: null })],
    );
    expect(result[0].comparison.level).toBe("POSSIBLE");
  });

  it("nom seul, ville différente -> UNLIKELY, jamais bloquant", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Figeac Aero", city: "Lyon" },
      [candidate({ website: null, city: "Figeac" })],
    );
    expect(result[0].comparison.level).toBe("UNLIKELY");
    expect(hasBlockingDuplicate(result)).toBe(false);
  });

  it("entreprise sans rapport -> aucun résultat", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Entreprise Sans Rapport", website: "autre-domaine.com" },
      [candidate()],
    );
    expect(result).toEqual([]);
    expect(hasBlockingDuplicate(result)).toBe(false);
  });

  it("trie EXACT/VERY_LIKELY avant POSSIBLE/UNLIKELY", () => {
    const result = scoreSimilarCompanies(
      { displayName: "Figeac Aero", website: "figeac-aero.com", city: "Figeac" },
      [
        candidate({ id: "a", website: null, city: "Lyon" }), // UNLIKELY (nom seul)
        candidate({ id: "b" }), // VERY_LIKELY (domaine)
      ],
    );
    expect(result.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("hasBlockingDuplicate est vrai seulement pour EXACT/VERY_LIKELY", () => {
    expect(
      hasBlockingDuplicate([
        { ...candidate(), comparison: { level: "POSSIBLE", signal: "name_location" } },
      ]),
    ).toBe(false);
    expect(
      hasBlockingDuplicate([
        { ...candidate(), comparison: { level: "VERY_LIKELY", signal: "website_domain" } },
      ]),
    ).toBe(true);
    expect(hasBlockingDuplicate(null)).toBe(false);
  });
});
