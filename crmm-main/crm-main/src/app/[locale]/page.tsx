import Link from "next/link";
import Image from "next/image";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {createClient} from "@/lib/supabase/server";
import {isSupabaseConfigured} from "@/lib/supabase/config";
import {Icon} from "@/components/ui/icon";
import {signIn, signUp} from "./actions";

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{error?: string; notice?: string}>;
}) {
  const [{locale}, query, t, app, messages] = await Promise.all([
    params,
    searchParams,
    getTranslations("auth"),
    getTranslations("app"),
    getTranslations("messages"),
  ]);
  const hasSupabase = isSupabaseConfigured();
  if (hasSupabase) {
    const supabase = await createClient();
    const {data: {user}} = await supabase.auth.getUser();
    if (user) {
      const {data: memberships} = await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1);
      redirect(memberships?.length ? `/${locale}/dashboard` : `/${locale}/onboarding`);
    }
  }

  const copy = locale === "ar"
    ? ["تعيين تلقائي للعميل", "موعد متابعة إلزامي", "تنبيه وتصعيد للمدير"]
    : ["Automatic lead assignment", "A required follow-up task", "A reminder and manager escalation"];

  return (
    <main className="auth-screen">
      <section className="auth-story" aria-labelledby="auth-title">
        <div className="story-topline">
          <Link className="brand-lockup" href={`/${locale}`} aria-label={app("name")}>
            <Image alt={app("name")} height={48} priority src="/brand/masar-logo.svg" width={128} />
          </Link>
          <Link className="locale-switch" href={`/${locale === "ar" ? "en" : "ar"}`}>
            <Icon name="language" size={18} />
            {locale === "ar" ? "English" : "العربية"}
          </Link>
        </div>

        <div className="story-content">
          <p className="eyebrow">{locale === "ar" ? "نظام متابعة المبيعات العقارية" : "REAL ESTATE SALES FOLLOW-UP"}</p>
          <h1 id="auth-title">{t("welcome")}</h1>
          <p className="story-description">{t("description")}</p>
          <div className="workflow-list" aria-label={locale === "ar" ? "مسار المتابعة" : "Follow-up workflow"}>
            {copy.map((item, index) => (
              <div className="workflow-step" key={item}>
                <span className="workflow-icon">
                  <Icon name={index === 0 ? "assign" : index === 1 ? "clock" : "escalate"} size={20} />
                </span>
                <span>{item}</span>
                <Icon className="workflow-check" name="check" size={18} />
              </div>
            ))}
          </div>
        </div>

        <p className="story-footer">{app("tagline")}</p>
      </section>

      <section className="auth-panel" aria-labelledby="sign-in-title">
        <div className="auth-panel-inner">
          <div className="mobile-brand brand-lockup">
            <Image alt={app("name")} height={48} priority src="/brand/masar-logo.svg" width={128} />
          </div>
          <p className="eyebrow">{locale === "ar" ? "مساحة عمل فريقك" : "YOUR TEAM WORKSPACE"}</p>
          <h2 id="sign-in-title">{t("signIn")}</h2>
          <p className="form-intro">{t("sendLink")}</p>

          {query.error === "auth" && <p className="form-alert" role="alert">{messages("authError")}</p>}
          {query.notice === "account-created" && <p className="form-success" role="status">{messages("accountCreated")}</p>}
          {!hasSupabase && <p className="form-alert" role="status">{t("supabaseMissing")}</p>}

          <form action={signIn} className="auth-form">
            <input type="hidden" name="locale" value={locale} />
            <label htmlFor="email">{t("email")}</label>
            <input id="email" name="email" type="email" autoComplete="email" required disabled={!hasSupabase} />
            <label htmlFor="password">{t("password")}</label>
            <input id="password" name="password" type="password" autoComplete="current-password" minLength={8} required disabled={!hasSupabase} />
            <button className="primary-button" type="submit" disabled={!hasSupabase}>{t("signIn")}</button>
          </form>

          <div className="auth-divider"><span>{locale === "ar" ? "أو" : "OR"}</span></div>
          <form action={signUp} className="signup-form">
            <input type="hidden" name="locale" value={locale} />
            <p>{t("createAccount")}</p>
            <label className="visually-hidden" htmlFor="signup-email">{t("email")}</label>
            <input id="signup-email" name="email" type="email" autoComplete="email" placeholder={t("email")} required disabled={!hasSupabase} />
            <label className="visually-hidden" htmlFor="signup-password">{t("password")}</label>
            <input id="signup-password" name="password" type="password" autoComplete="new-password" placeholder={t("password")} minLength={8} required disabled={!hasSupabase} />
            <button className="secondary-button" type="submit" disabled={!hasSupabase}>{t("signUp")}</button>
          </form>
          {process.env.NODE_ENV === "development" && <Link className="secondary-button demo-entry" href={`/${locale}/demo`}>
            <Icon name="dashboard" size={18} />
            {locale === "ar" ? "معاينة النظام دون تسجيل" : "Open read-only demo"}
          </Link>}
        </div>
      </section>
    </main>
  );
}