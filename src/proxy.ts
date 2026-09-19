import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { getPublicEnv } from "@/lib/env";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Combine deux responsabilités qui doivent s'exécuter avant chaque page :
 * 1) le routage de langue (next-intl) — redirige "/" vers "/fr", etc. ;
 * 2) le rafraîchissement de la session Supabase, pour que l'utilisateur ne
 *    soit jamais déconnecté silencieusement (voir docs/ARCHITECTURE.md).
 *
 * On part de la réponse produite par next-intl (qui peut être une
 * redirection ou une réécriture) et on y ajoute les cookies de session
 * rafraîchis, plutôt que de créer une réponse séparée qui perdrait la
 * décision de routage de langue.
 */
export default async function proxy(request: NextRequest) {
  const response = intlMiddleware(request) ?? NextResponse.next({ request });

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } =
    getPublicEnv();

  const supabase = createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Ne jamais utiliser getSession() ici : elle ne revalide pas le jeton.
  // getClaims() vérifie la signature à chaque appel et rafraîchit la
  // session si besoin — voir docs/SECURITY.md.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // Applique le proxy à toutes les routes, sauf API, fichiers internes
  // Next.js et fichiers statiques (contenant un point).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
