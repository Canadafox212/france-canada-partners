import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

/**
 * Client Supabase avec la clé SECRÈTE (contourne la sécurité par ligne).
 * Réservé aux traitements serveur de confiance qui doivent écrire des
 * données qu'aucun utilisateur ne doit pouvoir fabriquer lui-même — ici,
 * les résultats du moteur de matching (voir supabase/migrations/0016,
 * qui n'autorise AUCUNE écriture cliente sur matches/opportunity_matches).
 * Ne jamais importer ce fichier depuis du code exécuté dans le navigateur.
 */
export function createServiceRoleClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = getServerEnv();
  return createSupabaseClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
