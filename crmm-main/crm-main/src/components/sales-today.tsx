"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {Drawer} from "@/components/ui/drawer";
import {Icon} from "@/components/ui/icon";
import {MotionItem, useListTransition, useOptimisticMutation} from "@/components/ui/motion";
import {Tabs} from "@/components/ui/tabs";
import {Toast} from "@/components/ui/toast";
import {PushReminderButton} from "@/components/push-reminder-button";
import {Badge, EmptyState, StagePill} from "@/components/ui/primitives";
import {createClient} from "@/lib/supabase/client";
import {flushPendingMutations, queuePendingMutation, readPendingMutations, removePendingMutation} from "@/lib/offline-mutations";
import type {LeadRow, SalesOutcome, TaskRow} from "@/lib/supabase/database";

function successHaptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
}

function looksOffline(error: {message: string}) {
  return !navigator.onLine || /fetch|network|timeout/i.test(error.message);
}

function TaskRowItem({task, locale, timezone, currentTime, onMessage, onUndo}: {
  task: TaskRow;
  locale: "ar" | "en";
  timezone: string;
  currentTime: number;
  onMessage: (message: string, tone: "success" | "error" | "info", onUndo?: () => void) => void;
  onUndo: (task: TaskRow) => void;
}) {
  const t = useTranslations("dashboard");
  const {value: completed, pending, mutate} = useOptimisticMutation(Boolean(task.completed_at));
  const [collapsed, setCollapsed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const dueLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone,
  }).format(new Date(task.due_at));
  const overdue = !completed && new Date(task.due_at).getTime() < currentTime;

  async function complete() {
    const client = createClient();
    let queued = false;
    const queueKey = `task:${task.organization_id}:${task.id}`;
    const result = await mutate(true, async () => {
      if (!client || !navigator.onLine) {
        if (!queuePendingMutation({key: queueKey, table: "tasks", organizationId: task.organization_id, id: task.id, changes: {completed_at: new Date().toISOString()}})) throw new Error("offline-storage-unavailable");
        queued = true;
        return true;
      }
      const {error} = await client.from("tasks").update({completed_at: new Date().toISOString()}).eq("id", task.id).eq("organization_id", task.organization_id);
      if (error) {
        if (!looksOffline(error) || !queuePendingMutation({key: queueKey, table: "tasks", organizationId: task.organization_id, id: task.id, changes: {completed_at: new Date().toISOString()}})) throw error;
        queued = true;
        return true;
      }
      removePendingMutation(queueKey);
      return true;
    });
    if (result.ok) {
      setCompleting(true);
      window.setTimeout(() => setCollapsed(true), 320);
      if (queued) onMessage(t("savedOffline"), "info", () => onUndo(task));
      else {
        successHaptic();
        onMessage(t("taskLogged"), "success", () => onUndo(task));
      }
    }
    else onMessage(t("taskSaveError"), "error");
  }

  if (collapsed) return null;
  return <MotionItem className={`today-task-row${overdue ? " today-task-overdue" : ""}${completing ? " today-task-completing" : ""}`} name={`task-${task.id}`}>
    <span className="today-task-state">{completed ? <Icon className="check-draw" name="check" size={20} /> : <Icon name={overdue ? "overdue" : "clock"} size={20} />}</span>
    <span className="today-task-copy"><strong>{locale === "ar" ? task.title_ar : task.title}</strong><small>{dueLabel}{task.escalated_at ? ` · ${t("escalatedStatus")}` : ""}</small></span>
    {!completed && <button aria-label={t("completeTaskAction")} className="task-complete touch-target" disabled={pending} onClick={complete} type="button"><Icon name="check" size={19} /></button>}
  </MotionItem>;
}

