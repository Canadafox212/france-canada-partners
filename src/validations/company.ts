import { z } from "zod";
import { countryCodeSchema } from "@/validations/common";

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^https?:\/\/.+/i.test(v), {
    message: "L'adresse du site doit commencer par http:// ou https://.",
  });

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || z.string().email().safeParse(v).success, {
    message: "Format de courriel invalide.",
  });

export const createCompanySchema = z.object({
  displayName: z.string().trim().min(2, "Le nom commercial est requis."),
  legalName: z.string().trim().optional(),
  countryCode: countryCodeSchema,
  region: z.string().trim().optional(),
  city: z.string().trim().optional(),
  website: optionalUrl,
  professionalEmail: optionalEmail,
  phone: z.string().trim().optional(),
  industryId: z.string().uuid().optional().or(z.literal("")),
  description: z
    .string()
    .trim()
    .max(2000, "2000 caractères maximum.")
    .optional(),
  descriptionLocale: z.enum(["fr", "en"]),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** Champs modifiables par un owner/admin — jamais subscription_level ni
 * verification_status, protégés côté base par un déclencheur (voir
 * supabase/migrations/0009_protect_sensitive_columns.sql). */
export const editCompanySchema = z.object({
  displayName: z.string().trim().min(2, "Le nom commercial est requis."),
  legalName: z.string().trim().optional(),
  website: optionalUrl,
  professionalEmail: optionalEmail,
  phone: z.string().trim().optional(),
  region: z.string().trim().optional(),
  city: z.string().trim().optional(),
  description: z
    .string()
    .trim()
    .max(2000, "2000 caractères maximum.")
    .optional(),
});
export type EditCompanyInput = z.infer<typeof editCompanySchema>;

export const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Votre nom est requis."),
  preferredLanguage: z.enum(["fr", "en"]),
});
export type ProfileInput = z.infer<typeof profileSchema>;
