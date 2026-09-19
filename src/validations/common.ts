import { z } from "zod";

/**
 * Schémas de validation réutilisables (Zod), partagés entre plusieurs
 * formulaires à venir (compte, entreprise...). On les centralise ici pour
 * ne pas répéter les mêmes règles à plusieurs endroits du code.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Le courriel est requis.")
  .email("Format de courriel invalide.");

export const professionalWebsiteSchema = z
  .string()
  .trim()
  .url("L'adresse du site doit être une URL valide (ex. https://...).");

export const countryCodeSchema = z
  .string()
  .length(2, "Le code pays doit contenir 2 lettres (norme ISO 3166-1 alpha-2).")
  .toUpperCase();
