"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/Button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("ErrorPage");

  useEffect(() => {
    // Volontairement pas de détail technique affiché à l'utilisateur (pas
    // de message d'erreur brut, pas de trace) — voir docs/SECURITY.md.
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        {t("title")}
      </h1>
      <p className="text-slate-600 dark:text-slate-300">{t("description")}</p>
      <form action={() => reset()}>
        <SubmitButton>{t("retry")}</SubmitButton>
      </form>
    </main>
  );
}
