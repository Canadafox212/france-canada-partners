import { classifyEmail, normalizeEmail } from "./emailClassification";
import {
  normalizeCity,
  normalizeCompanyName,
  normalizeCountryCode,
  normalizePhone,
  normalizePostalCode,
  normalizeRegion,
  normalizeRegistrationNumber,
  normalizeText,
  normalizeWebsite,
} from "./normalization";
import type { NormalizedCompanyRow } from "./types";

/**
 * Correspondance colonne source → modèle interne pour
 * `entreprises_france_5000.csv` (voir docs/DATA_MAPPING.md). Un seul
 * mappeur pour l'instant — le Québec n'est pas importé cette phase (voir
 * docs/QUEBEC_SOURCING_STRATEGY.md), donc aucun mappeur générique
 * multi-format n'est construit avant d'en avoir un second cas réel.
 */
export function mapFranceCsvRow(
  row: Record<string, string>,
  rowNumber: number,
): NormalizedCompanyRow {
  const raw = {
    displayName: row.Nom_Entreprise ?? null,
    legalName: row.Raison_Sociale ?? null,
    registrationNumber: row.SIREN ?? null,
    website: row.Site_Web ?? null,
    phone: row.Telephone ?? null,
    email: row.Email ?? null,
    country: row.Pays ?? null,
    region: row.Region ?? null,
    city: row.Ville ?? null,
    postalCode: row.Code_Postal ?? null,
    address: row.Adresse ?? null,
    sectorCode: row.Code_APE ?? null,
    sectorLabel: row.Secteur ?? null,
    description: row.Description ?? null,
  };

  const website = normalizeWebsite(raw.website);
  const email = normalizeEmail(raw.email);

  return {
    rowNumber,
    sourceRecordId: normalizeRegistrationNumber(raw.registrationNumber),
    raw,
    normalized: {
      displayName: normalizeCompanyName(raw.displayName),
      legalName: normalizeCompanyName(raw.legalName),
      registrationNumber: normalizeRegistrationNumber(raw.registrationNumber),
      website: website.url,
      websiteDomain: website.domain,
      phone: normalizePhone(raw.phone),
      email,
      emailClassification: classifyEmail(raw.email),
      countryCode: normalizeCountryCode(raw.country),
      region: normalizeRegion(raw.region),
      city: normalizeCity(raw.city),
      postalCode: normalizePostalCode(raw.postalCode),
      address: normalizeText(raw.address),
      // La description n'est reprise QUE si la source du batch est déjà
      // approuvée pour la réutilisation commerciale (vérifié au niveau du
      // batch, pas ici) — ce mappeur se contente de nettoyer le texte.
      description: normalizeText(raw.description),
    },
    rawRecord: row,
  };
}
