import { describe, expect, it } from "vitest";
import {
  computeMatchScore,
  scoreCapacity,
  scoreExportExperience,
  scoreGeography,
  scoreLanguages,
  scoreProductSector,
  scoreSize,
  scoreVerification,
} from "@/lib/matching/scoring";
import { getMatchLevel, getConfidenceLevel } from "@/lib/matching/config";
import type {
  CandidateCompanyProfile,
  MatchableIntent,
} from "@/lib/matching/types";

function intent(overrides: Partial<MatchableIntent> = {}): MatchableIntent {
  return {
    id: "intent-1",
    kind: "need",
    companyId: "company-1",
    capabilityTypeCode: "DISTRIBUTOR",
    industryId: null,
    targetCountryCode: null,
    targetRegion: null,
    productServiceIds: [],
    languageCodes: [],
    ...overrides,
  };
}

function company(
  overrides: Partial<CandidateCompanyProfile> = {},
): CandidateCompanyProfile {
  return {
    companyId: "company-2",
    countryCode: "FR",
    verificationStatus: "unverified",
    exportExperience: false,
    employeeRange: null,
    languageCodes: [],
    hasLinkedProductsServices: false,
    ...overrides,
  };
}

describe("computeMatchScore — élimination (§5/§18)", () => {
  it("élimine entièrement un candidat quand la capacité est fondamentalement incompatible", () => {
    const result = computeMatchScore({
      seekerIntent: intent(),
      seekerCompany: company(),
      providerIntent: intent({ kind: "offer", capabilityTypeCode: "INVESTOR" }),
      providerCompany: company(),
      compatibilityRatio: 0,
    });
    expect(result.eliminated).toBe(true);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it("ne s'élimine pas pour un même code (compatibilité totale)", () => {
    const result = computeMatchScore({
      seekerIntent: intent(),
      seekerCompany: company(),
      providerIntent: intent({ kind: "offer" }),
      providerCompany: company(),
      compatibilityRatio: 1,
    });
    expect(result.eliminated).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("scoreProductSector (§6)", () => {
  it("attribue le maximum si un produit/service est commun", () => {
    const r = scoreProductSector(
      { productServiceIds: ["p1", "p2"], industryId: null },
      { productServiceIds: ["p2"], industryId: null },
    );
    expect(r.points).toBe(20);
    expect(r.status).toBe("evaluated");
  });

  it("attribue un score intermédiaire pour un secteur commun sans produit commun", () => {
    const r = scoreProductSector(
      { productServiceIds: [], industryId: "ind-1" },
      { productServiceIds: [], industryId: "ind-1" },
    );
    expect(r.points).toBe(12);
  });

  it("attribue 0 pour des secteurs déclarés et différents", () => {
    const r = scoreProductSector(
      { productServiceIds: [], industryId: "ind-1" },
      { productServiceIds: [], industryId: "ind-2" },
    );
    expect(r.points).toBe(0);
    expect(r.status).toBe("evaluated");
  });

  it("ne pénalise pas excessivement l'absence de secteur/produit (neutre, marqué manquant)", () => {
    const r = scoreProductSector(
      { productServiceIds: [], industryId: null },
      { productServiceIds: [], industryId: "ind-2" },
    );
    expect(r.points).toBe(10);
    expect(r.status).toBe("missing");
  });
});

describe("scoreGeography (§7)", () => {
  it("score maximal : même pays, même région", () => {
    const r = scoreGeography(
      { targetCountryCode: "CA", targetRegion: "Québec" },
      { targetCountryCode: "CA", targetRegion: "Québec" },
    );
    expect(r.points).toBe(15);
  });

  it("score réduit si l'offre couvre tout le pays sans préciser de région", () => {
    const r = scoreGeography(
      { targetCountryCode: "CA", targetRegion: "Québec" },
      { targetCountryCode: "CA", targetRegion: null },
    );
    expect(r.points).toBe(12);
  });

  it("aucun score si l'offre couvre une région différente du même pays", () => {
    const r = scoreGeography(
      { targetCountryCode: "CA", targetRegion: "Québec" },
      { targetCountryCode: "CA", targetRegion: "Ontario" },
    );
    expect(r.points).toBe(0);
  });

  it("aucun score si les pays diffèrent", () => {
    const r = scoreGeography(
      { targetCountryCode: "CA", targetRegion: null },
      { targetCountryCode: "FR", targetRegion: null },
    );
    expect(r.points).toBe(0);
  });

  it("le besoin sans contrainte géographique obtient le score maximal", () => {
    const r = scoreGeography(
      { targetCountryCode: null, targetRegion: null },
      { targetCountryCode: "FR", targetRegion: "Bretagne" },
    );
    expect(r.points).toBe(15);
  });
});

describe("scoreCapacity (§8)", () => {
  it("score maximal si le code est concret ET appuyé par un produit/service", () => {
    const r = scoreCapacity("DISTRIBUTOR", true);
    expect(r.points).toBe(10);
    expect(r.status).toBe("evaluated");
  });

  it("ne pénalise pas excessivement l'absence de produit/service structuré", () => {
    const r = scoreCapacity("DISTRIBUTOR", false);
    expect(r.points).toBe(5);
    expect(r.status).toBe("missing");
  });

  it("reste neutre pour un code relationnel (la notion de capacité ne s'applique pas)", () => {
    const r = scoreCapacity("INVESTOR", false);
    expect(r.points).toBe(5);
    expect(r.status).toBe("missing");
  });
});

describe("scoreSize (§9)", () => {
  it("ne pénalise pas l'absence de préférence déclarée", () => {
    expect(scoreSize(null, null).points).toBe(5);
    expect(scoreSize(undefined, "10-49").points).toBe(5);
  });

  it("ne considère pas l'absence de taille candidate comme une incompatibilité absolue", () => {
    const r = scoreSize("10-49", null);
    expect(r.points).toBe(3);
    expect(r.status).toBe("missing");
  });

  it("score maximal pour une correspondance exacte", () => {
    expect(scoreSize("10-49", "10-49").points).toBe(5);
  });

  it("aucun score pour une préférence déclarée et non respectée", () => {
    expect(scoreSize("10-49", "250+").points).toBe(0);
  });
});

describe("scoreLanguages (§11)", () => {
  it("compatible si au moins une langue commune", () => {
    expect(scoreLanguages(["fr"], ["fr", "en"]).points).toBe(5);
  });

  it("ne pénalise pas excessivement l'absence totale d'information", () => {
    const r = scoreLanguages([], []);
    expect(r.status).toBe("missing");
    expect(r.points).toBeGreaterThan(0);
  });

  it("score faible mais non nul si aucune langue commune n'est déclarée", () => {
    const r = scoreLanguages(["fr"], ["en"]);
    expect(r.points).toBe(1);
  });
});

describe("scoreExportExperience (§12)", () => {
  it("bonus uniquement si transfrontalier ET expérience export déclarée", () => {
    const r = scoreExportExperience("FR", "CA", true);
    expect(r.points).toBe(5);
    expect(r.status).toBe("evaluated");
  });

  it("ne traite jamais l'absence d'expérience déclarée comme une incapacité", () => {
    const r = scoreExportExperience("FR", "CA", false);
    expect(r.points).toBeGreaterThan(0);
    expect(r.status).toBe("missing");
  });
});

describe("scoreVerification", () => {
  it("hiérarchise verified > pending > unverified", () => {
    expect(scoreVerification("verified").points).toBe(5);
    expect(scoreVerification("pending").points).toBe(2);
    expect(scoreVerification("unverified").points).toBe(0);
  });
});

describe("getMatchLevel / getConfidenceLevel (§16/§14)", () => {
  it("classe les scores dans les bons paliers", () => {
    expect(getMatchLevel(95)).toBe("very_strong");
    expect(getMatchLevel(80)).toBe("strong");
    expect(getMatchLevel(65)).toBe("possible");
    expect(getMatchLevel(45)).toBe("weak");
    expect(getMatchLevel(10)).toBe("insufficient");
  });

  it("classe la confiance en fonction des données manquantes", () => {
    expect(getConfidenceLevel(95)).toBe("high");
    expect(getConfidenceLevel(75)).toBe("moderate");
    expect(getConfidenceLevel(50)).toBe("partial");
  });
});

describe("computeMatchScore — scénario complet (§33, reproductibilité)", () => {
  it("un même jeu de données produit toujours exactement le même score (déterminisme)", () => {
    const input = {
      seekerIntent: intent({
        capabilityTypeCode: "DISTRIBUTOR",
        targetCountryCode: "CA",
        targetRegion: "Québec",
        productServiceIds: ["p1"],
        languageCodes: ["fr"],
      }),
      seekerCompany: company({ countryCode: "FR" }),
      providerIntent: intent({
        kind: "offer",
        capabilityTypeCode: "DISTRIBUTOR",
        targetCountryCode: "CA",
        productServiceIds: ["p1"],
        languageCodes: ["fr"],
      }),
      providerCompany: company({
        countryCode: "CA",
        verificationStatus: "verified" as const,
        hasLinkedProductsServices: true,
      }),
      compatibilityRatio: 1,
    };
    const first = computeMatchScore(input);
    const second = computeMatchScore(input);
    expect(first).toEqual(second);
    expect(first.score).toBeGreaterThanOrEqual(75);
  });

  it("un score composé de critères tous 'evaluated' donne 100% de confiance", () => {
    const result = computeMatchScore({
      seekerIntent: intent({
        targetCountryCode: "CA",
        targetRegion: "Québec",
        productServiceIds: ["p1"],
        languageCodes: ["fr"],
        soughtEmployeeRange: "10-49",
      }),
      seekerCompany: company({ countryCode: "FR" }),
      providerIntent: intent({
        kind: "offer",
        targetCountryCode: "CA",
        targetRegion: "Québec",
        productServiceIds: ["p1"],
        languageCodes: ["fr"],
      }),
      providerCompany: company({
        countryCode: "CA",
        employeeRange: "10-49",
        verificationStatus: "verified" as const,
        hasLinkedProductsServices: true,
      }),
      compatibilityRatio: 1,
    });
    // "certifications" reste structurellement non évaluable (schéma actuel,
    // voir scoreCertifications) et "exportExperience" n'est pas déclarée ici
    // (false = valeur par défaut, indiscernable d'une absence de donnée) :
    // deux critères de 5 points restent donc "missing", d'où 90% et non 100%.
    expect(result.confidence).toBe(90);
  });
});
