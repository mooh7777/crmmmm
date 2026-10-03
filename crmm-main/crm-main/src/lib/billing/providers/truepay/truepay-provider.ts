import {createHmac, timingSafeEqual} from "node:crypto";
import type {CheckoutSession, CreateCheckoutInput, PaymentProvider, ProviderPaymentStatus, VerifiedPaymentWebhook} from "../payment-provider";

const API_ORIGIN = "https://truepaysys.com/api/v1";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(...values: unknown[]): string | null {
  const value = values.find((candidate) => typeof candidate === "string" || typeof candidate === "number");
  return value === undefined ? null : String(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function describeFields(value: JsonObject | null) {
  if (!value) return "none";
  return Object.entries(value)
    .map(([key, field]) => `${key}:${Array.isArray(field) ? "array" : field === null ? "null" : typeof field}`)
    .sort()
    .join(", ") || "none";
}

function getApiKey() {
  const apiKey = process.env.TRUEPAY_API_KEY?.trim();
  if (!apiKey) throw new Error("TRUEPAY_API_KEY is not configured");
  return apiKey;
}

function mapStatus(status: unknown): ProviderPaymentStatus {
  if (status === "approved") return "succeeded";
  if (status === "rejected") return "failed";
  if (status === "pending") return "pending";
  throw new Error("TruePay returned an unsupported payment status");
}

export class TruePayProvider implements PaymentProvider {
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    if (input.currency !== "EGP") {
      throw new Error("TruePay SAR checkout is disabled until the provider confirms SAR support");
    }

    const response = await fetch(`${API_ORIGIN}/initiate`, {
      method: "POST",
      headers: {"X-Api-Key": getApiKey(), "Content-Type": "application/json"},
      body: JSON.stringify({
        amount: input.amount,
        order_id: input.orderId,
        currency: input.currency,
        method: "card",
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        redirect_url: input.redirectUrl,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`TruePay checkout request failed (${response.status})`);
    const body = objectValue(await response.json());
    const result = objectValue(body?.data) ?? body;
    const checkoutUrl = stringValue(result?.payment_url, result?.checkout_url, result?.redirect_url, result?.url);
    const providerTransactionId = stringValue(result?.transaction_id, result?.id);
    if (!checkoutUrl || !providerTransactionId) {
      throw new Error(`TruePay checkout response is missing a payment URL or transaction id; root fields: ${describeFields(body)}; data fields: ${describeFields(objectValue(body?.data))}`);
    }
    const parsedUrl = new URL(checkoutUrl);
    if (parsedUrl.protocol !== "https:") throw new Error("TruePay returned an insecure checkout URL");
    if (parsedUrl.toString() === new URL(input.redirectUrl).toString()) {
      throw new Error("TruePay checkout response only echoed the configured return URL");
    }
    return {checkoutUrl: parsedUrl.toString(), providerTransactionId};
  }

  async verifyWebhook(rawPayload: string, signature: string): Promise<VerifiedPaymentWebhook> {
    const secret = process.env.TRUEPAY_SECRET_KEY?.trim();
    if (!secret) throw new Error("TRUEPAY_SECRET_KEY is not configured");

    const suppliedHex = signature.trim().replace(/^sha256=/i, "");
    if (!/^[0-9a-f]{64}$/i.test(suppliedHex)) throw new Error("Invalid TruePay signature format");
    const expected = createHmac("sha256", secret).update(rawPayload, "utf8").digest();
    const supplied = Buffer.from(suppliedHex, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("Invalid TruePay signature");
    }

    const body = objectValue(JSON.parse(rawPayload));
    if (!body) throw new Error("Invalid TruePay webhook payload");
    const orderId = stringValue(body.foreign_id, body.order_id);
    const transactionId = stringValue(body.transaction_id, body.id);
    const amount = finiteNumber(body.amount);
    const status = body.status;
    const currency = stringValue(body.currency);
    const eventId = stringValue(body.event_id) ?? (transactionId && typeof status === "string" ? `${transactionId}:${status}` : null);

    if (!eventId || !orderId || !transactionId || amount === null) {
      throw new Error("TruePay webhook is missing required event fields");
    }
    if (status !== "approved" && status !== "pending" && status !== "rejected") {
      throw new Error("TruePay webhook has an unsupported status");
    }
    if (currency !== null && currency !== "EGP" && currency !== "SAR") throw new Error("TruePay webhook has an unsupported currency");

    return {eventId, orderId, transactionId, amount, status, currency: currency as "EGP" | "SAR" | null};
  }

  async getPaymentStatus(providerTransactionId: string): Promise<ProviderPaymentStatus> {
    const response = await fetch(`${API_ORIGIN}/transactions/${encodeURIComponent(providerTransactionId)}`, {
      headers: {"X-Api-Key": getApiKey(), Accept: "application/json"},
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`TruePay status request failed (${response.status})`);
    const body = objectValue(await response.json());
    const result = objectValue(body?.data) ?? body;
    return mapStatus(result?.status);
  }

  async refund(input: {providerTransactionId: string; amount?: number}): Promise<{refundId: string}> {
    void input;
    throw new Error("TruePay refund endpoint is not documented; refunds are disabled");
  }
}
