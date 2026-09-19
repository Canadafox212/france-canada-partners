import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

/**
 * Client Supabase pour le code serveur (Server Components, Server Actions).
 * Utilise encore la clé publique ici : c'est l'identité de l'utilisateur
 * connecté (via ses cookies de session) qui détermine ses droits réels.
 * Pour un accès administrateur complet contournant la sécurité par ligne,
 * voir la clé secrète (SUPABASE_SECRET_KEY, réservée aux tâches d'admin —
 * pas encore utilisée à cette phase).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } =
    getPublicEnv();

  return createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Appelé depuis un Server Component : sans effet si une session
            // est déjà rafraîchie ailleurs (proxy, à mettre en place en Phase 3).
          }
        },
      },
    },
  );
}
