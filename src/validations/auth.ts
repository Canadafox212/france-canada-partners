import { z } from "zod";
import { emailSchema } from "@/validations/common";

/** Nouveau mot de passe (inscription, réinitialisation) : règle minimale. */
export const newPasswordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Le mot de passe est requis."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, "Votre nom est requis."),
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
