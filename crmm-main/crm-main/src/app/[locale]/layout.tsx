import type {ReactNode} from "react";
import {hasLocale, NextIntlClientProvider} from "next-intl";
import {notFound} from "next/navigation";
import {setRequestLocale} from "next-intl/server";
import {routing} from "@/i18n/routing";
import {PwaRegistration} from "@/components/pwa-registration";
import "../globals.css";

const metadataBaseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://example.com");

export const metadata = {
  metadataBase: new URL(metadataBaseUrl),
  title: "Masar | Real estate lead follow-up",
  description: "Keep every real estate lead assigned, followed up, and visible to your team.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {capable: true, statusBarStyle: "default", title: "Masar"},
  icons: {apple: "/brand/apple-touch-icon.png"},
};

export const viewport = {themeColor: "#0b3b3c"};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({locale}));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body>
        <PwaRegistration />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}