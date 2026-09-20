"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/Button";

/** Action utile simple (§30) : copie l'URL courante, aucun état serveur. */
export function CopyLinkButton() {
  const t = useTranslations("CompanyPublic");
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé, permission
      // refusée) : pas de crash, simplement pas de confirmation visuelle.
    }
  }

  return (
    <SubmitButton type="button" variant="secondary" onClick={handleClick}>
      {copied ? t("copyLinkDone") : t("copyLinkAction")}
    </SubmitButton>
  );
}
