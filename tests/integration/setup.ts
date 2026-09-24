import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { assertPreprodSupabaseUrl } from "./productionGuard";

/**
 * Depuis la Phase 10C (dette documentée dans CHANGELOG.md) : les tests
 * d'intégration ne lisent plus .env.local (production) mais un fichier
 * séparé, jamais versionné, pointant vers un projet Supabase de
 * PRÉPRODUCTION dédié — voir .env.preprod.local.example. .env.local
 * continue d'être utilisé, inchangé, par l'application elle-même
 * (npm run dev, Vercel) : ce fichier ne le lit plus du tout.
 */
const envPath = path.resolve(import.meta.dirname, "../../.env.preprod.local");

if (!existsSync(envPath)) {
  throw new Error(
    ".env.preprod.local introuvable : les tests d'intégration nécessitent un projet Supabase de PRÉPRODUCTION dédié, jamais la production — copiez .env.preprod.local.example et renseignez les identifiants de ce projet.",
  );
}

// Découpage sur /\r?\n/ (pas seulement "\n") : un fichier édité sous
// Windows (Bloc-notes) utilise des fins de ligne CRLF, et ".*" ne
// correspond jamais à "\r" en JavaScript — avec un simple split("\n"),
// chaque ligne se terminerait par un "\r" résiduel et la regex ci-dessous
// échouerait silencieusement sur TOUTES les lignes.
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    // Écrase toujours une valeur déjà présente dans process.env — jamais
    // l'inverse. .env.preprod.local doit rester la source de vérité
    // unique pour ces variables dans ce processus de test, y compris si
    // quelque chose d'autre les avait déjà positionnées avant ce fichier.
    process.env[m[1]] = m[2].trim();
  }
}

// Sécurité (Phase 10C, dette documentée dans CHANGELOG.md) : les tests
// d'intégration ne doivent plus jamais s'exécuter contre la production,
// ni contre un projet Supabase autre que le préprod attendu. Logique
// extraite dans productionGuard.ts pour être testable sans réseau — voir
// tests/unit/productionGuard.test.ts.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
assertPreprodSupabaseUrl(supabaseUrl);
