import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {AppShell} from "@/components/app-shell";
import {NewLeadForm} from "@/components/new-lead-form";
import type {OrganizationRow} from "@/lib/supabase/database";

export default async function NewLeadPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  const supabase = await createClient();
  const [{data: {user}}, {data: memberships}] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("memberships").select("organization_id, role").limit(1),
  ]);
  if (!user) redirect(`/${locale}`);
  const membership = memberships?.[0];
  if (!membership) redirect(`/${locale}/onboarding`);
  const {data} = await supabase.from("organizations").select("*").eq("id", membership.organization_id).single();
  const organization = data as OrganizationRow | null;
  if (!organization) redirect(`/${locale}/onboarding`);

  return (
    <AppShell locale={locale as "ar" | "en"} organization={organization} page="new-lead" role={membership.role} userEmail={user.email ?? ""}>
      <div className="dashboard-content narrow-content">
          <div className="page-heading"><div><p className="eyebrow">{locale === "ar" ? "توزيع تلقائي ومتابعة فورية" : "AUTO-ASSIGNED · FOLLOW-UP REQUIRED"}</p><h1>{locale === "ar" ? "عميل محتمل جديد" : "New lead"}</h1></div></div>
          <p className="form-intro lead-intro">{locale === "ar" ? "سيُعيّن العميل تلقائيًا إلى مسؤول المبيعات الأقل انشغالًا، مع إنشاء مهمة متابعة خلال ساعة." : "The lead is assigned to the least-loaded salesperson, with a follow-up task due in one hour."}</p>
          <NewLeadForm locale={locale as "ar" | "en"} organizationId={membership.organization_id} timezone={organization.timezone} />
      </div>
    </AppShell>
  );
}