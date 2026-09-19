import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Applique le routage de langue à toutes les routes,
  // sauf API, fichiers internes Next.js et fichiers statiques (contenant un point).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