function WhatsAppLeadRow({lead, locale, organizationId, onMessage, onOpenDetails}: {
  lead: LeadRow;
  locale: "ar" | "en";
  organizationId: string;
  onMessage: (message: string, tone: "success" | "error" | "info", onUndo?: () => void) => void;
  onOpenDetails: (lead: LeadRow) => void;
}) {
  const t = useTranslations("dashboard");
  const {value: status, pending, mutate} = useOptimisticMutation(lead.status);
  const [lastOutcome, setLastOutcome] = useState<SalesOutcome | null>(null);
  const visibleName = lead.full_name;
  const waPhone = lead.phone.replace(/\D/g, "");
  const callPhone = lead.phone.replace(/[^\d+]/g, "");
  const waMessage = locale === "ar"
    ? `مرحبًا ${visibleName}، أتابع معك بخصوص اهتمامك العقاري. متى يناسبك أن نتواصل؟`
    : `Hello ${visibleName}, I’m following up on your property enquiry. When would be a good time to talk?`;
  const whatsappUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`;

  async function logOutcome(outcome: SalesOutcome) {
    const client = createClient();
    const interactionId = crypto.randomUUID();
    let queued = false;
    const queueKey = `interaction:${organizationId}:${interactionId}`;
    const nextStatus = outcome === "not_interested" ? "lost" : outcome === "no_answer" ? "contacted" : "qualified";
    const result = await mutate(nextStatus, async () => {
      const mutation = {
        key: queueKey,
        table: "lead_interactions" as const,
        organizationId,
        id: lead.id,
        changes: {interactionId, outcome},
      };
      if (!client || !navigator.onLine) {
        if (!queuePendingMutation(mutation)) throw new Error("offline-storage-unavailable");
        queued = true;
        return nextStatus;
      }
      const {error} = await client.rpc("log_sales_outcome", {
        target_organization_id: organizationId,
        target_lead_id: lead.id,
        target_interaction_id: interactionId,
        target_outcome: outcome,
      });
      if (error) {
        if (!looksOffline(error) || !queuePendingMutation(mutation)) throw error;
        queued = true;
        return nextStatus;
      }
      removePendingMutation(queueKey);
      return nextStatus;
    });
    if (result.ok) {
      setLastOutcome(outcome);
      if (!queued) successHaptic();
    }
    onMessage(result.ok ? (queued ? t("savedOffline") : t("outcomeSaved")) : t("outcomeSaveError"), result.ok ? (queued ? "info" : "success") : "error");
  }

  return <MotionItem className="whatsapp-lead-row" name={`lead-${lead.id}`}>
    <div className="whatsapp-lead-main">
      <button className="lead-detail-trigger" onClick={() => onOpenDetails(lead)} type="button"><strong>{visibleName}</strong><Icon name="arrow-end" size={16} /></button>
      <span className="whatsapp-lead-meta" dir="ltr">{lead.phone}{lead.property_interest ? ` · ${lead.property_interest}` : ""}</span>
    </div>
    <div className="whatsapp-lead-actions">
      <a aria-label={t("callLead", {name: visibleName})} className="secondary-button compact-button phone-action touch-target" href={`tel:${callPhone}`}>
        <Icon name="call" size={18} />{t("callLeadAction")}
      </a>
      <a className="secondary-button compact-button whatsapp-action touch-target" href={whatsappUrl} rel="noreferrer" target="_blank">
        <Icon name="send-message" size={18} />{t("openWhatsapp")}
      </a>
    </div>
    <div aria-label={t("selectOutcome")} className="sales-outcomes" role="group">
      {(["no_answer", "interested", "visit_booked", "not_interested"] as const).map((outcome) => <button aria-pressed={lastOutcome === outcome} className={`sales-outcome-button${lastOutcome === outcome ? " sales-outcome-selected" : ""}`} disabled={pending} key={outcome} onClick={() => void logOutcome(outcome)} type="button">{t(outcome)}</button>)}
      {!lastOutcome && <span className="sales-current-status"><StagePill stage={status === "won" ? "deal" : status === "lost" ? "lost" : "visit"} label={t(status)} /></span>}
    </div>
  </MotionItem>;
}

export function SalesToday({
  locale,
  timezone,
  organizationId,
  leads,
  tasks,
  currentTime,
  todayDate,
  todayLabel,
}: {
  locale: "ar" | "en";
  timezone: string;
  organizationId: string;
  leads: LeadRow[];
  tasks: TaskRow[];
  currentTime: number;
  todayDate: string;
  todayLabel: string;
}) {
  const t = useTranslations("dashboard");
  const [tab, setTab] = useState("today");
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null);
  const [toast, setToast] = useState<{message: string; tone: "success" | "error" | "info"; onUndo?: () => void} | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "queued" | "error">("idle");
  const isArriving = useListTransition(leads);
  const activeTasks = tasks.filter((task) => !task.completed_at && (new Date(task.due_at).getTime() < currentTime || new Intl.DateTimeFormat("en-CA", {timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date(task.due_at)) === todayDate)).sort((first, second) => Date.parse(first.due_at) - Date.parse(second.due_at));
  const taskUrgency = new Map<string, number>();
  for (const task of activeTasks) {
    const dueAt = Date.parse(task.due_at);
    taskUrgency.set(task.lead_id, Math.min(taskUrgency.get(task.lead_id) ?? Number.POSITIVE_INFINITY, dueAt));
  }
  const todayLeads = leads.filter((lead) => lead.status !== "won" && lead.status !== "lost" && (taskUrgency.has(lead.id) || lead.status === "new"));
  const todayItems = [
    ...activeTasks.map((task) => ({kind: "task" as const, urgency: Date.parse(task.due_at), task})),
    ...todayLeads.map((lead) => ({kind: "lead" as const, urgency: taskUrgency.get(lead.id) ?? Date.parse(lead.created_at), lead})),
  ].sort((first, second) => first.urgency - second.urgency);
  const queueLeads = leads.filter((lead) => lead.status === "new").sort((first, second) => (taskUrgency.get(first.id) ?? Number.POSITIVE_INFINITY) - (taskUrgency.get(second.id) ?? Number.POSITIVE_INFINITY) || Date.parse(first.created_at) - Date.parse(second.created_at));
  const notify = (message: string, tone: "success" | "error" | "info", onUndo?: () => void) => setToast({message, tone, onUndo});

  useEffect(() => {
    let active = true;
    const syncPending = async () => {
      const pending = readPendingMutations(organizationId);
      if (!pending.length) {
        if (active) setSyncStatus("idle");
        return;
      }
      const client = createClient();
      if (!navigator.onLine || !client) {
        if (active) setSyncStatus("queued");
        return;
      }
      if (active) setSyncStatus("syncing");
      const result = await flushPendingMutations(client, organizationId);
      if (active) setSyncStatus(result.failed ? "error" : result.remaining ? "queued" : "idle");
    };
    const initial = window.setTimeout(() => { void syncPending(); }, 0);
    window.addEventListener("online", syncPending);
    window.addEventListener("masar:pending-mutation", syncPending);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.removeEventListener("online", syncPending);
      window.removeEventListener("masar:pending-mutation", syncPending);
    };
  }, [organizationId]);

  async function undoCompletedTask(task: TaskRow) {
    const client = createClient();
    if (!client) {
      notify(t("syncUnavailable"), "error");
      return;
    }
    const {error} = await client.from("tasks").update({completed_at: null}).eq("id", task.id).eq("organization_id", organizationId);
    notify(error ? t("taskUndoError") : t("taskUndoSuccess"), error ? "error" : "success");
  }

  return <>
    <div className="dashboard-content sales-today-content">
      <div className="page-heading sales-today-heading">
        <div><p className="eyebrow">{todayLabel}</p><h1>{t("today")}</h1></div>
        <div className="sales-today-actions"><PushReminderButton organizationId={organizationId} /><Link className="primary-button compact-button touch-target" href={`/${locale}/dashboard/new-lead`}><Icon name="add" size={18} />{t("addLead")}</Link></div>
      </div>
      <Tabs direction={locale === "ar" ? "rtl" : "ltr"} label={t("salesTodayTabs")} items={[
        {id: "today", label: t("today"), icon: "calendar"},
        {id: "whatsapp", label: t("whatsappQueue"), icon: "whatsapp-queue"},
      ]} onChange={setTab} value={tab} />
      {syncStatus !== "idle" && <p aria-live="polite" className={`sync-indicator sync-${syncStatus}`} role="status"><Icon name={syncStatus === "error" ? "warning" : "info"} size={16} />{syncStatus === "syncing" ? t("syncingPending") : syncStatus === "error" ? t("syncFailed") : t("queuedPending", {count: readPendingMutations(organizationId).length})}</p>}

      {tab === "today" ? <section aria-label={t("todayTasksHeading")} className="sales-today-section">
        <div className="section-heading"><div><h2>{t("todayTasksHeading")}</h2><p>{t("todayTasksDescription")}</p></div><span className="section-total">{todayItems.length}</span></div>
        <div className="today-task-list">
          {todayItems.map((item) => item.kind === "task"
            ? <TaskRowItem currentTime={currentTime} key={`task-${item.task.id}`} locale={locale} onMessage={notify} onUndo={undoCompletedTask} task={item.task} timezone={timezone} />
            : <WhatsAppLeadRow key={`lead-${item.lead.id}`} lead={item.lead} locale={locale} onMessage={notify} onOpenDetails={setSelectedLead} organizationId={organizationId} />)}
          {!todayItems.length && <EmptyState action={<button className="secondary-button compact-button" onClick={() => setTab("whatsapp")} type="button"><Icon name="whatsapp-queue" size={18} />{t("openWhatsappQueue")}</button>} description={t("todayEmptyDescription")} illustration="empty-tasks" title={t("todayEmptyTitle")} />}
        </div>
      </section> : <section aria-label={t("whatsappQueue")} className="sales-today-section" id="whatsapp-queue">
        <div className="section-heading"><div><h2>{t("whatsappQueue")}</h2><p>{t("whatsappQueueDescription")}</p></div><span className="section-total">{queueLeads.length}</span></div>
        <div className="whatsapp-lead-list">
          {queueLeads.map((lead) => <div className={isArriving(lead.id) ? "list-row-arriving" : undefined} key={lead.id}>
            <WhatsAppLeadRow lead={lead} locale={locale} onMessage={notify} onOpenDetails={setSelectedLead} organizationId={organizationId} />
          </div>)}
          {!queueLeads.length && <EmptyState action={<Link className="primary-button compact-button" href={`/${locale}/dashboard/new-lead`}><Icon name="add" size={18} />{t("addLead")}</Link>} description={t("whatsappQueueEmptyDescription")} illustration="empty-queue" title={t("whatsappQueueEmptyTitle")} />}
        </div>
      </section>}
    </div>
    <Drawer closeLabel={t("closeDialog")} onOpenChange={(open) => { if (!open) setSelectedLead(null); }} open={Boolean(selectedLead)} title={selectedLead?.full_name ?? t("leadDetails")}>
      {selectedLead && <div className="lead-detail-drawer">
        <Badge tone={selectedLead.status === "won" ? "success" : selectedLead.status === "lost" ? "danger" : "neutral"}>{t(selectedLead.status)}</Badge>
        <p className="lead-detail-phone" dir="ltr">{selectedLead.phone}</p>
        {selectedLead.property_interest && <p>{selectedLead.property_interest}</p>}
        {selectedLead.source && <p><span>{t("leadSource")}</span><strong>{selectedLead.source}</strong></p>}
        <p className="lead-detail-note">{t("whatsappOutcomeHint")}</p>
      </div>}
    </Drawer>
    {toast && <Toast dismissLabel={t("dismissToast")} message={toast.message} onClose={() => setToast(null)} onUndo={toast.onUndo} open tone={toast.tone} undoLabel={toast.onUndo ? t("undo") : undefined} />}
  </>;
}
