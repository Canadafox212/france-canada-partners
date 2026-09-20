import { describe, expect, it } from "vitest";
import {
  classifyEmail,
  isPublishableAutomatically,
} from "@/lib/import/emailClassification";

describe("classifyEmail (§6 de la demande Phase 8)", () => {
  it("classe une adresse générique d'entreprise", () => {
    expect(classifyEmail("contact@entreprise.fr")).toBe("GENERIC_BUSINESS");
    expect(classifyEmail("info@entreprise.fr")).toBe("GENERIC_BUSINESS");
  });

  it("classe une adresse nominative", () => {
    expect(classifyEmail("philippe.dupont@entreprise.fr")).toBe(
      "NAMED_BUSINESS",
    );
  });

  it("classe un fournisseur grand public", () => {
    expect(classifyEmail("nom@gmail.com")).toBe("PUBLIC_PROVIDER");
  });

  it("classe une adresse mal formée comme invalide", () => {
    expect(classifyEmail("pas-une-adresse")).toBe("INVALID");
  });

  it("classe une valeur absente comme inconnue", () => {
    expect(classifyEmail("Non disponible")).toBe("UNKNOWN");
    expect(classifyEmail(null)).toBe("UNKNOWN");
  });
});

describe("isPublishableAutomatically", () => {
  it("n'autorise que GENERIC_BUSINESS", () => {
    expect(isPublishableAutomatically("GENERIC_BUSINESS")).toBe(true);
    expect(isPublishableAutomatically("NAMED_BUSINESS")).toBe(false);
    expect(isPublishableAutomatically("PUBLIC_PROVIDER")).toBe(false);
    expect(isPublishableAutomatically("INVALID")).toBe(false);
    expect(isPublishableAutomatically("UNKNOWN")).toBe(false);
  });
});
