"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter as usePlainRouter } from "next/navigation";
import { useRouter, Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginInput } from "@/validations/auth";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

// Retour vers la page d'origine après connexion (ex. une fiche entreprise
// avec "Demander une mise en relation", Phase 9), quand un paramètre
// "next" sûr est présent — jamais un chemin absolu externe (protection
// open-redirect minimale : doit commencer par "/" sans être "//...").
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function LoginForm() {
  const t = useTranslations("Auth.Login");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const searchParams = useSearchParams();
  // Router "brut" (pas celui de next-intl) : le chemin "next" est déjà
  // complet, préfixe de langue inclus — le repréfixer via le routeur
  // conscient de la langue le préfixerait une seconde fois.
  const plainRouter = usePlainRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);

    if (error) {
      if (error.code === "email_not_confirmed") {
        setFormError(t("errorEmailNotConfirmed"));
      } else if (error.code === "invalid_credentials") {
        setFormError(t("errorInvalidCredentials"));
      } else {
        setFormError(tCommon("errorGeneric"));
      }
      return;
    }

    const next = safeNextPath(searchParams.get("next"));
    if (next) {
      plainRouter.push(next);
    } else {
      router.push("/compte");
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting}>
        {isSubmitting ? tCommon("loading") : t("submit")}
      </SubmitButton>

      <div className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-400">
        <Link href="/mot-de-passe-oublie" className="underline">
          {t("forgotPassword")}
        </Link>
        <p>
          {t("noAccount")}{" "}
          <Link href="/inscription" className="underline">
            {t("signUpLink")}
          </Link>
        </p>
      </div>
    </form>
  );
}
