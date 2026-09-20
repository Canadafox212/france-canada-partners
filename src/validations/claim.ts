import { z } from "zod";
import { emailSchema } from "./common";

/**
 * Formulaire de revendication d'entreprise (Phase 7, §14-§17). La décision
 * finale (auto-approbation, ou mise en attente pour examen manuel) est
 * calculée côté base par submit_company_claim() — ce schéma ne valide que
 * la forme des champs, jamais la logique métier.
 */
export const claimCompanySchema = z.object({
  professionalEmail: emailSchema,
  justification: z
    .string()
    .trim()
    .max(1000, "1000 caractères maximum.")
    .optional(),
});
export type ClaimCompanyInput = z.infer<typeof claimCompanySchema>;

export const reviewCompanyClaimSchema = z.object({
  claimId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(1000, "1000 caractères maximum.").optional(),
});
export type ReviewCompanyClaimInput = z.infer<typeof reviewCompanyClaimSchema>;
