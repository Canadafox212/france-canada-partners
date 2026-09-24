import { describe, expect, it } from "vitest";
import { assertPreprodSupabaseUrl } from "../integration/productionGuard";

describe("assertPreprodSupabaseUrl", () => {
  it("refuse le projet de production (exfhxhoragpphrksdcjf)", () => {
    expect(() =>
      assertPreprodSupabaseUrl("https://exfhxhoragpphrksdcjf.supabase.co"),
    ).toThrow(/PRODUCTION/);
  });

  it("refuse un projet inconnu (aaaaaaaaaaaaaaaaaaaa)", () => {
    expect(() =>
      assertPreprodSupabaseUrl("https://aaaaaaaaaaaaaaaaaaaa.supabase.co"),
    ).toThrow(/ne pointe pas vers le projet de préproduction attendu/);
  });

  it("laisse passer le projet de préproduction attendu (eowveslvhbufomsdkhzt)", () => {
    expect(() =>
      assertPreprodSupabaseUrl("https://eowveslvhbufomsdkhzt.supabase.co"),
    ).not.toThrow();
  });
});
