import { z } from "zod";

/**
 * Le formulaire de publication reste volontairement court (voir
 * PROJECT_SPEC.md) : pas de titre à saisir (composé automatiquement), pas
 * de champ financier obligatoire.
 */
export const opportunitySchema = z.object({
  capabilityTypeCode: z.string().min(1, "Merci de choisir une catégorie."),
  direction: z.enum(["seeking", "offering"]),
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
  deadline: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Date invalide."),
  estimatedValue: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || !Number.isNaN(Number(v)),
      "Valeur numérique invalide.",
    ),
  currencyCode: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || v.length === 3,
      "Le code devise doit contenir 3 lettres (ex. EUR, CAD).",
    ),
});
export type OpportunityInput = z.infer<typeof opportunitySchema>;

export const opportunityResponseSchema = z.object({
  respondingCompanyId: z.string().uuid("Merci de choisir une entreprise."),
  message: z.string().trim().max(2000, "2000 caractères maximum.").optional(),
});
export type OpportunityResponseInput = z.infer<
  typeof opportunityResponseSchema
>;
