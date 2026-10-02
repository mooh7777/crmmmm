import Link from "next/link";
import {notFound} from "next/navigation";
import {AppShell} from "@/components/app-shell";
import {Icon} from "@/components/ui/icon";
import type {OrganizationRow} from "@/lib/supabase/database";

type DemoView = "overview" | "new-lead" | "settings";

const demoOrganization: OrganizationRow = {
  id: "local-demo",
  name: "Masar Demo Egypt",
  slug: "masar-demo-egypt",
  timezone: "Africa/Cairo",
  currency: "EGP",
  weekend_days: [5, 6],
  working_hours: {start: "09:00", end: "18:00"},
  language: "ar",
  created_by: null,
  created_at: "2026-01-01T09:00:00.000Z",
  updated_at: "2026-01-01T09:00:00.000Z",
};

const demoLeads = [
  {name: "أحمد محمود", phone: "+20 100 123 4567", interest: "شقة · القاهرة الجديدة", status: "جديد", tone: "brand"},
  {name: "سارة علي", phone: "+20 101 456 7890", interest: "فيلا · الشيخ زايد", status: "تم التواصل", tone: "neutral"},
  {name: "عمر حسن", phone: "+20 102 321 9876", interest: "شقة · العاصمة الإدارية", status: "مؤهل", tone: "success"},
];

