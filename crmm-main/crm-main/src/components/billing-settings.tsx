"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import type {BillingPlanRow, SubscriptionRow} from "@/lib/supabase/database";
import type {BillingInterval} from "@/lib/billing/pricing";
import type {BillingCurrency} from "@/lib/billing/providers/payment-provider";

type Props = {
  locale: "ar" | "en";
  organizationId: string;
  currency: BillingCurrency;
  plans: BillingPlanRow[];
  subscription: SubscriptionRow;
};

export function BillingSettings({locale, organizationId, currency, plans, subscription}: Props) {
  const arabic = locale === "ar";
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [extraSeats, setExtraSeats] = useState(0);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [error, setError] = useState("");
  const annualFactor = interval === "annual" ? 10 : 1;
  const numberFormat = new Intl.NumberFormat(arabic ? "ar-EG" : "en-US", {maximumFractionDigits: 2});
  const money = (amount: number) => `${numberFormat.format(amount)} ${currency}`;
  const router = useRouter();
  const [cancelPending, setCancelPending] = useState(false);
  const status = {
    trialing: arabic ? "فترة تجريبية" : "Trial",
    active: arabic ? "نشط" : "Active",
    past_due: arabic ? "متأخر السداد" : "Past due",
    canceled: arabic ? "ملغي" : "Canceled",
  }[subscription.status];

  async function startCheckout(planCode: string) {
    setPendingPlan(planCode);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({organizationId, planCode, interval, extraSeats, locale}),
      });
      const result = await response.json() as {checkoutUrl?: string; error?: string};
      if (!response.ok || !result.checkoutUrl) {
        const messages: Record<string, [string, string]> = {
          "sar-checkout-unavailable": ["الدفع بالريال غير متاح مع TruePay حاليًا.", "SAR checkout is not available with TruePay yet."],
          "billing-service-key-missing": ["إعداد الفوترة ناقص في Vercel: أضف SUPABASE_SERVICE_ROLE_KEY.", "Billing setup is incomplete in Vercel: add SUPABASE_SERVICE_ROLE_KEY."],
          "billing-plan-unavailable": ["تعذر قراءة الخطة من قاعدة البيانات. تأكد أن migration الفوترة مطبقة.", "Could not load billing plans. Confirm the billing migration was applied."],
          "payment-record-failed": ["تعذر حفظ عملية الدفع. راجع صلاحيات قاعدة البيانات وإعداداتها.", "Could not save the payment record. Check database configuration and permissions."],
          "truepay-api-key-missing": ["مفتاح TRUEPAY_API_KEY غير موجود في Vercel Production.", "TRUEPAY_API_KEY is missing from Vercel Production."],
          "truepay-credentials-rejected": ["TruePay رفض المفتاح. راجع أن TRUEPAY_API_KEY الجديد صحيح ومفعّل.", "TruePay rejected the key. Check that the new TRUEPAY_API_KEY is valid and active."],
          "truepay-response-unexpected": ["TruePay استقبل الطلب لكن ردّه لا يحتوي رابط دفع معروفًا. نحتاج شكل رد initiate من سجلات TruePay.", "TruePay responded without a recognized checkout URL. We need the initiate response shape from TruePay logs."],
          "truepay-checkout-failed": ["فشل TruePay في إنشاء الرابط. راجع سجل Function في Vercel لمعرفة السبب.", "TruePay could not create the link. Check the Vercel Function log for the cause."],
        };
        const message = messages[result.error ?? ""] ?? ["تعذر إنشاء رابط الدفع. راجع سجلات Function في Vercel.", "Could not create the checkout link. Check the Vercel Function logs."];
        setError(arabic ? message[0] : message[1]);
        return;
      }
      window.location.assign(result.checkoutUrl);
    } catch {
      setError(arabic ? "تعذر الاتصال بمزود الدفع. حاول مرة أخرى." : "Could not reach the payment provider. Please retry.");
    } finally {
      setPendingPlan(null);
    }
  }

  async function cancelSubscription() {
    if (!window.confirm(arabic ? "هل تريد إلغاء الاشتراك؟ سيظل الوصول متاحًا حتى نهاية الفترة أو مهلة السداد." : "Cancel this subscription? Access remains until the current period or grace period ends.")) return;
    setCancelPending(true);
    setError("");
    try {
      const response = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({organizationId}),
      });
      if (!response.ok) throw new Error("cancel-failed");
      router.refresh();
    } catch {
      setError(arabic ? "تعذر إلغاء الاشتراك. حاول مرة أخرى." : "Could not cancel the subscription. Please retry.");
    } finally {
      setCancelPending(false);
    }
  }
  return <div className="billing-settings">
    <section className="settings-section billing-current">
      <div className="section-heading"><div><h2>{arabic ? "اشتراك المؤسسة" : "Organization subscription"}</h2><p>{arabic ? "التجربة المجانية 14 يومًا دون بطاقة." : "14-day free trial. No card required."}</p></div><span className={`billing-status billing-status-${subscription.status}`}>{status}</span></div>
      <p>{arabic ? "الباقة الحالية" : "Current plan"}: <strong>{subscription.plan}</strong></p>
      {subscription.status === "trialing" && <p>{arabic ? "تنتهي التجربة" : "Trial ends"}: <time dateTime={subscription.trial_ends_at}>{new Intl.DateTimeFormat(arabic ? "ar-EG" : "en-US", {dateStyle: "medium"}).format(new Date(subscription.trial_ends_at))}</time></p>}
      {subscription.current_period_end && <p>{arabic ? "نهاية الفترة الحالية" : "Current period ends"}: <time dateTime={subscription.current_period_end}>{new Intl.DateTimeFormat(arabic ? "ar-EG" : "en-US", {dateStyle: "medium"}).format(new Date(subscription.current_period_end))}</time></p>}
      <p className="form-intro">{arabic ? "الدفع يدوي عبر رابط آمن. لا يتم خصم تلقائي من البطاقة." : "Payments are manual through a secure link. No automatic card charges."}</p>
      {subscription.status !== "canceled" && <button className="secondary-button billing-cancel-button" disabled={cancelPending} onClick={() => void cancelSubscription()} type="button">{cancelPending ? (arabic ? "جارٍ الإلغاء..." : "Canceling...") : (arabic ? "إلغاء الاشتراك" : "Cancel subscription")}</button>}
    </section>

    <section className="settings-section">
      <div className="section-heading"><div><h2>{arabic ? "الباقات" : "Plans"}</h2><p>{arabic ? "الأسعار لا تشمل ضريبة القيمة المضافة. واتساب API يُحاسب منفصلًا." : "Prices exclude VAT. WhatsApp API usage is billed separately."}</p></div></div>
      <div aria-label={arabic ? "دورة الفوترة" : "Billing interval"} className="billing-interval" role="group">
        <button aria-pressed={interval === "monthly"} className={interval === "monthly" ? "billing-interval-active" : ""} onClick={() => setInterval("monthly")} type="button">{arabic ? "شهري" : "Monthly"}</button>
        <button aria-pressed={interval === "annual"} className={interval === "annual" ? "billing-interval-active" : ""} onClick={() => setInterval("annual")} type="button">{arabic ? "سنوي · شهران مجانًا" : "Annual · 2 months free"}</button>
      </div>
      <div className="field-stack billing-extra-seats">
        <label htmlFor="billing-extra-seats">{arabic ? "مقاعد إضافية" : "Extra seats"}</label>
        <input id="billing-extra-seats" max="1000" min="0" onChange={(event) => setExtraSeats(Number(event.target.value))} type="number" value={extraSeats} />
        <small>{arabic ? `سعر المقعد الإضافي: ${money(currency === "EGP" ? plans[0]?.extra_seat_price_egp ?? 120 : plans[0]?.extra_seat_price_sar ?? 25)} شهريًا، ويُحسب سنويًا × 10.` : `Extra seat: ${money(currency === "EGP" ? plans[0]?.extra_seat_price_egp ?? 120 : plans[0]?.extra_seat_price_sar ?? 25)} per month; annual billing is × 10.`}</small>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="billing-plan-grid">
        {plans.map((plan) => {
          const monthlyPrice = currency === "EGP" ? plan.monthly_price_egp : plan.monthly_price_sar;
          const extraSeatPrice = currency === "EGP" ? plan.extra_seat_price_egp : plan.extra_seat_price_sar;
          const total = (monthlyPrice + extraSeats * extraSeatPrice) * annualFactor * (1 - subscription.founder_discount_percent / 100);
          const isCurrent = subscription.plan === plan.code;
          return <article className="billing-plan" key={plan.code}>
            <p className="eyebrow">{plan.name}</p>
            <h3>{money(total)} <small>/{interval === "annual" ? (arabic ? "سنة" : "year") : (arabic ? "شهر" : "month")}</small></h3>
            {subscription.founder_discount_percent > 0 && <p className="billing-discount">{arabic ? `يشمل خصم ${subscription.founder_discount_percent}%` : `${subscription.founder_discount_percent}% discount included`}</p>}
            <ul>
              <li>{numberFormat.format(plan.included_seats + extraSeats)} {arabic ? "مقعد" : "seats"}</li>
              <li>{numberFormat.format(plan.leads_per_month)} {arabic ? "عميل جديد شهريًا" : "new leads per month"}</li>
            </ul>
            <button className={isCurrent ? "secondary-button" : "primary-button"} disabled={Boolean(pendingPlan) || currency === "SAR"} onClick={() => void startCheckout(plan.code)} type="button">
              {pendingPlan === plan.code ? (arabic ? "جارٍ إنشاء رابط الدفع..." : "Creating checkout...") : currency === "SAR" ? (arabic ? "قريبًا" : "Coming soon") : isCurrent ? (arabic ? "ادفع أو جدد" : "Pay or renew") : (arabic ? "اختيار الباقة" : "Choose plan")}
            </button>
          </article>;
        })}
      </div>
      {currency === "SAR" && <p className="form-intro">{arabic ? "الأسعار بالريال جاهزة، لكن الدفع مع TruePay غير متاح حتى تأكيد دعم SAR أو إضافة مزود سعودي." : "SAR pricing is ready, but checkout is unavailable until TruePay confirms SAR support or a Saudi provider is added."}</p>}
    </section>
  </div>;
}
