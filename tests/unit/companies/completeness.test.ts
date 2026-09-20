import { describe, expect, it } from "vitest";
import {
  computeCompanyCompleteness,
  computeCompanyActivation,
  buildActivationChecklist,
  type CompanyCompletenessInput,
  type ActivationChecklistInput,
} from "@/lib/companies/completeness";

function input(
  overrides: Partial<CompanyCompletenessInput> = {},
): CompanyCompletenessInput {
  return {
    hasDescription: false,
    hasIndustry: false,
    hasLocation: false,
    hasActiveOfferOrNeed: false,
    ...overrides,
  };
}

describe("computeCompanyCompleteness (Phase 10C, §1 — complétude ≠ activation)", () => {
  it("aucun critère -> 0 %", () => {
    expect(computeCompanyCompleteness(input()).percent).toBe(0);
  });

  it("un seul critère -> 25 %", () => {
    expect(
      computeCompanyCompleteness(input({ hasDescription: true })).percent,
    ).toBe(25);
  });

  it("deux critères -> 50 %", () => {
    expect(
      computeCompanyCompleteness(
        input({ hasDescription: true, hasIndustry: true }),
      ).percent,
    ).toBe(50);
  });

  it("trois critères -> 75 % même si le critère offre/besoin manque", () => {
    const result = computeCompanyCompleteness(
      input({ hasDescription: true, hasIndustry: true, hasLocation: true }),
    );
    expect(result.percent).toBe(75);
    expect(result.criteria.offerOrNeed).toBe(false);
  });

  it("tous les critères -> 100 %", () => {
    expect(
      computeCompanyCompleteness(
        input({
          hasDescription: true,
          hasIndustry: true,
          hasLocation: true,
          hasActiveOfferOrNeed: true,
        }),
      ).percent,
    ).toBe(100);
  });
});

describe("computeCompanyActivation (Phase 10C, §1)", () => {
  it("75 % de complétude mais non revendiquée -> non activée", () => {
    const result = computeCompanyActivation({
      ...input({ hasDescription: true, hasIndustry: true, hasLocation: true }),
      isClaimed: false,
    });
    expect(result.isActivated).toBe(false);
    expect(result.missingCriteria).toContain("claimed");
  });

  it("75 % de complétude, revendiquée, mais aucune offre/besoin -> non activée (§1 : ne jamais présenter comme presque matchable)", () => {
    const result = computeCompanyActivation({
      ...input({ hasDescription: true, hasIndustry: true, hasLocation: true }),
      isClaimed: true,
    });
    expect(result.isActivated).toBe(false);
    expect(result.missingCriteria).toEqual(["offerOrNeed"]);
  });

  it("tous les critères + revendiquée -> activée", () => {
    const result = computeCompanyActivation({
      ...input({
        hasDescription: true,
        hasIndustry: true,
        hasLocation: true,
        hasActiveOfferOrNeed: true,
      }),
      isClaimed: true,
    });
    expect(result.isActivated).toBe(true);
    expect(result.missingCriteria).toEqual([]);
  });

  it("aucun critère et non revendiquée -> liste complète des critères manquants", () => {
    const result = computeCompanyActivation({ ...input(), isClaimed: false });
    expect(result.missingCriteria).toEqual([
      "claimed",
      "description",
      "industry",
      "location",
      "offerOrNeed",
    ]);
  });
});

function checklistInput(
  overrides: Partial<ActivationChecklistInput> = {},
): ActivationChecklistInput {
  return {
    hasDescription: false,
    hasIndustry: false,
    hasLocation: false,
    hasProductsServices: false,
    hasActiveOffer: false,
    hasActiveNeed: false,
    hasTargetMarket: false,
    hasPotentialPartners: false,
    ...overrides,
  };
}

describe("buildActivationChecklist (Phase 10C, §2 — onboarding léger)", () => {
  it("rien renseigné -> les 6 étapes sont non terminées", () => {
    const items = buildActivationChecklist(checklistInput());
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.done === false)).toBe(true);
    expect(items.map((i) => i.id)).toEqual([
      "profile",
      "productsServices",
      "offer",
      "need",
      "markets",
      "viewPartners",
    ]);
  });

  it("'profile' exige les 3 critères ensemble, pas un seul", () => {
    const partial = buildActivationChecklist(
      checklistInput({ hasDescription: true, hasIndustry: true }),
    );
    expect(partial.find((i) => i.id === "profile")?.done).toBe(false);

    const complete = buildActivationChecklist(
      checklistInput({
        hasDescription: true,
        hasIndustry: true,
        hasLocation: true,
      }),
    );
    expect(complete.find((i) => i.id === "profile")?.done).toBe(true);
  });

  it("chaque étape restante reflète son propre indicateur indépendamment", () => {
    const items = buildActivationChecklist(
      checklistInput({ hasActiveOffer: true, hasTargetMarket: true }),
    );
    expect(items.find((i) => i.id === "offer")?.done).toBe(true);
    expect(items.find((i) => i.id === "need")?.done).toBe(false);
    expect(items.find((i) => i.id === "markets")?.done).toBe(true);
    expect(items.find((i) => i.id === "productsServices")?.done).toBe(false);
    expect(items.find((i) => i.id === "viewPartners")?.done).toBe(false);
  });
});
