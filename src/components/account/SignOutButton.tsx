"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { SubmitButton } from "@/components/ui/Button";

export function SignOutButton() {
  const t = useTranslations("Header");
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <form
      action={async () => {
        await handleSignOut();
      }}
    >
      <SubmitButton variant="secondary">{t("signOut")}</SubmitButton>
    </form>
  );
}
