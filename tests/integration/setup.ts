import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(import.meta.dirname, "../../.env.local");

if (!existsSync(envPath)) {
  throw new Error(
    ".env.local introuvable : les tests d'intégration nécessitent une connexion à un vrai projet Supabase (voir README.md).",
  );
}

for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim();
  }
}
