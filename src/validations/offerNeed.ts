import { z } from "zod";

/**
 * Schéma partagé par une offre ("Nous proposons") et un besoin ("Nous
 * recherchons") : les deux ont la même forme structurelle, seul
 * `soughtEmployeeRange` n'a de sens que pour un besoin (ignoré côté offre).
 * Le titre n'est pas saisi ici : il est composé automatiquement par
 * l'application (voir src/lib/offersNeeds.ts) pour garder le formulaire
 * rapide à remplir, conformément à la demande.
 */
export const offerNeedSchema = z.object({
  capabilityTypeCode: z.string().min(1, "Merci de choisir une catégorie."),
  productServiceIds: z.array(z.string().uuid()).default([]),
  industryId: z.string().uuid().optional().or(z.literal("")),
  targetCountryCode: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || v.length === 2,
      "Le code pays doit contenir 2 lettres (ex. FR, CA).",
    ),
  targetRegion: z.string().trim().max(120).optional(),
  description: z
    .string()
    .trim()
    .max(2000, "2000 caractères maximum.")
    .optional(),
  languageCodes: z.array(z.string()).default([]),
  soughtEmployeeRange: z.string().trim().max(50).optional(),
});
export type OfferNeedInput = z.infer<typeof offerNeedSchema>;
