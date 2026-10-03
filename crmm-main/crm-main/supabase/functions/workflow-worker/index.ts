import {createClient} from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {deliverImpactReport, type ClaimedReport} from "./impact-report.ts";

type PushSubscriptionRecord = {endpoint: string; p256dh: string; auth: string};
type ClaimedDelivery = {
  delivery_id: string;
  delivery_channel: "email" | "push";
  recipient_email: string | null;
  locale: "ar" | "en";
  notification_kind: "task_due" | "task_escalated";
  notification_title: string;
  notification_title_ar: string;
  lead_name: string | null;
  task_id: string;
  subscriptions: PushSubscriptionRecord[];
};
type ClaimedBillingReminder = {
  reminder_id: string;
  organization_id: string;
  organization_name: string;
  organization_language: "ar" | "en";
  recipient_email: string;
  payment_url: string;
  renewal_at: string;
  days_before: 5 | 2 | 0;
};
type PendingBillingReminder = {
  id: string;
  subscription_id: string;
  renewal_at: string;
  days_before: 5 | 2 | 0;
  attempt_count: number;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json", "Cache-Control": "no-store"},
  });
}

function secretsMatch(expected: string, provided: string) {
  if (expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function sendReminderEmail(delivery: ClaimedDelivery, apiKey: string, fromEmail: string) {
  if (!delivery.recipient_email) return;
  if (!apiKey || !fromEmail) throw new Error("Reminder email delivery is not configured");
  const arabic = delivery.locale === "ar";
  const leadName = delivery.lead_name ?? (arabic ? "العميل" : "the lead");
  const subject = arabic ? delivery.notification_title_ar : delivery.notification_title;
  const body = arabic ? `حان موعد متابعة ${leadName}. افتح مسار لمراجعة المهمة وتسجيل نتيجتها.` : `A follow-up with ${leadName} is due. Open Masar to review the task and log its outcome.`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": delivery.delivery_id},
    body: JSON.stringify({
      from: fromEmail,
      to: [delivery.recipient_email],
      subject,
      text: body,
      html: `<p>${escapeHtml(body)}</p>`,
    }),
  });
  if (!response.ok) throw new Error(`Reminder email provider returned ${response.status}`);
}

