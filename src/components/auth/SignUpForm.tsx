"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { signUpSchema, type SignUpInput } from "@/validations/auth";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

export function SignUpForm() {
  const t = useTranslations("Auth.SignUp");
  const tCommon = useTranslations("Common");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  async function onSubmit(values: SignUpInput) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name: values.fullName },
      },
    });

    if (error) {
      if (error.code === "user_already_exists") {
        setFormError(t("errorEmailInUse"));
      } else {
        setFormError(tCommon("errorGeneric"));
      }
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t("successTitle")}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t("successMessage")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField
        label={t("fullName")}
        htmlFor="fullName"
        error={errors.fullName?.message}
      >
        <input
          id="fullName"
          type="text"
          className={inputClasses}
          {...register("fullName")}
        />
      </FormField>

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

      <p className="text-sm text-slate-600 dark:text-slate-400">
        {t("alreadyHaveAccount")}{" "}
        <Link href="/connexion" className="underline">
          {t("loginLink")}
        </Link>
      </p>
    </form>
  );
}
