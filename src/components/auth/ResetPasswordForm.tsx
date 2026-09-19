"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/validations/auth";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

type LinkStatus = "checking" | "valid" | "invalid";

/**
 * Le lien reçu par courriel établit une session de récupération temporaire
 * (soit via un paramètre ?code=, soit via le fragment d'URL, géré
 * automatiquement par le client Supabase). Cette session ne permet qu'une
 * chose : appeler updateUser({ password }) une fois.
 */
export function ResetPasswordForm() {
  const t = useTranslations("Auth.ResetPassword");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<LinkStatus>("checking");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    const supabase = createClient();
    let resolved = false;

    const resolve = (valid: boolean) => {
      if (resolved) return;
      resolved = true;
      setStatus(valid ? "valid" : "invalid");
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") resolve(true);
    });

    const code = searchParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        resolve(!error);
      });
    } else {
      // Repli : le client a peut-être déjà traité un fragment d'URL au chargement.
      supabase.auth.getSession().then(({ data }) => resolve(!!data.session));
    }

    const timeout = setTimeout(() => resolve(false), 4000);
    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [searchParams]);

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    });
    if (error) {
      setFormError(tCommon("errorGeneric"));
      return;
    }
    router.push("/compte");
    router.refresh();
  }

  if (status === "checking") {
    return <p className="text-sm text-slate-500">{tCommon("loading")}</p>;
  }

  if (status === "invalid") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        {t("invalidLink")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField
        label={t("password")}
        htmlFor="password"
        error={errors.password?.message}
      >
        <input
          id="password"
          type="password"
          className={inputClasses}
          {...register("password")}
        />
      </FormField>

      <FormField
        label={t("confirmPassword")}
        htmlFor="confirmPassword"
        error={errors.confirmPassword?.message}
      >
        <input
          id="confirmPassword"
          type="password"
          className={inputClasses}
          {...register("confirmPassword")}
        />
      </FormField>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting}>
        {isSubmitting ? tCommon("loading") : t("submit")}
      </SubmitButton>
    </form>
  );
}
