import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/supabase/session";
import { SignOutButton } from "@/components/account/SignOutButton";

export async function Header() {
  const [t, user] = await Promise.all([
    getTranslations("Header"),
    getCurrentUser(),
  ]);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
      <Link href="/" className="font-semibold text-slate-900 dark:text-white">
        France-Canada Partners
      </Link>
      <nav className="flex items-center gap-4">
        {user ? (
          <>
            <Link
              href="/compte"
              className="text-sm text-slate-700 hover:underline dark:text-slate-200"
            >
              {t("account")}
            </Link>
            <SignOutButton />
          </>
        ) : (
          <Link
            href="/connexion"
            className="text-sm text-slate-700 hover:underline dark:text-slate-200"
          >
            {t("login")}
          </Link>
        )}
      </nav>
    </header>
  );
}
