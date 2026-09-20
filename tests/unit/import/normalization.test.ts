import { describe, expect, it } from "vitest";
import {
  isPlaceholderValue,
  normalizeCountryCode,
  normalizePhone,
  normalizeRegistrationNumber,
  normalizeText,
  normalizeWebsite,
} from "@/lib/import/normalization";

describe("isPlaceholderValue", () => {
  it("reconnaît les jetons de valeur absente indépendamment de la casse/accents", () => {
    expect(isPlaceholderValue("Non disponible")).toBe(true);
    expect(isPlaceholderValue("NON APPLICABLE")).toBe(true);
    expect(isPlaceholderValue("à confirmer")).toBe(true);
    expect(isPlaceholderValue("a confirmer")).toBe(true);
    expect(isPlaceholderValue("")).toBe(true);
    expect(isPlaceholderValue(null)).toBe(true);
  });

  it("ne rejette pas une vraie valeur", () => {
    expect(isPlaceholderValue("FIGEAC AERO")).toBe(false);
  });
});

describe("normalizeText", () => {
  it("conserve une vraie valeur en supprimant les espaces superflus", () => {
    expect(normalizeText("  FIGEAC   AERO  ")).toBe("FIGEAC AERO");
  });

  it("retourne null pour un jeton de valeur absente (jamais une chaîne vide silencieuse)", () => {
    expect(normalizeText("Non disponible")).toBeNull();
  });
});

describe("normalizeRegistrationNumber", () => {
  it("conserve uniquement les chiffres", () => {
    expect(normalizeRegistrationNumber("349 357 343")).toBe("349357343");
  });

  it("retourne null pour une valeur absente", () => {
    expect(normalizeRegistrationNumber("Non disponible")).toBeNull();
  });
});

describe("normalizeWebsite", () => {
  it("extrait un domaine comparable sans www ni schéma", () => {
    expect(normalizeWebsite("https://www.example.com/contact").domain).toBe(
      "example.com",
    );
    expect(normalizeWebsite("http://example.com").domain).toBe("example.com");
    expect(normalizeWebsite("example.com").domain).toBe("example.com");
  });

  it("conserve l'URL publique complète", () => {
    expect(normalizeWebsite("https://www.example.com/contact").url).toBe(
      "https://www.example.com/contact",
    );
  });

  it("conserve la valeur source si l'URL est invalide, sans la rejeter", () => {
    const result = normalizeWebsite("pas une url du tout ///");
    expect(result.url).not.toBeNull();
    expect(result.domain).toBeNull();
  });

  it("retourne des valeurs nulles pour une valeur absente", () => {
    expect(normalizeWebsite("Non disponible")).toEqual({
      url: null,
      domain: null,
    });
  });
});

describe("normalizePhone", () => {
  it("normalise un numéro français en E.164", () => {
    expect(normalizePhone("01 23 45 67 89")).toBe("+33123456789");
  });

  it("normalise un numéro canadien à 10 chiffres en E.164", () => {
    expect(normalizePhone("514 555 1234")).toBe("+15145551234");
  });

  it("conserve la valeur source si la normalisation échoue, ne rejette jamais pour ce seul motif", () => {
    expect(normalizePhone("numéro incomplet")).toBe("numéro incomplet");
  });

  it("retourne null pour une valeur absente", () => {
    expect(normalizePhone("Non disponible")).toBeNull();
  });
});

describe("normalizeCountryCode", () => {
  it("reconnaît les variantes France/Québec/Canada", () => {
    expect(normalizeCountryCode("France")).toBe("FR");
    expect(normalizeCountryCode("Canada - Québec")).toBe("CA");
    expect(normalizeCountryCode("Canada - Quebec")).toBe("CA");
    expect(normalizeCountryCode("FR")).toBe("FR");
  });

  it("retourne null pour une valeur non reconnue plutôt que de deviner", () => {
    expect(normalizeCountryCode("Ruritanie")).toBeNull();
  });
});
