import Link from "next/link";
import {acceptCurrentSalesInvite, createAccountFromInvite, acceptSalesInvite, signOut} from "@/app/[locale]/actions";
import {createClient} from "@/lib/supabase/server";

const signupErrorMessages: Record<string, {arabic: string; english: string}> = {
  "weak-password": {
    arabic: "كلمة المرور ضعيفة حسب متطلبات النظام؛ جرّب كلمة أطول وتحتوي على حروف وأرقام.",
    english: "This password is too weak. Try a longer password with a mix of letters and numbers.",
  },
  "password-length": {
    arabic: "كلمة المرور يجب أن تكون ٨ أحرف على الأقل.",
    english: "The password must be at least 8 characters.",
  },
  "invalid-email": {
    arabic: "راجع صيغة البريد الإلكتروني وحاول مرة أخرى.",
    english: "Check the email address format and try again.",
  },
  "email-exists": {
    arabic: "هذا البريد مسجل بالفعل؛ استخدم نموذج تسجيل الدخول بالأسفل.",
    english: "This email already has an account. Use the sign-in form below.",
  },
  "email-rate-limit": {
    arabic: "تم تجاوز حد إرسال رسائل التأكيد. انتظر قليلًا أو اطلب من مسؤول التطبيق ضبط SMTP في Supabase.",
    english: "The email confirmation rate limit was reached. Wait and retry, or ask the app administrator to configure Supabase SMTP.",
  },
  "email-disabled": {
    arabic: "إنشاء الحسابات بالبريد متوقف في Supabase. اطلب من مسؤول التطبيق تفعيل تسجيل البريد.",
    english: "Email signups are disabled in Supabase. Ask the app administrator to enable email signups.",
  },
  provider: {
    arabic: "تعذر إنشاء الحساب أو إرسال رسالة التأكيد. اطلب من مسؤول التطبيق مراجعة سجلات Auth وإعداد SMTP في Supabase.",
    english: "The account could not be created or its confirmation email sent. Ask the app administrator to check Supabase Auth logs and SMTP settings.",
  },
};

export default async function SalesInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string; token: string}>;
  searchParams: Promise<{error?: string; notice?: string; reason?: string}>;
}) {
  const [{locale, token}, query, supabase] = await Promise.all([params, searchParams, createClient()]);
  const language = locale === "ar" ? "ar" : "en";
  const {data: {user}} = await supabase.auth.getUser();

  const text = (arabic: string, english: string) => language === "ar" ? arabic : english;
  const inviteError = query.error === "invite";
  const authError = query.error === "auth";
  const signupError = query.error === "signup";
  const signupMessage = signupErrorMessages[query.reason ?? ""] ?? signupErrorMessages.provider;

  return (
    <main className="setup-screen">
      <header className="setup-header">
        <Link className="brand-lockup" href={`/${language}`}><span className="brand-mark">م</span><span>مسار</span></Link>
        <Link className="locale-switch" href={`/${language === "ar" ? "en" : "ar"}/invite/${token}`}>{text("English", "العربية")}</Link>
        {user && <form action={signOut.bind(null, language)}><button className="text-button" type="submit">{text("تسجيل الخروج", "Sign out")}</button></form>}
      </header>
      <section className="setup-content invite-content">
        <p className="eyebrow">{text("دعوة لفريق المبيعات", "SALES TEAM INVITATION")}</p>
        <h1>{text("انضم إلى فريق مسار", "Join the Masar team")}</h1>
        <p className="form-intro">{text("أنشئ حسابك أو سجّل الدخول لقبول الدعوة وفتح قائمة متابعات اليوم.", "Create an account or sign in to accept the invitation and open your Today follow-ups.")}</p>
        {inviteError && <p className="form-alert" role="alert">{text("رابط الدعوة غير صالح أو منتهي الصلاحية أو مستخدم من قبل.", "This invitation is invalid, expired, or already used.")}</p>}
        {authError && <p className="form-alert" role="alert">{text("تعذر تسجيل الدخول. لو دي أول مرة للشخص، استخدم نموذج حساب جديد بالأعلى. لو لديه حساب، تأكد من البريد الذي وصلته عليه الدعوة وكلمة المرور.", "Sign-in failed. If this is their first time, use the Create an account form above. Otherwise, check the invitation email address and password.")}</p>}
        {signupError && <p className="form-alert" role="alert">{text(signupMessage.arabic, signupMessage.english)}</p>}
        {query.notice === "check-email" && <p className="form-success" role="status">{text("تحقق من بريدك لتأكيد الحساب وقبول الدعوة.", "Check your email to confirm your account and accept the invite.")}</p>}

        {user && <div className="invite-current-account">
          <p>{text("مسجل الدخول حاليا باسم", "Currently signed in as")} <strong dir="ltr">{user.email}</strong></p>
          <form action={acceptCurrentSalesInvite}><input name="locale" type="hidden" value={language} /><input name="inviteToken" type="hidden" value={token} /><button className="primary-button" type="submit">{text("قبول الدعوة بهذا الحساب", "Accept with this account")}</button></form>
          <p>{text("لو الرابط موجه لزميل آخر، سجّل الخروج أولا.", "If this invite is for a teammate, sign out first.")}</p>
        </div>}

        {!user && <form action={createAccountFromInvite} className="settings-form invite-form">
          <input name="locale" type="hidden" value={language} />
          <input name="inviteToken" type="hidden" value={token} />
          <h2>{text("حساب جديد", "Create an account")}</h2>
          <label htmlFor="invite-signup-email">{text("البريد الإلكتروني", "Email")}</label>
          <input autoComplete="email" id="invite-signup-email" name="email" required type="email" />
          <label htmlFor="invite-signup-password">{text("كلمة المرور", "Password")}</label>
          <input autoComplete="new-password" id="invite-signup-password" minLength={8} name="password" required type="password" />
          <button className="primary-button" type="submit">{text("إنشاء حساب والانضمام", "Create account and join")}</button>
        </form>}

        {!user && <><div className="auth-divider"><span>{text("لديك حساب بالفعل", "ALREADY HAVE AN ACCOUNT")}</span></div>
        <form action={acceptSalesInvite} className="settings-form invite-form">
          <input name="locale" type="hidden" value={language} />
          <input name="inviteToken" type="hidden" value={token} />
          <label htmlFor="invite-signin-email">{text("البريد الإلكتروني", "Email")}</label>
          <input autoComplete="email" id="invite-signin-email" name="email" required type="email" />
          <label htmlFor="invite-signin-password">{text("كلمة المرور", "Password")}</label>
          <input autoComplete="current-password" id="invite-signin-password" minLength={8} name="password" required type="password" />
          <button className="secondary-button" type="submit">{text("تسجيل الدخول والانضمام", "Sign in and join")}</button>
        </form></>}
      </section>
    </main>
  );
}