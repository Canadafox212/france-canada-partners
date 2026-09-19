import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Les tests d'intégration (tests/integration/) frappent le vrai projet
    // Supabase par le réseau : ils ont leur propre config, voir
    // `npm run test:integration` et vitest.integration.config.mts.
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
