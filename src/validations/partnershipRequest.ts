import { z } from "zod";

/**
 * Formulaire de demande de mise en relation (Phase 9). La logique métier
 * (permissions, statut des entreprises, intégrité de la provenance,
 * doublons) est entièrement recalculée côté base par
 * create_partnership_request() — ce schéma ne valide que la forme des
 * champs. Sujet/message ne sont JAMAIS générés automatiquement (§6) : ce
 * formulaire ne pré-remplit rien à partir du score de matching.
 */
export const partnershipRequestSchema = z.object({
  requesterCompanyId: z.string().uuid(),
  subject: z
    .string()
    .trim()
    .min(1, "Le sujet est requis.")
    .max(200, "200 caractères maximum."),
  message: z
    .string()
    .trim()
    .min(1, "Le message est requis.")
    .max(2000, "2000 caractères maximum."),
});
export type PartnershipRequestInput = z.infer<typeof partnershipRequestSchema>;
