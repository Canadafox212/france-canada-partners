import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const t = await getTranslations("Auth.Login");
  return (
    <AuthCard title={t("title")}>
      <LoginForm />
    </AuthCard>
  );
}
