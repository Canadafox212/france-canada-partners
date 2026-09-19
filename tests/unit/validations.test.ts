import { describe, expect, it } from "vitest";
import {
  countryCodeSchema,
  emailSchema,
  professionalWebsiteSchema,
} from "@/validations/common";

describe("emailSchema", () => {
  it("accepte un courriel valide", () => {
    expect(emailSchema.parse("contact@entreprise.fr")).toBe(
      "contact@entreprise.fr",
    );
  });

  it("rejette un courriel invalide", () => {
    expect(() => emailSchema.parse("pas-un-courriel")).toThrow();
  });
});

describe("professionalWebsiteSchema", () => {
  it("accepte une URL valide", () => {
    expect(professionalWebsiteSchema.parse("https://exemple.com")).toBe(
      "https://exemple.com",
    );
  });

  it("rejette une chaîne qui n'est pas une URL", () => {
    expect(() => professionalWebsiteSchema.parse("exemple")).toThrow();
  });
});

describe("countryCodeSchema", () => {
  it("met en majuscules un code pays valide", () => {
    expect(countryCodeSchema.parse("fr")).toBe("FR");
  });

  it("rejette un code de mauvaise longueur", () => {
    expect(() => countryCodeSchema.parse("france")).toThrow();
  });
});
