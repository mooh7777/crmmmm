import {randomUUID} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {getBillingPeriod, calculateSubscriptionAmount, type BillingInterval} from "@/lib/billing/pricing";
import {getPaymentProvider} from "@/lib/billing/providers";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {status, headers: {"Cache-Control": "no-store"}});
}

function failure(code: string, status: number) {
  return json({error: code}, status);
}

function siteOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_URL?.trim();
  return vercelUrl ? `https://${vercelUrl}` : request.nextUrl.origin;
}

function secretMatches(expected: string, provided: string) {
  if (expected.length < 32 || expected.length !== provided.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return difference === 0;
}

export async function POST(request: NextRequest) {
  const internal = secretMatches(process.env.BILLING_CRON_SECRET?.trim() ?? "", request.headers.get("x-billing-cron-secret") ?? "");
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && new URL(requestOrigin).host !== request.nextUrl.host) return json({error: "Forbidden"}, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({error: "Invalid request"}, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({error: "Invalid request"}, 400);

  const input = body as Record<string, unknown>;
  const organizationId = typeof input.organizationId === "string" ? input.organizationId : "";
  const planCode = input.planCode;
  const interval = input.interval;
  const extraSeats = input.extraSeats ?? 0;
  const locale = input.locale === "en" ? "en" : "ar";
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json({error: "Invalid organization"}, 400);
  if (planCode !== "starter" && planCode !== "growth" && planCode !== "pro") return json({error: "Invalid plan"}, 400);
  if (interval !== "monthly" && interval !== "annual") return json({error: "Invalid billing interval"}, 400);
  if (!Number.isSafeInteger(extraSeats) || Number(extraSeats) < 0 || Number(extraSeats) > 1000) return json({error: "Invalid extra seat count"}, 400);

  let customerEmail: string | undefined;
  if (!internal) {
    const supabase = await createClient();
    const {data: {user}} = await supabase.auth.getUser();
    if (!user) return json({error: "Unauthorized"}, 401);
    const {data: membership} = await supabase.from("memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership || (membership.role !== "owner" && membership.role !== "manager")) return json({error: "Forbidden"}, 403);
    customerEmail = user.email;
  } else if (!process.env.BILLING_CRON_SECRET?.trim()) {
    return json({error: "Internal billing is not configured"}, 503);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return failure("billing-service-key-missing", 503);
  }

  const [{data: organization}, {data: subscription}, {data: plan}] = await Promise.all([
    admin.from("organizations").select("id, name").eq("id", organizationId).maybeSingle(),
    admin.from("subscriptions").select("*").eq("organization_id", organizationId).maybeSingle(),
    admin.from("billing_plans").select("*").eq("code", planCode).eq("active", true).maybeSingle(),
  ]);
  if (!organization || !subscription || !plan) return failure("billing-plan-unavailable", 404);
  if (subscription.currency === "SAR") return failure("sar-checkout-unavailable", 409);

  const billingInterval = interval as BillingInterval;
  const currency = subscription.currency;
  const amount = calculateSubscriptionAmount(
    plan,
    billingInterval,
    Number(extraSeats),
    currency,
    subscription.founder_discount_percent,
  );
  const now = new Date();
  const renewalAnchor = subscription.status === "trialing" ? subscription.trial_ends_at : subscription.current_period_end;
  const periodStart = renewalAnchor && new Date(renewalAnchor) > now ? new Date(renewalAnchor) : now;
  const periodEnd = getBillingPeriod(periodStart, billingInterval);

  const {data: pendingPayment} = await admin.from("billing_payments").select("order_id, payment_url, amount, currency")
    .eq("subscription_id", subscription.id)
    .eq("plan_code", planCode)
    .eq("billing_interval", billingInterval)
    .eq("extra_seats", Number(extraSeats))
    .eq("status", "pending")
    .gt("period_end", now.toISOString())
    .order("created_at", {ascending: false})
    .limit(1)
    .maybeSingle();
  if (pendingPayment?.payment_url) {
    return json({checkoutUrl: pendingPayment.payment_url, orderId: pendingPayment.order_id, amount: pendingPayment.amount, currency: pendingPayment.currency});
  }

  const orderId = `MASAR-${randomUUID()}`;
  const {data: payment, error: insertError} = await admin.from("billing_payments").insert({
    organization_id: organization.id,
    subscription_id: subscription.id,
    provider: "truepay",
    order_id: orderId,
    plan_code: planCode,
    billing_interval: billingInterval,
    extra_seats: Number(extraSeats),
    amount,
    currency,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    status: "creating",
  }).select("id").single();
  if (insertError || !payment) {
    console.error("Billing payment record could not be created", insertError?.code ?? "unknown");
    return failure("payment-record-failed", 500);
  }

  try {
    const provider = getPaymentProvider();
    const checkout = await provider.createCheckout({
      orderId,
      amount,
      currency,
      redirectUrl: `${siteOrigin(request)}/${locale}/settings/billing?payment=complete`,
      customerName: organization.name,
      customerEmail,
    });
    const {error: updateError} = await admin.from("billing_payments").update({
      status: "pending",
      payment_url: checkout.checkoutUrl,
      provider_transaction_id: checkout.providerTransactionId,
    }).eq("id", payment.id);
    if (updateError) throw new Error("Could not persist the provider payment session");
    return json({checkoutUrl: checkout.checkoutUrl, orderId, amount, currency});
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown TruePay checkout failure";
    console.error("TruePay checkout failed", message);
    await admin.from("billing_payments").update({status: "failed"}).eq("id", payment.id);
    if (message === "TRUEPAY_API_KEY is not configured") return failure("truepay-api-key-missing", 503);
    if (message.includes("TruePay checkout request failed (401)") || message.includes("TruePay checkout request failed (403)")) return failure("truepay-credentials-rejected", 502);
    if (message.includes("missing a payment URL or transaction id")) return failure("truepay-response-unexpected", 502);
    return failure("truepay-checkout-failed", 502);
  }
}
