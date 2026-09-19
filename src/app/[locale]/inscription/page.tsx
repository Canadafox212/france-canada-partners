import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignUpForm } from "@/components/auth/SignUpForm";

export default async function SignUpPage() {
  const t = await getTranslations("Auth.SignUp");
  return (
    <AuthCard title={t("title")}>
      <SignUpForm />
    </AuthCard>
  );
}
