import {createClient} from "@supabase/supabase-js";
import {NextResponse, type NextRequest} from "next/server";
import type {Database} from "@/lib/supabase/database";

type WebhookBody = {
  name?: unknown;
  full_name?: unknown;
  phone?: unknown;
  email?: unknown;
  source?: unknown;
  property_interest?: unknown;
};

function stringField(...values: unknown[]) {
  const value = values.find((candidate) => typeof candidate === "string");
  return typeof value === "string" ? value.trim() : "";
}

function response(message: string, status: number) {
  return NextResponse.json({error: message}, {status, headers: {"Cache-Control": "no-store"}});
}

export async function POST(
  request: NextRequest,
  {params}: {params: Promise<{organizationId: string}>},
) {
  const {organizationId} = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    return response("Invalid organization", 404);
  }

  const secret = request.headers.get("x-masar-webhook-secret") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(secret)) return response("Unauthorized", 401);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) return response("Payload too large", 413);

  const reader = request.body?.getReader();
  if (!reader) return response("Invalid JSON body", 400);

  const chunks: Uint8Array[] = [];
  let payloadSize = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      payloadSize += value.byteLength;
      if (payloadSize > 64 * 1024) {
        await reader.cancel();
        return response("Payload too large", 413);
      }
      chunks.push(value);
    }
  } catch {
    return response("Invalid JSON body", 400);
  }

  const payload = new Uint8Array(payloadSize);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return response("Invalid JSON body", 400);
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return response("Invalid JSON body", 400);
  }
  const body = parsedBody as WebhookBody;

  const fullName = stringField(body.full_name, body.name);
  const phone = stringField(body.phone);
  const email = stringField(body.email) || null;
  const source = stringField(body.source) || "webhook";
  const propertyInterest = stringField(body.property_interest) || null;

  if (fullName.length < 2 || fullName.length > 160 || !phone || phone.length > 64) {
    return response("Name and a valid phone number are required", 400);
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return response("Invalid email address", 400);
  }
  if (source.length > 120 || (propertyInterest && propertyInterest.length > 160)) {
    return response("A field exceeds its maximum length", 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return response("Lead intake is unavailable", 503);

  const supabase = createClient<Database>(supabaseUrl, anonKey, {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  });
  const {data, error} = await supabase.rpc("ingest_webhook_lead", {
    target_organization_id: organizationId,
    supplied_secret: secret,
    lead_full_name: fullName,
    lead_phone: phone,
    lead_email: email,
    lead_source: source,
    lead_property_interest: propertyInterest,
  });

  if (error) {
    if (error.code === "28000") return response("Unauthorized", 401);
    if (error.code === "22023") return response("Invalid lead data", 400);
    if (error.code === "23503") return response("Organization is unavailable", 404);
    return response("Could not accept lead", 500);
  }

  return NextResponse.json(
    {id: data.id, duplicate: data.duplicate},
    {status: data.duplicate ? 200 : 201, headers: {"Cache-Control": "no-store"}},
  );
}