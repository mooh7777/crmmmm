import {redirect} from "next/navigation";
import Link from "next/link";
import {getTranslations} from "next-intl/server";
import {createClient} from "@/lib/supabase/server";
import {Input, Select} from "@/components/ui/primitives";
import {createOrganization, signOut} from "../actions";

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{error?: string}>;
}) {
  const [{locale}, query, t, messages] = await Promise.all([
    params,
    searchParams,
    getTranslations("organization"),
    getTranslations("messages"),
  ]);
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}`);

  const {data: memberships} = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1);
  if (memberships?.length) redirect(`/${locale}/dashboard`);

  return (
    <main className="setup-screen">
      <header className="setup-header">
        <a className="brand-lockup" href={`/${locale}`}>
          <span className="brand-mark">م</span>
          <span>{locale === "ar" ? "مسار" : "Masar"}</span>
        </a>
        <Link className="locale-switch" href={`/${locale === "ar" ? "en" : "ar"}/onboarding`} hrefLang={locale === "ar" ? "en" : "ar"}>
          {locale === "ar" ? "English" : "العربية"}
        </Link>
        <form action={signOut.bind(null, locale as "ar" | "en")}>
          <button className="text-button" type="submit">{locale === "ar" ? "تسجيل الخروج" : "Sign out"}</button>
        </form>
      </header>

      <section className="setup-content">
        <p className="eyebrow">{locale === "ar" ? "الخطوة الأولى" : "FIRST THINGS FIRST"}</p>
        <h1>{t("setupTitle")}</h1>
        <p className="form-intro">{t("setupDescription")}</p>
        {query.error === "organization" && <p className="form-alert" role="alert">{messages("genericError")}</p>}

        <form action={createOrganization} className="settings-form">
          <input type="hidden" name="locale" value={locale} />
          <label htmlFor="org-name">{t("name")}</label>
          <Input id="org-name" name="name" minLength={2} maxLength={120} required />

          <div className="field-grid">
            <div className="field-stack">
              <label htmlFor="timezone">{t("timezone")}</label>
              <Select id="timezone" name="timezone" defaultValue="Africa/Cairo">
                <option value="Africa/Cairo">{t("egypt")} · Africa/Cairo</option>
                <option value="Asia/Riyadh">{t("saudi")} · Asia/Riyadh</option>
              </Select>
            </div>
            <div className="field-stack">
              <label htmlFor="currency">{t("currency")}</label>
              <Select id="currency" name="currency" defaultValue="EGP">
                <option value="EGP">EGP · {t("egypt")}</option>
                <option value="SAR">SAR · {t("saudi")}</option>
              </Select>
            </div>
          </div>

          <label htmlFor="language">{t("language")}</label>
          <Select id="language" name="language" defaultValue={locale}>
            <option value="ar">{t("arabic")}</option>
            <option value="en">{t("english")}</option>
          </Select>
          <button className="primary-button" type="submit">{t("create")}</button>
        </form>
      </section>
    </main>
  );
}