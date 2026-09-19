"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Link, getPathname } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/validations/auth";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";
import type { AppLocale } from "@/i18n/routing";

export function ForgotPasswordForm() {
  const t = useTranslations("Auth.ForgotPassword");
  const tCommon = useTranslations("Common");
  const locale = useLocale() as AppLocale;
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}${getPathname({
      locale,
      href: "/reinitialiser-mot-de-passe",
    })}`;

    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo,
    });

    // Toujours afficher le même message de succès, que le compte existe ou
    // non : ne jamais révéler par ce biais si un courriel est enregistré.
    if (error) {
      setFormError(tCommon("errorGeneric"));
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {t("successMessage")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("instructions")}
      </p>

      <FormField
        label={t("email")}
        htmlFor="email"
        error={errors.email?.message}
      >
        <input
          id="email"
          type="email"
          className={inputClasses}
          {...register("email")}
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

      <Link
        href="/connexion"
        className="text-sm underline text-slate-600 dark:text-slate-400"
      >
        {t("backToLogin")}
      </Link>
    </form>
  );
}
