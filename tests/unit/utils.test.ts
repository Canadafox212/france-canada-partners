import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/utils";

describe("slugify", () => {
  it("retire les accents et met en minuscules", () => {
    expect(slugify("Établissements Général Électrique")).toBe(
      "etablissements-general-electrique",
    );
  });

  it("remplace les caractères non alphanumériques par des tirets", () => {
    expect(slugify("Fromagerie & Cie (Québec)")).toBe("fromagerie-cie-quebec");
  });

  it("retire les tirets en début et fin de chaîne", () => {
    expect(slugify("  -Test-  ")).toBe("test");
  });
});
