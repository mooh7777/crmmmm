import Link from "next/link";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {createClient} from "@/lib/supabase/server";
import {AppShell} from "@/components/app-shell";
import {Input, Select} from "@/components/ui/primitives";
import type {AutomationRuleRow, OrganizationRow} from "@/lib/supabase/database";
import {saveImpactAssumptions, saveOrganizationSettings} from "../actions";

function getRuleNumber(rules: AutomationRuleRow[] | null, ruleKey: string, field: string, fallback: number) {
  const configuration = rules?.find((rule) => rule.rule_key === ruleKey)?.configuration;
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return fallback;
  const value = configuration[field];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export default async function OrganizationSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{error?: string; notice?: string}>;
}) {
  const [{locale}, query, t, messages, supabase] = await Promise.all([
    params,
    searchParams,
    getTranslations("organization"),
    getTranslations("messages"),
    createClient(),
  ]);
  const [{data: {user}}, {data: memberships}] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("memberships").select("organization_id, role").limit(1),
  ]);
  if (!user) redirect(`/${locale}`);
  const membership = memberships?.[0];
  if (!membership) redirect(`/${locale}/onboarding`);
  if (membership.role === "sales") redirect(`/${locale}/dashboard`);

  const [{data}, {data: salesMembers}, {data: workflowRules}] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
    supabase.rpc("get_workflow_sales_members", {target_organization_id: membership.organization_id}),
    supabase.from("automation_rules").select("organization_id, rule_key, enabled, configuration, created_at, updated_at").eq("organization_id", membership.organization_id),
  ]);
  const {data: impactAssumptionsData} = await supabase.rpc("get_impact_assumptions", {target_organization_id: membership.organization_id});
  const organization = data as OrganizationRow | null;
  if (!organization) redirect(`/${locale}/dashboard`);
  const impactAssumptions = impactAssumptionsData && typeof impactAssumptionsData === "object" && !Array.isArray(impactAssumptionsData)
    ? impactAssumptionsData
    : {};
  const averageDealValue = typeof impactAssumptions.average_deal_value === "number" ? impactAssumptions.average_deal_value : "";
  const closeRatePercent = typeof impactAssumptions.close_rate_percent === "number" ? impactAssumptions.close_rate_percent : "";
  const followUpMinutes = getRuleNumber(workflowRules, "lead.required_follow_up", "due_in_minutes", 60);
  const escalationMinutes = getRuleNumber(workflowRules, "task.escalate_overdue", "after_minutes", 15);
  const autoAssignEnabled = workflowRules?.find((rule) => rule.rule_key === "lead.auto_assign")?.enabled ?? true;

  return (
    <AppShell locale={locale as "ar" | "en"} organization={organization} page="settings" role={membership.role} userEmail={user.email ?? ""}>
      <div className="dashboard-content narrow-content">
          <div className="page-heading"><div><p className="eyebrow">{locale === "ar" ? "مساحة العمل" : "WORKSPACE"}</p><h1>{t("settings")}</h1></div></div>
          <section className="settings-section">
            <div className="section-heading"><div><h2>{locale === "ar" ? "الاشتراك والفوترة" : "Subscription and billing"}</h2><p>{locale === "ar" ? "إدارة الباقة، المقاعد، وتجديد الاشتراك." : "Manage your plan, seats, and renewal."}</p></div><Link className="primary-button compact-button" href={`/${locale}/settings/billing`}>{locale === "ar" ? "إدارة الاشتراك" : "Manage billing"}</Link></div>
          </section>
          <section className="settings-section">
            <div className="section-heading"><div><h2>{locale === "ar" ? "الإعدادات الإقليمية" : "Regional settings"}</h2><p>{locale === "ar" ? "تُستخدم هذه القيم لتوقيت التنبيهات وعرض بيانات المبيعات." : "Used for reminder timing and sales data display."}</p></div></div>
            {query.error === "settings" && <p className="form-alert" role="alert">{messages("genericError")}</p>}
            {query.notice === "saved" && <p className="form-success" role="status">{locale === "ar" ? "تم حفظ الإعدادات." : "Settings saved."}</p>}
            <form action={saveOrganizationSettings.bind(null, organization.id, locale as "ar" | "en")} className="settings-form">
              <label htmlFor="org-name">{t("name")}</label><Input id="org-name" name="name" defaultValue={organization.name} minLength={2} maxLength={120} required />
              <div className="field-grid">
                <div className="field-stack"><label htmlFor="timezone">{t("timezone")}</label><Select id="timezone" name="timezone" defaultValue={organization.timezone}><option value="Africa/Cairo">{t("egypt")} · Africa/Cairo</option><option value="Asia/Riyadh">{t("saudi")} · Asia/Riyadh</option></Select></div>
                <div className="field-stack"><label htmlFor="currency">{t("currency")}</label><Select id="currency" name="currency" defaultValue={organization.currency}><option value="EGP">EGP · {t("egypt")}</option><option value="SAR">SAR · {t("saudi")}</option></Select></div>
              </div>
              <div className="field-grid">
                <div className="field-stack"><label htmlFor="language">{t("language")}</label><Select id="language" name="language" defaultValue={organization.language}><option value="ar">{t("arabic")}</option><option value="en">{t("english")}</option></Select></div>
                <div className="field-stack"><span className="field-label">{locale === "ar" ? "أيام العطلة الأسبوعية" : "Weekend days"}</span><div className="weekend-options">{(locale === "ar" ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((day, index) => <label className="weekend-option" key={day}><input type="checkbox" name="weekendDays" value={index} defaultChecked={organization.weekend_days.includes(index)} /><span>{day}</span></label>)}</div></div>
              </div>
              <div className="field-grid">
                <div className="field-stack"><label htmlFor="start">{locale === "ar" ? "بداية العمل" : "Working hours start"}</label><input id="start" name="start" type="time" defaultValue={organization.working_hours.start} required /></div>
                <div className="field-stack"><label htmlFor="end">{locale === "ar" ? "نهاية العمل" : "Working hours end"}</label><input id="end" name="end" type="time" defaultValue={organization.working_hours.end} required /></div>
              </div>
              <div className="workflow-settings-heading"><h3>{t("workflowTitle")}</h3><p>{t("workflowDescription")}</p></div>
              <label className="workflow-toggle">
                <input type="checkbox" name="autoAssign" value="enabled" defaultChecked={autoAssignEnabled} />
                <span><strong>{t("autoAssign")}</strong><small>{t("autoAssignHelp")}</small></span>
              </label>
              <div className="field-stack">
                <span className="field-label">{t("activeSales")}</span>
                {salesMembers?.length ? <div className="sales-member-options">{salesMembers.map((member) => <label className="weekend-option sales-member-option" key={member.sales_user_id}>
                  <input type="checkbox" name="activeSalesIds" value={member.sales_user_id} defaultChecked={member.is_active} />
                  <span>{member.sales_email}</span>
                </label>)}</div> : <p className="form-intro">{t("noSalesMembers")}</p>}
                {!salesMembers?.some((member) => member.is_active) && <p className="form-intro">{t("noActiveSales")}</p>}
              </div>
              <div className="field-grid">
                <div className="field-stack"><label htmlFor="follow-up-minutes">{t("followUpMinutes")}</label><input id="follow-up-minutes" name="followUpMinutes" type="number" min="1" max="10080" defaultValue={followUpMinutes} required /><small>{t("minutesUnit")}</small></div>
                <div className="field-stack"><label htmlFor="escalation-minutes">{t("escalationMinutes")}</label><input id="escalation-minutes" name="escalationMinutes" type="number" min="0" max="1440" defaultValue={escalationMinutes} required /><small>{t("minutesUnit")}</small></div>
              </div>
              <p className="form-intro">{t("workingMinutesHelp")}</p>
              <button className="primary-button settings-save" type="submit">{t("save")}</button>
            </form>
          </section>
          {membership.role === "owner" && <section className="settings-section impact-assumptions-section">
            <div className="section-heading"><div><h2>{t("impactAssumptionsTitle")}</h2><p>{t("impactAssumptionsDescription", {currency: organization.currency})}</p></div></div>
            {query.error?.startsWith("impact") && <p className="form-alert" role="alert">{t("impactAssumptionsError")}</p>}
            {query.notice === "impact-saved" && <p className="form-success" role="status">{t("impactAssumptionsSaved")}</p>}
            <form action={saveImpactAssumptions.bind(null, organization.id, locale as "ar" | "en")} className="settings-form">
              <div className="field-grid">
                <div className="field-stack"><label htmlFor="average-deal-value">{t("averageDealValue")}</label><input id="average-deal-value" name="averageDealValue" type="number" min="0.01" max="1000000000" step="0.01" defaultValue={averageDealValue} required /></div>
                <div className="field-stack"><label htmlFor="close-rate-percent">{t("closeRatePercent")}</label><input id="close-rate-percent" name="closeRatePercent" type="number" min="0" max="100" step="0.1" defaultValue={closeRatePercent} required /></div>
              </div>
              <button className="primary-button settings-save" type="submit">{t("saveImpactAssumptions")}</button>
            </form>
          </section>}
      </div>
    </AppShell>
  );
}