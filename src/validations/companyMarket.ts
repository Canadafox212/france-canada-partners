import { z } from "zod";
import { countryCodeSchema } from "@/validations/common";

/**
 * Marché ciblé (Phase 10C, checklist d'activation §2 — "Indiquer nos
 * marchés cibles"). Seul market_type='target' est couvert par ce
 * formulaire minimal : company_markets.market_type='current' existe en
 * base mais n'a pas d'usage produit identifié pour l'instant, pas
 * construit tant que le besoin n'est pas confirmé.
 */
export const companyMarketSchema = z.object({
  countryCode: countryCodeSchema,
  region: z.string().trim().max(200).optional(),
  city: z.string().trim().max(200).optional(),
});

export type CompanyMarketInput = z.infer<typeof companyMarketSchema>;
