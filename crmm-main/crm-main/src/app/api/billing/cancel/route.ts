import {NextResponse, type NextRequest} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {status, headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && new URL(requestOrigin).host !== request.nextUrl.host) return json({error: "Forbidden"}, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({error: "Invalid request"}, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({error: "Invalid request"}, 400);
  const organizationId = "organizationId" in body && typeof body.organizationId === "string" ? body.organizationId : "";
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json({error: "Invalid organization"}, 400);

  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return json({error: "Unauthorized"}, 401);
  const {data: membership} = await supabase.from("memberships").select("role")
    .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) return json({error: "Forbidden"}, 403);

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return json({error: "Billing is not configured"}, 503);
  }
  const {data: subscription, error: readError} = await admin.from("subscriptions").select("id, status, trial_ends_at, current_period_end, past_due_since")
    .eq("organization_id", organizationId).maybeSingle();
  if (readError || !subscription) return json({error: "Subscription not found"}, 404);
  if (subscription.status === "canceled") return json({ok: true, alreadyCanceled: true});

  const graceEnd = subscription.past_due_since
    ? new Date(new Date(subscription.past_due_since).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const accessUntil = subscription.status === "trialing"
    ? subscription.trial_ends_at
    : subscription.status === "past_due"
      ? graceEnd
      : subscription.current_period_end;
  const {error: updateError} = await admin.from("subscriptions").update({
    status: "canceled",
    current_period_end: accessUntil,
    updated_at: new Date().toISOString(),
  }).eq("id", subscription.id);
  if (updateError) return json({error: "Could not cancel subscription"}, 500);
  return json({ok: true, accessUntil});
}
