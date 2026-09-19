import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Identité de l'utilisateur connecté, basée sur getClaims() (vérifie la
 * signature du jeton) — jamais getSession()/getUser() seules pour une
 * décision de sécurité. Voir docs/SECURITY.md.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return {
    id: data.claims.sub as string,
    email: data.claims.email as string | undefined,
  };
}

/**
 * Enregistrement complet de l'utilisateur (courriel, statut de
 * confirmation...) depuis le serveur d'authentification. À utiliser pour de
 * l'affichage, pas pour une décision de sécurité (voir getCurrentUser).
 */
export async function getCurrentAuthUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, preferred_language, platform_role")
    .eq("id", user.id)
    .single();

  return profile ? { ...profile, email: user.email } : null;
}

/** Entreprises auxquelles l'utilisateur connecté appartient, avec son rôle. */
export async function getCurrentUserCompanies() {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("company_members")
    .select("role, status, companies(id, display_name, slug, status)")
    .eq("user_id", user.id)
    .eq("status", "active");

  return data ?? [];
}
