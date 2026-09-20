import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { locale } from "next/root-params";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Header } from "@/components/layout/Header";
import { getSiteUrl } from "@/lib/env";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((activeLocale) => ({ locale: activeLocale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    // Permet aux `alternates.canonical`/`openGraph` relatifs des pages
    // (ex. "/opportunites") de se résoudre en URL absolue — voir
    // PROJECT_SPEC.md Phase 7 §24/§26 et docs/DIRECTORY.md.
    metadataBase: new URL(getSiteUrl()),
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const activeLocale = await locale();

  if (!hasLocale(routing.locales, activeLocale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html
      lang={activeLocale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={activeLocale} messages={messages}>
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
