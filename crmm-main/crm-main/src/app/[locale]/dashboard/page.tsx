import Link from "next/link";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {createClient} from "@/lib/supabase/server";
import {completeTask} from "../actions";
import {AppShell} from "@/components/app-shell";
import {LeadImportDialog} from "@/components/lead-import-dialog";
import {ManagerDashboard} from "@/components/manager-dashboard";
import {RealtimeRefresh} from "@/components/realtime-refresh";
import {Badge, EmptyState, Table, TableRow} from "@/components/ui/primitives";
import {Icon} from "@/components/ui/icon";
import {KpiCard} from "@/components/ui/kpi-card";
import {SalesToday} from "@/components/sales-today";
import {OnboardingChecklist} from "@/components/onboarding-checklist";
import type {ImpactDashboardSummary, LeadRow, ManagerDashboardMetrics, NotificationRow, OrganizationRow, TaskRow} from "@/lib/supabase/database";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isDateParam(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function dateInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {timeZone, year: "numeric", month: "2-digit", day: "2-digit"}).format(date);
}

function daysBefore(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function zonedDayStart(date: Date, timeZone: string) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => dateParts.find((value) => value.type === type)?.value ?? "0";
  const target = Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")));
  let instant = target;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const value = (type: string) => Number(localParts.find((item) => item.type === type)?.value ?? 0);
    const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    instant = target - (localAsUtc - instant);
  }

  return new Date(instant);
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<{notice?: string | string[]; from?: string | string[]; to?: string | string[]; stage?: string | string[]; salesperson?: string | string[]}>;
}) {
  const [{locale}, query, t, supabase] = await Promise.all([
    params,
    searchParams,
    getTranslations("dashboard"),
    createClient(),
  ]);
  const [{data: {user}}, {data: memberships}] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("memberships").select("organization_id, role").limit(1),
  ]);
  if (!user) redirect(`/${locale}`);
  const membership = memberships?.[0];
  if (!membership) redirect(`/${locale}/onboarding`);

  const {data: organization} = await supabase.from("organizations").select("*").eq("id", membership.organization_id).single();
  const org = organization as OrganizationRow | null;
  if (!org) redirect(`/${locale}/onboarding`);

  const isManager = membership.role === "owner" || membership.role === "manager";
  const todayDate = dateInTimeZone(new Date(), org.timezone);
  const requestedEnd = firstParam(query.to);
  const endDate = isDateParam(requestedEnd) && requestedEnd! <= todayDate ? requestedEnd! : todayDate;
  const requestedStart = firstParam(query.from);
  const startDate = isDateParam(requestedStart) && requestedStart! <= endDate && Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${requestedStart}T00:00:00Z`) <= 90 * 24 * 60 * 60 * 1000
    ? requestedStart!
    : daysBefore(endDate, 29);
  const [salesMembersResponse, stagesResponse, workflowRulesResponse] = isManager ? await Promise.all([
    supabase.rpc("get_workflow_sales_members", {target_organization_id: membership.organization_id}),
    supabase.from("pipeline_stages").select("id, name, name_ar, position").eq("organization_id", membership.organization_id).order("position"),
    supabase.from("automation_rules").select("rule_key, enabled").eq("organization_id", membership.organization_id).in("rule_key", ["lead.auto_assign", "lead.required_follow_up", "task.escalate_overdue"]),
  ]) : [null, null, null];
  const salesMembers = salesMembersResponse?.data ?? [];
  const stages = stagesResponse?.data ?? [];
  const workflowRules = workflowRulesResponse?.data ?? [];
  const followUpWorkflowReady = ["lead.auto_assign", "lead.required_follow_up", "task.escalate_overdue"].every((ruleKey) => workflowRules.some((rule) => rule.rule_key === ruleKey && rule.enabled));
  const requestedSalesperson = firstParam(query.salesperson) ?? "";
  const requestedStage = firstParam(query.stage) ?? "";
  const selectedSalespersonId = salesMembers.some((person) => person.sales_user_id === requestedSalesperson) ? requestedSalesperson : "";
  const selectedStageId = stages.some((stage) => stage.id === requestedStage) ? requestedStage : "";
  let managerMetrics: ManagerDashboardMetrics | null = null;
  let impactSummary: ImpactDashboardSummary | null = null;
  let managerMetricsError = false;
  if (isManager) {
    const [{data: metricsData, error: metricsError}, {data: impactData, error: impactError}] = await Promise.all([
      supabase.rpc("get_manager_dashboard_metrics", {
        target_organization_id: org.id,
        start_date: startDate,
        end_date: endDate,
        target_stage_id: selectedStageId || null,
        target_salesperson_id: selectedSalespersonId || null,
      }),
      supabase.rpc("get_impact_dashboard_summary", {target_organization_id: org.id}),
    ]);
    managerMetrics = metricsData;
    impactSummary = impactData;
    managerMetricsError = Boolean(metricsError || impactError);
  }

  const todayStart = zonedDayStart(new Date(), org.timezone);
  const tomorrowStart = zonedDayStart(new Date(todayStart.getTime() + 36 * 60 * 60 * 1000), org.timezone);
  const [
    {data: leadRows},
    {data: taskRows},
    {count: openLeads},
    {count: todayTasks},
    {count: overdueTasks},
    {count: doneTasks},
    {data: notificationRows},
  ] = await Promise.all([
    supabase.from("leads").select("*").eq("organization_id", membership.organization_id).order("created_at", {ascending: false}).limit(8),
    supabase.from("tasks").select("*").eq("organization_id", membership.organization_id).order("due_at", {ascending: true}).limit(8),
    supabase.from("leads").select("id", {count: "exact", head: true}).eq("organization_id", membership.organization_id).neq("status", "won").neq("status", "lost"),
      supabase.from("tasks").select("id", {count: "exact", head: true}).is("completed_at", null).gte("due_at", todayStart.toISOString()).lt("due_at", tomorrowStart.toISOString()),
    isManager
      ? supabase.from("tasks").select("id", {count: "exact", head: true}).is("completed_at", null).lt("due_at", new Date().toISOString())
      : Promise.resolve({count: 0}),
    isManager
      ? supabase.from("tasks").select("id", {count: "exact", head: true}).not("completed_at", "is", null)
      : Promise.resolve({count: 0}),
    supabase.from("notifications").select("*").eq("organization_id", membership.organization_id).eq("recipient_id", user.id).is("read_at", null).order("created_at", {ascending: false}).limit(5),
  ]);

  const leads = (leadRows ?? []) as LeadRow[];
  const tasks = (taskRows ?? []) as TaskRow[];
  const notifications = (notificationRows ?? []) as NotificationRow[];
  const activeSalesIds = salesMembers.filter((person) => person.is_active).map((person) => person.sales_user_id);
  const {count: assignedSalesLeadCount} = isManager && activeSalesIds.length
    ? await supabase.from("leads").select("id", {count: "exact", head: true})
      .eq("organization_id", org.id)
      .eq("assignment_status", "assigned")
      .in("assigned_to", activeSalesIds)
    : {count: 0};
  const now = new Date().getTime();
  const todayLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {weekday: "long", day: "numeric", month: "long", timeZone: org.timezone}).format(new Date(now));
  const numberFormat = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US");
  const dateFormat = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: org.timezone});
  const statusText = (status: LeadRow["status"]) => t(status);
  return (
    <AppShell
      leadCount={openLeads ?? 0}
      locale={locale as "ar" | "en"}
      notifications={notifications}
      organization={org}
      page="overview"
      role={membership.role}
      todayTaskCount={todayTasks ?? 0}
      userEmail={user.email ?? ""}
    >
      <RealtimeRefresh organizationId={org.id} />
      {membership.role === "sales" ? <SalesToday
        currentTime={now}
        leads={leads}
        locale={locale as "ar" | "en"}
        organizationId={org.id}
        tasks={tasks}
        todayDate={todayDate}
        todayLabel={todayLabel}
        timezone={org.timezone}
      /> : <div className="dashboard-content">
          <div className="page-heading">
            <div><p className="eyebrow">{todayLabel}</p><h1>{t("overview")}</h1></div>
            <div className="page-heading-actions">
              {(membership.role === "owner" || membership.role === "manager") && <LeadImportDialog locale={locale as "ar" | "en"} organizationId={org.id} />}
              <Link className="primary-button compact-button touch-target" href={`/${locale}/dashboard/new-lead`}><Icon name="add" size={18} />{locale === "ar" ? "إضافة عميل" : "Add lead"}</Link>
            </div>
          </div>

          {firstParam(query.notice) === "duplicate" && <p className="form-alert" role="status">{t("duplicateLead")}</p>}
          {firstParam(query.notice) === "created" && <p className="form-success" role="status">{t("leadCreated")}</p>}
          {firstParam(query.notice) === "invite-accepted" && <p className="form-success" role="status">{locale === "ar" ? "انضممت إلى فريق المبيعات. هذه قائمة متابعات اليوم." : "You joined the sales team. Here is your Today list."}</p>}
          {firstParam(query.notice) === "workflow-activated" && <p className="form-success" role="status">{locale === "ar" ? "تم تفعيل التوزيع والمتابعة والتصعيد التلقائي." : "Automatic assignment, follow-up and escalation are active."}</p>}
          {firstParam(query.notice) === "workflow-error" && <p className="form-alert" role="alert">{locale === "ar" ? "تعذر تفعيل سير المتابعة. تحقق من إعدادات المؤسسة." : "Could not activate the default follow-up workflow. Check organization setup."}</p>}

          {isManager && <OnboardingChecklist
            hasActiveSalesperson={salesMembers.some((person) => person.is_active)}
            hasDistributedLead={Boolean(assignedSalesLeadCount)}
            hasPipeline={stages.length > 0}
            leads={leads}
            locale={locale as "ar" | "en"}
            organizationId={org.id}
            workflowActive={followUpWorkflowReady}
          />}

          {isManager && <ManagerDashboard
            currency={org.currency}
            endDate={endDate}
            impactSummary={impactSummary}
            isOwner={membership.role === "owner"}
            locale={locale as "ar" | "en"}
            metrics={managerMetrics}
            metricsError={managerMetricsError || Boolean(salesMembersResponse?.error || stagesResponse?.error || workflowRulesResponse?.error)}
            salesMembers={salesMembers}
            selectedSalespersonId={selectedSalespersonId}
            selectedStageId={selectedStageId}
            stages={stages}
            startDate={startDate}
            timezone={org.timezone}
          />}

          <div className="metrics-grid">
            <KpiCard detail={locale === "ar" ? "ضمن نطاق المؤسسة" : "Across your organization"} icon="leads" label={t("openLeads")} locale={locale as "ar" | "en"} value={openLeads ?? 0} />
            <KpiCard detail={locale === "ar" ? "حسب توقيت المؤسسة" : "In organization time"} icon="calendar" label={t("dueToday")} locale={locale as "ar" | "en"} value={todayTasks ?? 0} />
            <KpiCard detail={locale === "ar" ? "تحتاج انتباهًا" : "Need attention"} icon="overdue" label={t("overdue")} locale={locale as "ar" | "en"} tone="warning" value={overdueTasks ?? 0} />
            <KpiCard detail={locale === "ar" ? "كل المتابعات المكتملة" : "All completed follow-ups"} icon="success" label={t("completed")} locale={locale as "ar" | "en"} tone="success" value={doneTasks ?? 0} />
          </div>

          <section className="data-section" id="leads">
            <div className="section-heading"><div><h2>{t("recentLeads")}</h2><p>{locale === "ar" ? "آخر العملاء الذين وصلوا إلى فريقك" : "The latest leads routed to your team"}</p></div><Link className="text-link" href={`/${locale}/dashboard/new-lead`}>{locale === "ar" ? "إضافة عميل" : "Add lead"}<Icon name="add" size={16} /></Link></div>
            <Table className="data-table"><thead><tr><th>{locale === "ar" ? "العميل" : "Lead"}</th><th>{locale === "ar" ? "الاهتمام" : "Interest"}</th><th>{t("assignee")}</th><th>{t("status")}</th><th>{locale === "ar" ? "تاريخ الإضافة" : "Added"}</th></tr></thead><tbody>
              {leads.map((lead) => <TableRow key={lead.id} motionId={lead.id}><td><strong>{lead.full_name}</strong><span className="table-secondary" dir="ltr">{lead.phone}</span></td><td>{lead.property_interest || "—"}</td><td>{lead.assigned_to === user.id ? (locale === "ar" ? "أنت" : "You") : (locale === "ar" ? "عضو الفريق" : "Team member")}</td><td><Badge className={`status-${lead.status}`} tone={lead.status === "won" ? "success" : lead.status === "lost" ? "danger" : lead.status === "new" ? "brand" : "neutral"}>{statusText(lead.status)}</Badge></td><td>{dateFormat.format(new Date(lead.created_at))}</td></TableRow>)}
              {leads.length === 0 && <tr><td className="data-empty-cell" colSpan={5}><EmptyState action={<Link className="primary-button compact-button" href={`/${locale}/dashboard/new-lead`}><Icon aria-hidden="true" name="add" size={16} />{t("addFirstLead")}</Link>} compact description={t("emptyLeadsDescription")} illustration="empty-leads" title={t("emptyLeadsTitle")} /></td></tr>}
            </tbody></Table>
          </section>

          <div className="lower-grid">
            <section className="data-section task-section" id="tasks">
              <div className="section-heading"><div><h2>{t("tasks")}</h2><p>{locale === "ar" ? "المواعيد القادمة والتصعيدات" : "Upcoming follow-ups and escalations"}</p></div><span className="section-total">{numberFormat.format(tasks.length)}</span></div>
              <div className="task-list">
                {tasks.map((task) => {
                  const overdue = !task.completed_at && new Date(task.due_at).getTime() < now;
                  return <article className={`task-row ${overdue ? "task-late" : ""}`} key={task.id}><span className={`task-status ${task.completed_at ? "task-done" : overdue ? "task-late" : ""}`}><Icon name={task.completed_at ? "success" : overdue ? "overdue" : "clock"} size={18} /></span><div className="task-copy"><strong>{locale === "ar" ? task.title_ar : task.title}</strong><span>{dateFormat.format(new Date(task.due_at))}{task.escalated_at ? ` · ${locale === "ar" ? "تم التصعيد" : "Escalated"}` : ""}</span></div>{!task.completed_at && <form action={completeTask.bind(null, org.id, task.id, locale as "ar" | "en")}><button className="task-complete touch-target" type="submit" aria-label={locale === "ar" ? "إكمال المتابعة" : "Complete follow-up"}><Icon name="check" size={18} /></button></form>}</article>;
                })}
                {tasks.length === 0 && <EmptyState compact description={t("emptyTasksDescription")} illustration="empty-tasks" title={t("emptyTasksTitle")} />}
              </div>
            </section>

            <section className="data-section pipeline-section" id="pipeline">
              <div className="section-heading"><div><h2>{t("pipeline")}</h2><p>{locale === "ar" ? "توزيع العملاء حسب المرحلة" : "Leads by current stage"}</p></div></div>
              <div className="pipeline-list">
                {(["new", "contacted", "qualified", "won", "lost"] as const).map((status) => {
                  const count = leads.filter((lead) => lead.status === status).length;
                  const width = leads.length ? Math.max(count / leads.length * 100, count ? 8 : 0) : 0;
                  return <div className="pipeline-row" key={status}><div className="pipeline-label"><span>{t(status)}</span><strong>{numberFormat.format(count)}</strong></div><div className="pipeline-track"><span className={`pipeline-fill fill-${status}`} style={{width: `${width}%`}} /></div></div>;
                })}
              </div>
              <div className="pipeline-footnote"><span>{locale === "ar" ? "العملة" : "Currency"}</span><strong>{org.currency}</strong><span>{locale === "ar" ? "أيام العطلة" : "Weekend"}</span><strong>{org.weekend_days.map((day) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {weekday: "short"}).format(new Date(Date.UTC(2024, 0, 7 + day)))).join("، ")}</strong></div>
            </section>
          </div>
        </div>}
    </AppShell>
  );
}