export type BillingCurrency = "EGP" | "SAR";
export type ProviderPaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export type CreateCheckoutInput = {
  orderId: string;
  amount: number;
  currency: BillingCurrency;
  redirectUrl: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
};

export type CheckoutSession = {
  providerTransactionId: string;
  checkoutUrl: string;
};

export type VerifiedPaymentWebhook = {
  eventId: string;
  orderId: string;
  transactionId: string;
  status: "approved" | "pending" | "rejected";
  amount: number;
  currency: BillingCurrency | null;
};

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(rawPayload: string, signature: string): Promise<VerifiedPaymentWebhook>;
  getPaymentStatus(providerTransactionId: string): Promise<ProviderPaymentStatus>;
  refund(input: {providerTransactionId: string; amount?: number}): Promise<{refundId: string}>;
  chargeSavedCard?(input: {customerId: string; amount: number; currency: BillingCurrency; orderId: string}): Promise<CheckoutSession>;
}
