/**
 * Garde-fou anti-production, extrait de setup.ts pour être testable sans
 * réseau (voir tests/unit/productionGuard.test.ts) — comportement inchangé
 * par l'extraction : mêmes identifiants, mêmes messages, même ordre de
 * vérification qu'avant.
 */
const PRODUCTION_PROJECT_REF = "exfhxhoragpphrksdcjf";
const EXPECTED_PREPROD_PROJECT_REF = "eowveslvhbufomsdkhzt"; // fcp-preprod

export function assertPreprodSupabaseUrl(supabaseUrl: string): void {
  if (supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `SÉCURITÉ : NEXT_PUBLIC_SUPABASE_URL pointe vers le projet Supabase de PRODUCTION (identifiant "${PRODUCTION_PROJECT_REF}" détecté dans "${supabaseUrl}"). ` +
        "Les tests d'intégration ne doivent jamais s'exécuter contre la production — vérifiez .env.preprod.local.",
    );
  }

  if (!supabaseUrl.includes(EXPECTED_PREPROD_PROJECT_REF)) {
    throw new Error(
      `SÉCURITÉ : NEXT_PUBLIC_SUPABASE_URL ne pointe pas vers le projet de préproduction attendu (identifiant "${EXPECTED_PREPROD_PROJECT_REF}" absent de "${supabaseUrl}"). ` +
        "Vérifiez .env.preprod.local.",
    );
  }
}
