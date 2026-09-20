// Allowlist du lot pilote France (Phase 8, Décision 1) — les 13 numéros
// SIREN classés APPROVED_FOR_IMPORT lors de l'audit (identité légale
// confirmée via la source ouverte officielle). Source de vérité unique,
// partagée entre scripts/import-companies.ts (import réel, déjà exécuté
// pour ce lot) et scripts/verify-siren-87.ts (vérification en lecture
// seule des 87 lignes restantes du même fichier).
export const PILOT_APPROVED_SIRENS = new Set([
  "349357343",
  "314397696",
  "562082909",
  "778127613",
  "560801706",
  "552059024",
  "572050169",
  "384711909",
  "414969584",
  "500212188",
  "819252701",
  "818791840",
  "414127605",
]);
