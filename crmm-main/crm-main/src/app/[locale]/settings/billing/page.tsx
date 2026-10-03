import Link from "next/link";
import {redirect} from "next/navigation";
import {AppShell} from "@/components/app-shell";
import {BillingSettings} from "@/components/billing-settings";
import {createClient} from "@/lib/supabase/server";
import type {OrganizationRow, SubscriptionRow} from "@/lib/supabase/database";

export default async function BillingPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  const language = locale === "en" ? "en" : "ar";
  const supabase = await createClient();
  const [{data: {user}}, {data: memberships}] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("memberships").select("organization_id, role").limit(1),
  ]);
  if (!user) redirect(`/${locale}`);
  const membership = memberships?.[0];
  if (!membership) redirect(`/${locale}/onboarding`);
  if (membership.role === "sales") redirect(`/${locale}/dashboard`);

  const [{data: organization}, {data: subscription}, {data: plans}] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
    supabase.from("subscriptions").select("*").eq("organization_id", membership.organization_id).single(),
    supabase.from("billing_plans").select("*").eq("active", true).order("monthly_price_egp"),
  ]);
  if (!organization || !subscription || !plans) redirect(`/${locale}/settings?error=billing`);

  return (
    <AppShell locale={language} organization={organization as OrganizationRow} page="settings" role={membership.role} userEmail={user.email ?? ""}>
      <div className="dashboard-content narrow-content">
        <div className="page-heading"><div><p className="eyebrow">{language === "ar" ? "مساحة العمل" : "WORKSPACE"}</p><h1>{language === "ar" ? "الاشتراك والفوترة" : "Subscription and billing"}</h1></div></div>
        <p><Link className="text-link" href={`/${locale}/settings`}>{language === "ar" ? "العودة إلى الإعدادات" : "Back to settings"}</Link></p>
        {<BillingSettings
          currency={subscription.currency}
          locale={language}
          organizationId={organization.id}
          plans={plans}
          subscription={subscription as SubscriptionRow}
        />}
      </div>
    </AppShell>
  );
}
