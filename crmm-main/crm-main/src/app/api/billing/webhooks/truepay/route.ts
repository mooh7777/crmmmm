import {NextResponse, type NextRequest} from "next/server";
import {getPaymentProvider} from "@/lib/billing/providers";
import {createAdminClient} from "@/lib/supabase/admin";

const MAX_PAYLOAD_BYTES = 64 * 1024;

function response(message: string, status: number) {
  return NextResponse.json({error: message}, {status, headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_PAYLOAD_BYTES) return response("Payload too large", 413);
  const signature = request.headers.get("x-signature") ?? "";
  if (!signature) return response("Missing signature", 403);
  if (!process.env.TRUEPAY_SECRET_KEY?.trim()) return response("Webhook is not configured", 503);

  const reader = request.body?.getReader();
  if (!reader) return response("Invalid payload", 400);
  const chunks: Uint8Array[] = [];
  let payloadSize = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      payloadSize += value.byteLength;
      if (payloadSize > MAX_PAYLOAD_BYTES) {
        await reader.cancel();
        return response("Payload too large", 413);
      }
      chunks.push(value);
    }
  } catch {
    return response("Invalid payload", 400);
  }
  const payloadBytes = new Uint8Array(payloadSize);
  let offset = 0;
  for (const chunk of chunks) {
    payloadBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const rawPayload = new TextDecoder().decode(payloadBytes);

  let event;
  try {
    event = await getPaymentProvider().verifyWebhook(rawPayload, signature);
  } catch {
    return response("Invalid payment webhook", 403);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return response("Billing is not configured", 503);
  }

  const {data: existing, error: lookupError} = await admin.from("payments_events")
    .select("id, processed_at")
    .eq("provider", "truepay")
    .eq("event_id", event.eventId)
    .maybeSingle();
  if (lookupError) return response("Could not load payment event", 500);

  let eventId = existing?.id;
  let eventProcessed = Boolean(existing?.processed_at);
  if (!existing) {
    const {data: inserted, error: insertError} = await admin.from("payments_events").insert({
      provider: "truepay",
      event_id: event.eventId,
      order_id: event.orderId,
      transaction_id: event.transactionId,
      payment_status: event.status,
      amount: event.amount,
      currency: event.currency,
      raw_payload: rawPayload,
    }).select("id").single();
    if (insertError || !inserted) {
      if (insertError?.code !== "23505") return response("Could not store payment event", 500);
      const {data: duplicate, error: duplicateError} = await admin.from("payments_events")
        .select("id, processed_at")
        .eq("provider", "truepay")
        .eq("event_id", event.eventId)
        .maybeSingle();
      if (duplicateError || !duplicate) return response("Could not load duplicate payment event", 500);
      eventId = duplicate.id;
      eventProcessed = Boolean(duplicate.processed_at);
    } else {
      eventId = inserted.id;
    }
  }
  if (!eventId) return response("Could not store payment event", 500);
  if (eventProcessed) return NextResponse.json({ok: true, duplicate: true}, {headers: {"Cache-Control": "no-store"}});

  const {data: result, error: processError} = await admin.rpc("apply_truepay_payment_event", {target_event_id: eventId});
  if (processError) return response("Could not process payment event", 500);
  if (result === "amount-mismatch") return response("Payment amount or currency mismatch", 422);
  if (result === "unknown-order") return response("Unknown order id", 404);

  return NextResponse.json({ok: true, result}, {headers: {"Cache-Control": "no-store"}});
}
