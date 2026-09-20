import { describe, expect, it } from "vitest";
import { shouldIndexDirectoryPage } from "@/lib/directory/search";

describe("shouldIndexDirectoryPage (§25)", () => {
  it("n'indexe jamais une recherche libre", () => {
    expect(
      shouldIndexDirectoryPage({
        hasFreeTextQuery: true,
        activeStructuralFilterCount: 0,
        resultCount: 100,
      }),
    ).toBe(false);
  });

  it("n'indexe pas une combinaison de plusieurs filtres structurels", () => {
    expect(
      shouldIndexDirectoryPage({
        hasFreeTextQuery: false,
        activeStructuralFilterCount: 2,
        resultCount: 100,
      }),
    ).toBe(false);
  });

  it("n'indexe pas en dessous du seuil minimal de résultats", () => {
    expect(
      shouldIndexDirectoryPage({
        hasFreeTextQuery: false,
        activeStructuralFilterCount: 1,
        resultCount: 4,
      }),
    ).toBe(false);
  });

  it("indexe un unique filtre structurel avec assez de résultats", () => {
    expect(
      shouldIndexDirectoryPage({
        hasFreeTextQuery: false,
        activeStructuralFilterCount: 1,
        resultCount: 5,
      }),
    ).toBe(true);
  });

  it("indexe la liste non filtrée si elle a assez de résultats", () => {
    expect(
      shouldIndexDirectoryPage({
        hasFreeTextQuery: false,
        activeStructuralFilterCount: 0,
        resultCount: 5,
      }),
    ).toBe(true);
  });
});
