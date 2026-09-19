"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { profileSchema, type ProfileInput } from "@/validations/company";
import { FormField, inputClasses } from "@/components/ui/FormField";
import { SubmitButton } from "@/components/ui/Button";

export function ProfileForm({
  userId,
  defaultValues,
}: {
  userId: string;
  defaultValues: ProfileInput;
}) {
  const t = useTranslations("Account");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues,
  });

  async function onSubmit(values: ProfileInput) {
    setFormError(null);
    setSaved(false);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: values.fullName,
        preferred_language: values.preferredLanguage,
      })
      .eq("id", userId);

    if (error) {
      setFormError(tCommon("errorGeneric"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField
        label={t("fullNameLabel")}
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
        label={t("preferredLanguageLabel")}
        htmlFor="preferredLanguage"
      >
        <select
          id="preferredLanguage"
          className={inputClasses}
          {...register("preferredLanguage")}
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </FormField>

      {formError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          {tCommon("saved")}
        </p>
      ) : null}

      <SubmitButton isLoading={isSubmitting} className="self-start">
        {isSubmitting ? tCommon("loading") : tCommon("save")}
      </SubmitButton>
    </form>
  );
}
