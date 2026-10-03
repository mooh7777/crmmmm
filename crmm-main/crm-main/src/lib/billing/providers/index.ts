import type {PaymentProvider} from "./payment-provider";
import {TruePayProvider} from "./truepay/truepay-provider";

export function getPaymentProvider(): PaymentProvider {
  const providerName = process.env.PAYMENT_PROVIDER ?? "truepay";
  if (providerName === "truepay") return new TruePayProvider();
  throw new Error(`Unsupported payment provider: ${providerName}`);
}