export default async function DemoPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{view?: string}>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const [{locale}, query] = await Promise.all([params, searchParams]);
  const language = locale === "ar" ? "ar" : "en";
  const view: DemoView = query.view === "settings" || query.view === "new-lead" ? query.view : "overview";
  const page = view === "settings" ? "settings" : view === "new-lead" ? "new-lead" : "overview";
  const text = (arabic: string, english: string) => language === "ar" ? arabic : english;
  const title = view === "settings"
    ? text("إعدادات المؤسسة", "Organization settings")
    : view === "new-lead"
      ? text("عميل محتمل جديد", "New lead")
      : text("نظرة عامة", "Overview");

  return (
    <AppShell
      demo
      leadCount={12}
      locale={language}
      organization={demoOrganization}
      page={page}
      role="owner"
      todayTaskCount={3}
      userEmail="demo@masar.local"
    >
      <div className="dashboard-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{text("مساحة تجريبية · القاهرة", "LOCAL PREVIEW · CAIRO")}</p>
            <h1>{title}</h1>
          </div>
          {view === "overview" && <Link className="primary-button compact-button touch-target" href={`/${language}/demo?view=new-lead`}><Icon name="add" size={18} />{text("إضافة عميل", "Add lead")}</Link>}
        </div>

        <p className="demo-notice" role="status"><Icon name="info" size={17} />{text("معاينة للقراءة فقط. البيانات تجريبية ولا تُحفظ.", "Read-only preview. Sample data is not saved.")}</p>

        {view === "overview" && <>
          <div className="metrics-grid">
            <article className="metric-block"><div className="metric-label"><span>{text("عملاء مفتوحون", "Open leads")}</span><Icon name="leads" size={18} /></div><strong className="metric-value">١٢</strong><span className="metric-footnote">{text("في المؤسسة", "Across your organization")}</span></article>
            <article className="metric-block"><div className="metric-label"><span>{text("متابعات اليوم", "Due today")}</span><Icon name="calendar" size={18} /></div><strong className="metric-value">٣</strong><span className="metric-footnote">{text("حسب توقيت القاهرة", "Cairo time")}</span></article>
            <article className="metric-block kpi-warning"><div className="metric-label"><span>{text("متابعات متأخرة", "Overdue")}</span><Icon name="overdue" size={18} /></div><strong className="metric-value">٢</strong><span className="metric-footnote">{text("تحتاج إلى انتباه", "Need attention")}</span></article>
            <article className="metric-block kpi-success"><div className="metric-label"><span>{text("مكتملة", "Completed")}</span><Icon name="success" size={18} /></div><strong className="metric-value">٢٨</strong><span className="metric-footnote">{text("هذا الشهر", "This month")}</span></article>
          </div>

          <section className="data-section" id="leads">
            <div className="section-heading"><div><h2>{text("أحدث العملاء", "Recent leads")}</h2><p>{text("آخر العملاء الذين وصلوا إلى فريقك", "The latest leads routed to your team")}</p></div><Link className="text-link" href={`/${language}/demo?view=new-lead`}>{text("إضافة عميل", "Add lead")}<Icon name="add" size={16} /></Link></div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>{text("العميل", "Lead")}</th><th>{text("الاهتمام", "Interest")}</th><th>{text("المسؤول", "Assignee")}</th><th>{text("الحالة", "Status")}</th><th>{text("تاريخ الإضافة", "Added")}</th></tr></thead><tbody>
              {demoLeads.map((lead, index) => <tr key={lead.phone}><td><strong>{lead.name}</strong><span className="table-secondary" dir="ltr">{lead.phone}</span></td><td>{lead.interest}</td><td>{text("مريم خالد", "Mariam Khaled")}</td><td><span className={`ds-badge ds-badge-${lead.tone}`}>{language === "ar" ? lead.status : ["New", "Contacted", "Qualified"][index]}</span></td><td>{text("اليوم، ٩:٤٠ ص", "Today, 9:40 AM")}</td></tr>)}
            </tbody></table></div>
          </section>

          <div className="lower-grid">
            <section className="data-section task-section" id="tasks">
              <div className="section-heading"><div><h2>{text("المتابعات القادمة", "Upcoming follow-ups")}</h2><p>{text("المواعيد التي تحتاج إلى إجراء", "Tasks that need attention")}</p></div><span className="section-total">٣</span></div>
              <div className="task-list">
                {[text("الاتصال بأحمد محمود", "Call Ahmed Mahmoud"), text("إرسال تفاصيل الوحدة لسارة", "Send property details to Sara"), text("تأكيد موعد المعاينة", "Confirm viewing appointment")].map((task, index) => <article className={`task-row${index === 1 ? " task-late" : ""}`} key={task}><span className={`task-status${index === 1 ? " task-late" : ""}`}><Icon name={index === 1 ? "overdue" : "clock"} size={18} /></span><div className="task-copy"><strong>{task}</strong><span>{index === 1 ? text("متأخرة · منذ ٢٠ دقيقة", "Overdue · 20 minutes") : text("اليوم · ١٠:٣٠ ص", "Today · 10:30 AM")}</span></div></article>)}
              </div>
            </section>
            <section className="data-section pipeline-section" id="pipeline">
              <div className="section-heading"><div><h2>{text("مسار المبيعات", "Sales pipeline")}</h2><p>{text("توزيع العملاء حسب المرحلة", "Leads by current stage")}</p></div></div>
              <div className="pipeline-list">{[
                [text("جديد", "New"), "12", "82%"],
                [text("تم التواصل", "Contacted"), "8", "58%"],
                [text("مؤهل", "Qualified"), "5", "38%"],
                [text("تم البيع", "Won"), "2", "16%"],
              ].map(([stage, count, width]) => <div className="pipeline-row" key={stage}><div className="pipeline-label"><span>{stage}</span><strong>{count}</strong></div><div className="pipeline-track"><span className="pipeline-fill" style={{width}} /></div></div>)}</div>
            </section>
          </div>
        </>}

        {view === "new-lead" && <>
          <p className="form-intro lead-intro">{text("سيُعيّن العميل تلقائيًا إلى مسؤول المبيعات الأقل انشغالًا، مع إنشاء مهمة متابعة خلال ساعة.", "The lead is assigned to the least-loaded salesperson, with a follow-up task due in one hour.")}</p>
          <form className="settings-form lead-form">
            <label htmlFor="demo-name">{text("اسم العميل", "Lead name")}</label><input className="ds-input" disabled id="demo-name" value={text("ليلى إبراهيم", "Layla Ibrahim")} readOnly />
            <div className="field-grid"><div className="field-stack"><label htmlFor="demo-phone">{text("رقم الهاتف", "Phone")}</label><input className="ds-input" disabled dir="ltr" id="demo-phone" value="010 1234 5678" readOnly /></div><div className="field-stack"><label htmlFor="demo-email">{text("البريد الإلكتروني", "Email")}</label><input className="ds-input" disabled dir="ltr" id="demo-email" value="layla@example.com" readOnly /></div></div>
            <div className="field-grid"><div className="field-stack"><label htmlFor="demo-source">{text("مصدر العميل", "Lead source")}</label><select className="ds-select" disabled id="demo-source" value="website"><option value="website">{text("الموقع الإلكتروني", "Website")}</option></select></div><div className="field-stack"><label htmlFor="demo-interest">{text("الاهتمام العقاري", "Property interest")}</label><input className="ds-input" disabled id="demo-interest" value={text("شقة · القاهرة الجديدة", "Apartment · New Cairo")} readOnly /></div></div>
            <div className="form-actions"><Link className="secondary-button touch-target" href={`/${language}/demo`}>{text("العودة للوحة", "Back to overview")}</Link><button className="primary-button lead-submit touch-target" disabled type="button"><Icon name="add" size={18} />{text("إنشاء العميل", "Create lead")}</button></div>
          </form>
        </>}

        {view === "settings" && <>
          <section className="settings-section">
            <div className="section-heading"><div><h2>{text("الإعدادات الإقليمية", "Regional settings")}</h2><p>{text("تُستخدم هذه القيم لتوقيت التنبيهات وعرض بيانات المبيعات.", "Used for reminder timing and sales data display.")}</p></div></div>
            <div className="settings-form"><label htmlFor="demo-org">{text("اسم المؤسسة", "Organization name")}</label><input className="ds-input" disabled id="demo-org" value="Masar Demo Egypt" readOnly />
              <div className="field-grid"><div className="field-stack"><label htmlFor="demo-timezone">{text("المنطقة الزمنية", "Timezone")}</label><select className="ds-select" disabled id="demo-timezone" value="Africa/Cairo"><option value="Africa/Cairo">Africa/Cairo</option></select></div><div className="field-stack"><label htmlFor="demo-currency">{text("العملة", "Currency")}</label><select className="ds-select" disabled id="demo-currency" value="EGP"><option value="EGP">EGP · Egypt</option></select></div></div>
            </div>
          </section>
          <section className="settings-section"><div className="section-heading"><div><h2>{text("إعدادات سير العمل", "Workflow settings")}</h2><p>{text("التوزيع والمتابعة التلقائيان لفريق المبيعات.", "Automatic assignment and follow-up for your sales team.")}</p></div></div><label className="workflow-toggle"><input checked disabled type="checkbox" readOnly /><span><strong>{text("التوزيع التلقائي للعملاء", "Automatic lead assignment")}</strong><small>{text("توزيع العميل على الأقل انشغالا بالعملاء المفتوحين.", "Assign each lead to the salesperson with the fewest open leads.")}</small></span></label></section>
        </>}
      </div>
    </AppShell>
  );
}