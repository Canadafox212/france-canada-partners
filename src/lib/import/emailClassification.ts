import { isPlaceholderValue, normalizeText } from "./normalization";
import type { EmailClassification } from "./types";

/**
 * Classification minimale demandée (§6 du cahier des charges Phase 8) :
 * ne publie automatiquement que ce qui respecte la politique de
 * visibilité (voir docs/IMPORT_PIPELINE.md) — jamais un courriel
 * nominatif ni un fournisseur grand public.
 */

const GENERIC_LOCAL_PARTS = [
  "info",
  "contact",
  "sales",
  "commercial",
  "export",
  "hello",
  "bonjour",
  "inquiries",
  "service",
  "admin",
  "direction",
  "office",
  "support",
];

/** Même liste que la revendication d'entreprise (Phase 7) — un domaine grand public ne prouve rien. */
const PUBLIC_PROVIDER_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "yahoo.com",
  "live.com",
  "aol.com",
  "protonmail.com",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(
  value: string | null | undefined,
): string | null {
  const text = normalizeText(value);
  return text ? text.trim().toLowerCase() : null;
}

export function classifyEmail(
  value: string | null | undefined,
): EmailClassification {
  if (isPlaceholderValue(value ?? null)) return "UNKNOWN";
  const email = normalizeEmail(value);
  if (!email) return "UNKNOWN";
  if (!EMAIL_PATTERN.test(email)) return "INVALID";

  const [localPart, domain] = email.split("@");
  if (PUBLIC_PROVIDER_DOMAINS.has(domain)) return "PUBLIC_PROVIDER";
  if (
    GENERIC_LOCAL_PARTS.some(
      (prefix) =>
        localPart === prefix ||
        localPart.startsWith(`${prefix}.`) ||
        localPart.startsWith(`${prefix}-`),
    )
  ) {
    return "GENERIC_BUSINESS";
  }
  // prenom.nom@ / prenom-nom@ : forme la plus courante d'adresse nominative.
  if (/^[a-z]+[.\-][a-z]+$/.test(localPart)) return "NAMED_BUSINESS";
  return "NAMED_BUSINESS";
}

/**
 * Seule une adresse GENERIC_BUSINESS est publiée automatiquement dans
 * companies.professional_email — jamais une adresse nominative, jamais un
 * fournisseur grand public, jamais une adresse invalide (§6 : "pour le
 * premier pilote, aucun courriel nominatif ne doit être publié
 * automatiquement").
 */
export function isPublishableAutomatically(
  classification: EmailClassification,
): boolean {
  return classification === "GENERIC_BUSINESS";
}
