import { z } from "zod";

/**
 * Variables sûres à exposer au navigateur (préfixe NEXT_PUBLIC_).
 * La clé "publishable" est la clé Supabase à privilégiée pour tout nouveau
 * projet (remplace l'ancienne clé "anon") : elle ne donne accès qu'à ce que
 * les règles de sécurité (Row Level Security) autorisent explicitement.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  // Utilisée pour les URLs absolues (sitemap, canonical, Open Graph — voir
  // PROJECT_SPEC.md Phase 7 §24/§26). Optionnelle : un environnement de
  // développement ou de test sans nom de domaine réel se replie sur
  // localhost plutôt que d'échouer — voir getSiteUrl() ci-dessous.
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
});

/**
 * Variables réservées au serveur. SUPABASE_SECRET_KEY donne un accès complet
 * à la base (contourne la sécurité par ligne) : elle ne doit jamais être lue
 * en dehors du code serveur, ni préfixée par NEXT_PUBLIC_.
 */
const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => issue.path.join(".")).join(", ");
}

/** À utiliser dans le code exécuté côté navigateur (Client Components). */
export function getPublicEnv() {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    throw new Error(
      `Variables d'environnement publiques manquantes ou invalides : ${formatIssues(
        parsed.error,
      )}. Copiez .env.example vers .env.local et renseignez vos identifiants Supabase.`,
    );
  }

  return parsed.data;
}

/** URL absolue du site (sans slash final), pour sitemap/canonical/Open Graph. */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return (configured ?? "http://localhost:3000").replace(/\/$/, "");
}

/** À utiliser uniquement dans du code serveur (Server Components, Server Actions, routes API). */
export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Variables d'environnement serveur manquantes ou invalides : ${formatIssues(
        parsed.error,
      )}. Copiez .env.example vers .env.local et renseignez vos identifiants Supabase.`,
    );
  }

  return parsed.data;
}
