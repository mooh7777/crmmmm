import Link from "next/link";
import {getTranslations} from "next-intl/server";
import {EmptyState} from "@/components/ui/primitives";
import {Icon} from "@/components/ui/icon";
import {CountUpNumber} from "@/components/ui/motion";
import type {ImpactDashboardSummary, ManagerDashboardMetrics} from "@/lib/supabase/database";

type ManagerDashboardProps = {
  locale: "ar" | "en";
  currency: string;
  timezone: string;
  metrics: ManagerDashboardMetrics | null;
  impactSummary: ImpactDashboardSummary | null;
  isOwner: boolean;
  metricsError: boolean;
  salesMembers: Array<{sales_user_id: string; sales_email: string; is_active: boolean}>;
  stages: Array<{id: string; name: string; name_ar: string}>;
  startDate: string;
  endDate: string;
  selectedStageId: string;
  selectedSalespersonId: string;
};

export async function ManagerDashboard({
  locale,
  currency,
  timezone,
  metrics,
  impactSummary,
  isOwner,
  metricsError,
  salesMembers,
  stages,
  startDate,
  endDate,
  selectedStageId,
  selectedSalespersonId,
}: ManagerDashboardProps) {
  const t = await getTranslations("dashboard");
  const safeStartDate = startDate || "";
  const safeEndDate = endDate || "";
  const safeSelectedSalespersonId = selectedSalespersonId || "";
  const safeSelectedStageId = selectedStageId || "";
  const numberFormat = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {maximumFractionDigits: 1});
  const dateFormat = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {day: "numeric", month: "short", timeZone: "UTC"});
  const responseTrend = metrics?.response_trend ?? [];
  const hasResponses = responseTrend.some((point) => point.responses > 0);
  const maxResponse = Math.max(1, ...responseTrend.map((point) => point.average_minutes ?? 0));
  const formatMinutes = (minutes: number | null) => {
    if (minutes === null) return "—";
    if (minutes < 60) return `${numberFormat.format(minutes)} ${t("minutesShort")}`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${numberFormat.format(hours)} ${t("hoursShort")}${remainingMinutes ? ` ${numberFormat.format(remainingMinutes)} ${t("minutesShort")}` : ""}`;
  };
  const formatPercent = (value: number | null) => value === null ? "—" : `${numberFormat.format(value)}%`;
  const overdueSalespeople = metrics?.overdue_tasks_by_salesperson.filter((person) => person.task_count > 0) ?? [];
  const funnelTotal = metrics?.funnel.reduce((total, stage) => total + stage.lead_count, 0) ?? 0;
  const funnelMaximum = Math.max(1, ...(metrics?.funnel.map((stage) => stage.lead_count) ?? []));

  return (
    <section aria-labelledby="manager-dashboard-title" className="manager-dashboard">
      <div className="manager-dashboard-heading">
        <div><h2 id="manager-dashboard-title">{t("managerTitle")}</h2><p>{t("managerDescription")}</p></div>
      </div>
      <form action={`/${locale}/dashboard`} className="manager-filter-form" method="get">
        <label htmlFor="manager-from">{t("filterFrom")}<input id="manager-from" name="from" type="date" defaultValue={safeStartDate} max={safeEndDate} required /></label>
        <label htmlFor="manager-to">{t("filterTo")}<input id="manager-to" name="to" type="date" defaultValue={safeEndDate} min={safeStartDate} required /></label>
        <label htmlFor="manager-salesperson">{t("filterSalesperson")}<select id="manager-salesperson" name="salesperson" defaultValue={safeSelectedSalespersonId}><option value="">{t("allSalespeople")}</option>{salesMembers.map((member) => <option key={member.sales_user_id} value={member.sales_user_id}>{member.sales_email}</option>)}</select></label>
        <label htmlFor="manager-stage">{t("filterStage")}<select id="manager-stage" name="stage" defaultValue={safeSelectedStageId}><option value="">{t("allStages")}</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{locale === "ar" ? stage.name_ar : stage.name}</option>)}</select></label>
        <button className="primary-button compact-button manager-filter-submit" type="submit"><Icon name="filter" size={16} />{t("applyFilters")}</button>
      </form>

      {isOwner && impactSummary && <section aria-labelledby="impact-summary-title" className="impact-summary-section">
        <div className="impact-summary-heading"><div><h3 id="impact-summary-title">{t("impactReportTitle")}</h3><p>{t("impactReportDescription")}</p></div><span>{t("monthlyPeriod")}</span></div>
        <div className="impact-summary-topline">
          <div className="impact-saved-headline"><strong><CountUpNumber locale={locale} value={impactSummary.monthly_saved_leads} /></strong><span>{t("leadsSavedThisMonth")}</span></div>
          <div className="impact-revenue-headline"><span>{t("revenueProtectedEstimate")}</span><strong>{impactSummary.estimated_revenue_protected === null
            ? "—"
            : new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {style: "currency", currency, maximumFractionDigits: 0}).format(impactSummary.estimated_revenue_protected)}</strong>
            {impactSummary.average_deal_value === null && isOwner && <Link className="text-link" href={`/${locale}/settings`}>{t("completeImpactAssumptions")}</Link>}
          </div>
        </div>
        <div className="impact-rescue-breakdown">
          <span>{t("rescuedByReminders", {count: numberFormat.format(impactSummary.monthly_saved_by_reminder)})}</span>
          <span>{t("rescuedByEscalations", {count: numberFormat.format(impactSummary.monthly_saved_by_escalation)})}</span>
          {impactSummary.average_deal_value !== null && impactSummary.close_rate_percent !== null && <span>{t("revenueAssumptions", {dealValue: new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {maximumFractionDigits: 0}).format(impactSummary.average_deal_value), closeRate: numberFormat.format(impactSummary.close_rate_percent)})}</span>}
        </div>
        {impactSummary.baseline_ready && impactSummary.baseline ? <div className="impact-comparison">
          <div className="impact-comparison-row impact-comparison-header"><span /><strong>{t("baselineFirstWeek")}</strong><strong>{t("recentSevenDays")}</strong></div>
          <div className="impact-comparison-row"><span>{t("firstResponse")}</span><strong>{formatMinutes(impactSummary.baseline.average_first_response_minutes)}</strong><strong>{formatMinutes(impactSummary.recent.average_first_response_minutes)}</strong></div>
          <div className="impact-comparison-row"><span>{t("untouched24Hours")}</span><strong>{formatPercent(impactSummary.baseline.untouched_over_24h_percent)}</strong><strong>{formatPercent(impactSummary.recent.untouched_over_24h_percent)}</strong></div>
        </div> : <p className="impact-baseline-note">{t("baselineCollecting")}</p>}
        <p className="impact-estimate-note">{t("revenueEstimateDisclaimer")}</p>
      </section>}

      {metricsError && <p className="form-alert" role="alert">{t("metricsUnavailable")}</p>}
      {metrics && <div className="manager-insights-grid">
        <section className="data-section manager-panel response-panel">
          <div className="section-heading"><div><h3>{t("firstResponse")}</h3><p>{t("responseTrend")}</p></div><Icon name="clock" size={18} /></div>
          <strong className="manager-metric-value">{metrics.average_first_response_minutes === null ? "—" : formatMinutes(metrics.average_first_response_minutes)}</strong>
          {hasResponses ? <>
            <div aria-label={t("responseTrendChart")} className="response-trend-chart" role="img">
              {responseTrend.map((point) => {
                const height = point.responses ? Math.max(5, ((point.average_minutes ?? 0) / maxResponse) * 100) : 0;
                return <span aria-hidden="true" className="response-trend-bar" key={point.date} style={{height: `${height}%`}} title={`${dateFormat.format(new Date(`${point.date}T12:00:00Z`))}: ${formatMinutes(point.average_minutes)}`} />;
              })}
            </div>
            <div className="response-trend-range"><span>{responseTrend[0]?.date}</span><span>{responseTrend.at(-1)?.date}</span></div>
          </> : <EmptyState compact description={t("noResponseDataDescription")} illustration="empty-search" title={t("noResponseData")} />}
        </section>

        <section className="data-section manager-panel sla-panel">
          <div className="section-heading"><div><h3>{t("leadsPastSla")}</h3><p>{t("leadsPastSlaDescription")}</p></div><Icon name="overdue" size={18} /></div>
          {metrics.untouched_past_sla.count ? <>
            <strong className="manager-metric-value manager-warning-value">{numberFormat.format(metrics.untouched_past_sla.count)}</strong>
            <div className="manager-rows">{metrics.untouched_past_sla.leads.map((lead) => <div className="manager-row" key={lead.id}>
              <span><strong>{lead.full_name}</strong><small>{lead.salesperson_email ?? t("unassignedSalesperson")}</small></span>
              <time dateTime={lead.due_at}>{new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone}).format(new Date(lead.due_at))}</time>
            </div>)}</div>
          </> : <EmptyState compact description={t("noLeadsPastSlaDescription")} illustration="empty-leads" title={t("noLeadsPastSla")} />}
        </section>

        <section className="data-section manager-panel overdue-panel">
          <div className="section-heading"><div><h3>{t("overdueBySalesperson")}</h3><p>{t("overdueBySalespersonDescription")}</p></div><Icon name="team" size={18} /></div>
          {overdueSalespeople.length ? <div className="manager-rows">{overdueSalespeople.map((person) => <div className="manager-row" key={person.user_id}>
            <span><strong dir="ltr">{person.email}</strong></span>
            <strong className="manager-row-count">{numberFormat.format(person.task_count)}</strong>
          </div>)}</div> : <EmptyState compact description={t("noOverdueTasksDescription")} illustration="empty-tasks" title={t("noOverdueTasks")} />}
        </section>

        <section className="data-section manager-panel funnel-panel">
          <div className="section-heading"><div><h3>{t("funnelByStage")}</h3><p>{t("funnelDescription")}</p></div><Icon name="reports" size={18} /></div>
          {funnelTotal ? <div className="manager-funnel">{metrics.funnel.map((stage) => <div className="pipeline-row" key={stage.stage_id}>
            <div className="pipeline-label"><span>{locale === "ar" ? stage.name_ar : stage.name}</span><strong>{numberFormat.format(stage.lead_count)}</strong></div>
            <div className="pipeline-track"><span className="pipeline-fill" style={{width: `${stage.lead_count ? Math.max(5, stage.lead_count / funnelMaximum * 100) : 0}%`}} /></div>
          </div>)}</div> : <EmptyState compact description={t("noFunnelLeadsDescription")} illustration="empty-leads" title={t("noFunnelLeads")} />}
        </section>
      </div>}
    </section>
  );
}