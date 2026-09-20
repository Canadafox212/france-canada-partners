/**
 * Fonctions de normalisation, toutes PURES (aucun accès réseau/DB) pour
 * rester testables unitairement sans dépendre d'une base de données — voir
 * tests/unit/import/normalization.test.ts. La valeur source originale
 * n'est jamais perdue : ces fonctions ne modifient que ce qui est écrit
 * dans les colonnes `normalized_*` de `staging_companies`, jamais les
 * colonnes `raw_*` (voir columnMapping.ts).
 */

/**
 * Jetons utilisés dans les fichiers sources pour signaler une valeur
 * manquante ou non confirmée (voir docs/DATA_INVENTORY.md §5, point 3).
 * Reconnus indépendamment de la casse/des accents.
 */
const PLACEHOLDER_TOKENS = new Set([
  "non disponible",
  "non applicable",
  "a confirmer",
  "à confirmer",
  "a enrichir",
  "à enrichir",
  "n/a",
  "na",
  "inconnu",
  "",
]);

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** true si la valeur doit être traitée comme NULL (jamais comme une vraie donnée). */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  const normalized = stripAccents(value.trim().toLowerCase());
  return PLACEHOLDER_TOKENS.has(normalized);
}

/** Nettoie une valeur texte libre : trim + reconnaissance des jetons de valeur absente. */
export function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return isPlaceholderValue(trimmed) ? null : trimmed;
}

export function normalizeCompanyName(
  value: string | null | undefined,
): string | null {
  return normalizeText(value);
}

/**
 * Conserve uniquement les chiffres. Ne valide PAS la clé de contrôle SIREN
 * (algorithme de Luhn) : hors périmètre de cette phase — un identifiant de
 * longueur invalide déclenche un avertissement, pas un rejet silencieux
 * (voir columnMapping.ts / validate.ts).
 */
export function normalizeRegistrationNumber(
  value: string | null | undefined,
): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const digitsOnly = text.replace(/\D/g, "");
  return digitsOnly.length > 0 ? digitsOnly : null;
}

export interface NormalizedWebsite {
  url: string | null;
  domain: string | null;
}

/**
 * `https://www.example.com/chemin` → domaine comparable `example.com`,
 * tout en conservant l'URL complète (avec son schéma) pour affichage —
 * §11 du cahier des charges Phase 8.
 */
export function normalizeWebsite(
  value: string | null | undefined,
): NormalizedWebsite {
  const text = normalizeText(value);
  if (!text) return { url: null, domain: null };

  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(withScheme);
    const domain = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return { url: text, domain: domain || null };
  } catch {
    // URL invalide : on conserve la valeur source telle quelle plutôt que
    // de la rejeter uniquement pour ce motif (cohérent avec §12 pour le
    // téléphone) — un avertissement est levé par le code appelant.
    return { url: text, domain: null };
  }
}

/**
 * Tentative de normalisation E.164 minimaliste (France/Canada). En cas
 * d'échec, la valeur source est conservée telle quelle — jamais rejetée
 * pour ce seul motif (§12 du cahier des charges Phase 8).
 */
export function normalizePhone(
  value: string | null | undefined,
): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const digits = text.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `+33${digits.slice(1)}`; // France
  if (/^1?\d{10}$/.test(digits.replace(/^1/, ""))) {
    const local = digits.replace(/^1/, "");
    if (local.length === 10) return `+1${local}`; // Canada/Québec
  }
  return text;
}

const COUNTRY_ALIASES: Record<string, string> = {
  france: "FR",
  fr: "FR",
  canada: "CA",
  "canada - quebec": "CA",
  "canada - québec": "CA",
  quebec: "CA",
  québec: "CA",
};

export function normalizeCountryCode(
  value: string | null | undefined,
): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  const key = stripAccents(text.toLowerCase());
  return COUNTRY_ALIASES[key] ?? null;
}

export function normalizeRegion(
  value: string | null | undefined,
): string | null {
  return normalizeText(value);
}

export function normalizeCity(value: string | null | undefined): string | null {
  return normalizeText(value);
}

export function normalizePostalCode(
  value: string | null | undefined,
): string | null {
  const text = normalizeText(value);
  return text ? text.replace(/\s+/g, " ").trim() : null;
}