async function sendBillingReminder(reminder: ClaimedBillingReminder, apiKey: string, fromEmail: string, siteUrl: string) {
  if (!apiKey || !fromEmail || !siteUrl || !reminder.payment_url) throw new Error("Billing reminder email is not configured");
  const locale = reminder.organization_language === "en" ? "en" : "ar";
  const billingUrl = reminder.payment_url;
  const subject = locale === "ar"
    ? reminder.days_before === 0 ? "موعد تجديد اشتراك مسار اليوم" : `تجديد اشتراك مسار خلال ${reminder.days_before} أيام`
    : reminder.days_before === 0 ? "Your Masar subscription renews today" : `Your Masar subscription renews in ${reminder.days_before} days`;
  const text = locale === "ar"
    ? `اشتراك ${reminder.organization_name} يحتاج إلى تجديد. لا يتم الخصم تلقائيًا. افتح صفحة الاشتراك لإتمام الدفع: ${billingUrl}`
    : `The subscription for ${reminder.organization_name} is due for renewal. No automatic charge will be made. Open billing to complete payment: ${billingUrl}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `billing-reminder-${reminder.reminder_id}`},
    body: JSON.stringify({from: fromEmail, to: [reminder.recipient_email], subject, text, html: `<p>${escapeHtml(text)}</p>`}),
  });
  if (!response.ok) throw new Error(`Billing email provider returned ${response.status}`);
}

async function prepareBillingPaymentLinks(supabase: ReturnType<typeof createClient>, siteUrl: string, cronSecret: string) {
  if (!siteUrl || cronSecret.length < 32) return {created: 0, failed: 0, error: "Billing checkout preparation is not configured"};
  const now = new Date();
  const {data: reminders, error} = await supabase.from("billing_reminders")
    .select("id, subscription_id, renewal_at, days_before, attempt_count")
    .eq("state", "pending")
    .is("payment_url", null)
    .lte("next_attempt_at", now.toISOString())
    .gte("renewal_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .lte("renewal_at", new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("renewal_at", {ascending: true})
    .limit(25);
  if (error) return {created: 0, failed: 0, error: error.message};

  let created = 0;
  let failed = 0;
  for (const reminder of (reminders ?? []) as PendingBillingReminder[]) {
    const leaseExpiry = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const {data: claimed, error: claimError} = await supabase.from("billing_reminders")
      .update({claimed_at: new Date().toISOString(), attempt_count: reminder.attempt_count + 1})
      .eq("id", reminder.id)
      .eq("state", "pending")
      .is("payment_url", null)
      .or(`claimed_at.is.null,claimed_at.lt.${leaseExpiry}`)
      .select("id")
      .maybeSingle();
    if (claimError) {
      failed += 1;
      continue;
    }
    if (!claimed) continue;

    const {data: subscription} = await supabase.from("subscriptions")
      .select("organization_id, plan, status, currency, billing_interval, extra_seats")
      .eq("id", reminder.subscription_id).maybeSingle();
    if (!subscription || !["trialing", "active", "past_due"].includes(subscription.status)) {
      await supabase.from("billing_reminders").update({state: "failed", last_error: "Subscription is no longer renewable", claimed_at: null}).eq("id", reminder.id);
      continue;
    }
    if (subscription.currency !== "EGP") {
      await supabase.from("billing_reminders").update({last_error: "A Saudi payment provider is not configured", next_attempt_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), claimed_at: null}).eq("id", reminder.id);
      continue;
    }
    if (subscription.plan !== "starter" && subscription.plan !== "growth" && subscription.plan !== "pro") {
      await supabase.from("billing_reminders").update({state: "failed", last_error: "This plan requires manual renewal", claimed_at: null}).eq("id", reminder.id);
      continue;
    }
    const {data: organization} = await supabase.from("organizations").select("language")
      .eq("id", subscription.organization_id).maybeSingle();

    let failureReason: string | null = null;
    try {
      const response = await fetch(new URL("/api/billing/checkout", siteUrl), {
        method: "POST",
        headers: {"Content-Type": "application/json", "x-billing-cron-secret": cronSecret},
        body: JSON.stringify({
          organizationId: subscription.organization_id,
          planCode: subscription.plan,
          interval: subscription.billing_interval,
          extraSeats: subscription.extra_seats,
          locale: organization?.language === "en" ? "en" : "ar",
        }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json() as {checkoutUrl?: string};
      if (!response.ok || !result.checkoutUrl) throw new Error(`Checkout preparation returned ${response.status}`);
      const {error: saveError} = await supabase.from("billing_reminders").update({payment_url: result.checkoutUrl, last_error: null, claimed_at: null}).eq("id", reminder.id).is("payment_url", null);
      if (saveError) throw saveError;
      created += 1;
    } catch (cause) {
      failureReason = cause instanceof Error ? cause.message : "Unknown checkout preparation error";
      await supabase.from("billing_reminders").update({
        state: reminder.attempt_count + 1 >= 5 ? "failed" : "pending",
        last_error: failureReason.slice(0, 500),
        claimed_at: null,
        next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }).eq("id", reminder.id);
      failed += 1;
    }
  }
  return {created, failed, error: null};
}

async function deliverBillingReminders(supabase: ReturnType<typeof createClient>) {
  const {data, error} = await supabase.rpc("claim_billing_reminders", {batch_size: 25});
  if (error) return {sent: 0, failed: 0, error: error.message};

  let sent = 0;
  let failed = 0;
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("BILLING_FROM_EMAIL") ?? "";
  const siteUrl = Deno.env.get("BILLING_SITE_URL") ?? "";
  for (const reminder of (data ?? []) as ClaimedBillingReminder[]) {
    let failureReason: string | null = null;
    try {
      await sendBillingReminder(reminder, apiKey, fromEmail, siteUrl);
    } catch (cause) {
      failureReason = cause instanceof Error ? cause.message : "Unknown billing reminder error";
    }
    const {error: finishError} = await supabase.rpc("finish_billing_reminder", {
      target_reminder_id: reminder.reminder_id,
      delivery_error: failureReason,
    });
    if (finishError || failureReason) failed += 1;
    else sent += 1;
  }
  return {sent, failed, error: null};
}

async function sendReminderPush(delivery: ClaimedDelivery, supabase: ReturnType<typeof createClient>) {
  if (!delivery.subscriptions.length) return;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!publicKey || !privateKey || !subject) throw new Error("Web Push is not configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const arabic = delivery.locale === "ar";
  const leadName = delivery.lead_name ?? (arabic ? "العميل" : "the lead");
  const payload = JSON.stringify({
    title: arabic ? delivery.notification_title_ar : delivery.notification_title,
    body: arabic ? `حان موعد متابعة ${leadName}.` : `A follow-up with ${leadName} is due.`,
    url: `/${delivery.locale}/dashboard`,
    tag: `masar-task-${delivery.task_id}`,
    dir: arabic ? "rtl" : "ltr",
    lang: delivery.locale,
  });

  for (const subscription of delivery.subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {p256dh: subscription.p256dh, auth: subscription.auth},
      }, payload);
    } catch (cause) {
      const statusCode = typeof cause === "object" && cause !== null && "statusCode" in cause
        ? Number(cause.statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        continue;
      }
      throw new Error(`Web Push provider returned ${statusCode || "an unknown error"}`);
    }
  }
}

async function deliverNotificationQueue(supabase: ReturnType<typeof createClient>) {
  const {data, error} = await supabase.rpc("claim_notification_deliveries", {batch_size: 25});
  if (error) return {sent: 0, failed: 0, error: error.message};

  let sent = 0;
  let failed = 0;
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL") ?? Deno.env.get("IMPACT_REPORT_FROM_EMAIL") ?? "";
  for (const delivery of (data ?? []) as ClaimedDelivery[]) {
    let failureReason: string | null = null;
    try {
      if (delivery.delivery_channel === "email") await sendReminderEmail(delivery, apiKey, fromEmail);
      else await sendReminderPush(delivery, supabase);
    } catch (cause) {
      failureReason = cause instanceof Error ? cause.message : "Unknown reminder delivery error";
    }

    const {error: finishError} = await supabase.rpc("finish_notification_delivery", {
      target_delivery_id: delivery.delivery_id,
      delivery_error: failureReason,
    });
    if (finishError || failureReason) failed += 1;
    else sent += 1;
  }
  return {sent, failed, error: null};
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({error: "Method not allowed"}, 405);

  const expectedSecret = Deno.env.get("WORKFLOW_CRON_SECRET") ?? "";
  const providedSecret = request.headers.get("x-workflow-cron-secret") ?? "";
  if (expectedSecret.length < 32 || !secretsMatch(expectedSecret, providedSecret)) {
    return json({error: "Unauthorized"}, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({error: "Worker is not configured"}, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  });
  const {data, error} = await supabase.rpc("process_workflow_tasks");
  if (error) return json({error: "Workflow processing failed"}, 500);

  const {error: billingRenewalError} = await supabase.rpc("process_billing_renewals");
  if (billingRenewalError) return json({error: "Billing renewal processing failed"}, 500);
  const billingLinkPreparation = await prepareBillingPaymentLinks(
    supabase,
    Deno.env.get("BILLING_SITE_URL") ?? "",
    Deno.env.get("BILLING_CRON_SECRET") ?? "",
  );
  const billingReminders = await deliverBillingReminders(supabase);
  if (billingReminders.error) return json({error: "Billing reminder processing failed"}, 500);

  const reminderDeliveries = await deliverNotificationQueue(supabase);
  if (reminderDeliveries.error) return json({error: "Reminder delivery processing failed"}, 500);

  const {data: reports, error: claimError} = await supabase.rpc("claim_impact_reports");
  if (claimError) return json({error: "Impact report processing failed"}, 500);

  let sentReports = 0;
  let failedReports = 0;
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("IMPACT_REPORT_FROM_EMAIL") ?? "";
  for (const report of (reports ?? []) as ClaimedReport[]) {
    try {
      if (!resendApiKey || !fromEmail) throw new Error("Impact email delivery is not configured");
      const providerId = await deliverImpactReport(report, resendApiKey, fromEmail);
      const {error: sentError} = await supabase.rpc("mark_impact_report_sent", {
        target_report_id: report.report_id,
        provider_id: providerId,
      });
      if (sentError) throw sentError;
      sentReports += 1;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "Unknown report delivery error";
      await supabase.rpc("mark_impact_report_failed", {
        target_report_id: report.report_id,
        failure_reason: reason,
      });
      failedReports += 1;
    }
  }

  return json({ok: true, ...data, reminders: {sent: reminderDeliveries.sent, failed: reminderDeliveries.failed}, billingLinkPreparation, billingReminders: {sent: billingReminders.sent, failed: billingReminders.failed}, impactReports: {sent: sentReports, failed: failedReports}});
});