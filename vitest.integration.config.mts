import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Configuration séparée pour les tests d'intégration : ceux-ci appellent le
 * vrai projet Supabase par le réseau (voir tests/integration/setup.ts) et ne
 * doivent donc jamais faire partie de `npm test` (rapide, hors-ligne,
 * déterministe). Exécution : `npm run test:integration`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Voir tests/integration/server-only-stub.ts : neutralise le paquet
      // "server-only" hors du bundler Next.js, pour pouvoir appeler
      // directement le moteur de matching (serveur) depuis un test Node.
      "server-only": path.resolve(
        import.meta.dirname,
        "./tests/integration/server-only-stub.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // Les allers-retours réseau réels (création d'utilisateurs, RPC...)
    // sont plus lents qu'un test unitaire.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Phase 10C (dette CHANGELOG.md, mise à jour du 2026-09-23) : les
    // fichiers exécutés en parallèle par vitest ouvrent plusieurs sessions
    // Auth simultanément, ce qui a déclenché des échecs par limite de
    // débit contre fcp-preprod même après avoir relevé cette limite —
    // confirmé d'abord via `--no-file-parallelism` en ligne de commande,
    // rendu permanent ici. N'affecte pas vitest.config.mts (tests
    // unitaires, toujours parallèles).
    fileParallelism: false,
  },
});
