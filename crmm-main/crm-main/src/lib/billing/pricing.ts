import type {BillingCurrency} from "./providers/payment-provider";
import type {BillingPlanRow} from "@/lib/supabase/database";

export type BillingInterval = "monthly" | "annual";

export function calculateSubscriptionAmount(
  plan: BillingPlanRow,
  interval: BillingInterval,
  extraSeats: number,
  currency: BillingCurrency,
  founderDiscountPercent = 0,
) {
  const basePrice = currency === "EGP" ? plan.monthly_price_egp : plan.monthly_price_sar;
  const extraSeatPrice = currency === "EGP" ? plan.extra_seat_price_egp : plan.extra_seat_price_sar;
  const annualFactor = interval === "annual" ? 10 : 1;
  const subtotal = (basePrice + extraSeats * extraSeatPrice) * annualFactor;
  return Math.round(subtotal * (1 - founderDiscountPercent / 100) * 100) / 100;
}

export function getBillingPeriod(start: Date, interval: BillingInterval) {
  const end = new Date(start);
  const originalDay = end.getUTCDate();
  end.setUTCDate(1);
  if (interval === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDayOfMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDayOfMonth));
  return end;
}
