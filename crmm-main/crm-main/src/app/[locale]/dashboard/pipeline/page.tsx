import Link from "next/link";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {AppShell} from "@/components/app-shell";
import {Badge, EmptyState} from "@/components/ui/primitives";
import {Icon} from "@/components/ui/icon";
import {createClient} from "@/lib/supabase/server";
import type {LeadRow, OrganizationRow, PipelineStageRow} from "@/lib/supabase/database";

export default async function PipelinePage({params}: {params: Promise<{locale: string}>}) {
  const [{locale}, t, supabase] = await Promise.all([
    params,
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
  if (membership.role === "sales") redirect(`/${locale}/dashboard`);

  const [{data: organizationData}, {data: stageRows}, {data: leadRows, count}] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
    supabase.from("pipeline_stages").select("*").eq("organization_id", membership.organization_id).order("position"),
    supabase.from("leads").select("*", {count: "exact"}).eq("organization_id", membership.organization_id).order("created_at", {ascending: false}).limit(250),
  ]);
  const organization = organizationData as OrganizationRow | null;
  if (!organization) redirect(`/${locale}/onboarding`);

  const stages = (stageRows ?? []) as PipelineStageRow[];
  const leads = (leadRows ?? []) as LeadRow[];
  const numberFormat = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US");
  const dateFormat = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {day: "numeric", month: "short"});
  const statusTone = (status: LeadRow["status"]) => status === "won" ? "success" : status === "lost" ? "danger" : status === "new" ? "brand" : "neutral";

  return (
    <AppShell leadCount={count ?? leads.length} locale={locale as "ar" | "en"} organization={organization} page="pipeline" role={membership.role} userEmail={user.email ?? ""}>
      <div className="dashboard-content pipeline-page-content">
        <div className="page-heading">
          <div><p className="eyebrow">{locale === "ar" ? "نظرة كاملة على رحلة العملاء" : "A CLEAR VIEW OF EVERY DEAL"}</p><h1>{t("pipeline")}</h1></div>
          <Link className="primary-button compact-button touch-target" href={`/${locale}/dashboard/new-lead`}><Icon name="add" size={18} />{locale === "ar" ? "إضافة عميل" : "Add lead"}</Link>
        </div>

        {!leads.length
          ? <EmptyState action={<Link className="primary-button compact-button" href={`/${locale}/dashboard/new-lead`}><Icon name="add" size={17} />{t("addFirstLead")}</Link>} description={locale === "ar" ? "أضف أول عميل أو استورد ملفا لترى حركة العملاء بين المراحل." : "Add a lead or import a file to see work move through your stages."} illustration="empty-leads" title={locale === "ar" ? "مسار المبيعات جاهز" : "Your pipeline is ready"} />
          : <div aria-label={t("pipeline")} className="pipeline-board">
            {stages.map((stage) => {
              const stageLeads = leads.filter((lead) => lead.stage_id === stage.id);
              return <section aria-labelledby={`pipeline-stage-${stage.id}`} className="pipeline-lane" key={stage.id}>
                <header className="pipeline-lane-header">
                  <h2 id={`pipeline-stage-${stage.id}`}>{locale === "ar" ? stage.name_ar : stage.name}</h2>
                  <span>{numberFormat.format(stageLeads.length)}</span>
                </header>
                <div className="pipeline-lane-leads">
                  {stageLeads.map((lead) => <article className="pipeline-lead-card" key={lead.id}>
                    <div className="pipeline-lead-card-top"><Badge tone={statusTone(lead.status)}>{t(lead.status)}</Badge><time dateTime={lead.created_at}>{dateFormat.format(new Date(lead.created_at))}</time></div>
                    <strong>{lead.full_name}</strong>
                    {lead.property_interest && <span className="pipeline-lead-interest">{lead.property_interest}</span>}
                    <div className="pipeline-lead-card-bottom"><span dir="ltr">{lead.phone}</span><a aria-label={`${locale === "ar" ? "اتصال بـ" : "Call "}${lead.full_name}`} className="pipeline-call-button touch-target" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}><Icon name="call" size={17} /></a></div>
                  </article>)}
                  {!stageLeads.length && <p className="pipeline-lane-empty">{locale === "ar" ? "لا يوجد عملاء في هذه المرحلة" : "No leads in this stage"}</p>}
                </div>
              </section>;
            })}
          </div>}
      </div>
    </AppShell>
  );
}