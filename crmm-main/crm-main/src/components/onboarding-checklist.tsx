"use client";

import Link from "next/link";
import {useState} from "react";
import {LeadImportDialog} from "@/components/lead-import-dialog";
import {Icon} from "@/components/ui/icon";
import {activateDefaultFollowUp, createSalesInvite} from "@/app/[locale]/actions";
import type {LeadRow} from "@/lib/supabase/database";

type OnboardingChecklistProps = {
  locale: "ar" | "en";
  organizationId: string;
  hasPipeline: boolean;
  workflowActive: boolean;
  hasActiveSalesperson: boolean;
  leads: LeadRow[];
  hasDistributedLead: boolean;
};

export function OnboardingChecklist({
  locale,
  organizationId,
  hasPipeline,
  workflowActive,
  hasActiveSalesperson,
  leads,
  hasDistributedLead,
}: OnboardingChecklistProps) {
  const [inviteUrl, setInviteUrl] = useState("");
  const [invitePending, setInvitePending] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = (arabic: string, english: string) => locale === "ar" ? arabic : english;
  const steps = [
    {id: "workflow", complete: hasPipeline && workflowActive, title: text("المسار العقاري والمتابعة جاهزان", "Real-estate pipeline and follow-up are ready"), detail: text("مراحل جديد، تم التواصل، مؤهل، تم البيع، ومفقود مع متابعة تلقائية خلال ساعة.", "New, Contacted, Qualified, Won and Lost, with an automatic one-hour follow-up." )},
    {id: "team", complete: hasActiveSalesperson, title: text("أضف مسؤول مبيعات", "Invite a salesperson"), detail: text("شارك رابط الدعوة؛ سيصل زميلك مباشرة إلى شاشة متابعات اليوم.", "Share an invite link. Your teammate lands directly on Today." )},
    {id: "lead", complete: leads.length > 0, title: text("أدخل أول عميل", "Bring in your first lead"), detail: text("استورد ملف CSV مع مطابقة ذكية للأعمدة أو أضف عميلا يدويا.", "Import a CSV with smart column matching, or add one lead manually." )},
    {id: "assigned", complete: hasDistributedLead, title: text("تأكد من توزيع أول عميل", "Confirm the first lead is assigned"), detail: text("بعد انضمام مسؤول المبيعات، يوزّع مسار العملاء المنتظرين تلقائيا.", "Once sales joins, Masar automatically assigns pending leads." )},
  ];
  const completedCount = steps.filter((step) => step.complete).length;
  const progress = Math.round(completedCount / steps.length * 100);

  async function generateInvite() {
    setInvitePending(true);
    setInviteError(false);
    setCopied(false);
    try {
      const result = await createSalesInvite(organizationId, locale);
      if (result.error || !result.url) {
        setInviteError(true);
        return;
      }
      setInviteUrl(result.url);
    } catch {
      setInviteError(true);
    } finally {
      setInvitePending(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return <section aria-labelledby="onboarding-checklist-title" className="onboarding-checklist">
    <header className="onboarding-checklist-header">
      <div>
        <p className="eyebrow">{text("خطوات البداية", "GET STARTED")}</p>
        <h2 id="onboarding-checklist-title">{text("جهّز فريقك للانطلاق", "Get your team ready")}</h2>
      </div>
      <span className="onboarding-progress-count">{new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(completedCount)} / {steps.length}</span>
    </header>
    <div aria-label={text("تقدم الإعداد", "Setup progress")} className="onboarding-progress-track" role="img">
      <span style={{width: `${progress}%`}} />
    </div>
    <ol className="onboarding-steps">
      {steps.map((step) => <li className={`onboarding-step${step.complete ? " onboarding-step-complete" : ""}`} key={step.id}>
        <span aria-hidden="true" className="onboarding-step-mark"><Icon name={step.complete ? "check" : step.id === "workflow" ? "settings" : step.id === "team" ? "team" : step.id === "lead" ? "import" : "assign"} size={19} /></span>
        <div className="onboarding-step-copy"><strong>{step.title}</strong><span>{step.detail}</span></div>
        <div className="onboarding-step-action">
          {step.id === "workflow" && (step.complete
            ? <span className="onboarding-done-label">{text("مفعّل", "Active")}</span>
            : !workflowActive
              ? <form action={activateDefaultFollowUp.bind(null, organizationId, locale)}><button className="primary-button compact-button" type="submit"><Icon name="success" size={16} />{text("تفعيل سير المتابعة", "Activate follow-up")}</button></form>
              : <Link className="text-link" href={`/${locale}/settings`}>{text("راجع الإعدادات", "Review settings")}</Link>)}
          {step.id === "team" && <button className="secondary-button compact-button" disabled={invitePending} onClick={generateInvite} type="button"><Icon name="link" size={16} />{invitePending ? text("جارٍ الإنشاء…", "Creating…") : hasActiveSalesperson ? text("دعوة زميل آخر", "Invite another") : text("إنشاء رابط دعوة", "Create invite link")}</button>}
          {step.id === "lead" && !step.complete && <div className="onboarding-lead-actions"><LeadImportDialog locale={locale} organizationId={organizationId} /><Link className="text-link" href={`/${locale}/dashboard/new-lead`}>{text("إضافة يدوية", "Add manually")}</Link></div>}
          {step.id === "lead" && step.complete && <span className="onboarding-done-label">{text("تم الإدخال", "Added")}</span>}
          {step.id === "assigned" && (step.complete
            ? <span className="onboarding-done-label">{text("موزع", "Assigned")}</span>
            : <span className="onboarding-step-hint">{text("بانتظار عميل ومسؤول مبيعات", "Waiting for a lead and salesperson")}</span>)}
          {step.id === "team" && step.complete && <span className="onboarding-done-label">{text("انضم للفريق", "Joined")}</span>}
        </div>
      </li>)}
    </ol>
    {inviteUrl && <div className="onboarding-invite-link">
      <label htmlFor="sales-invite-url">{text("رابط الدعوة · صالح لمدة 7 أيام", "Invite link · valid for 7 days")}</label>
      <div><input dir="ltr" id="sales-invite-url" readOnly value={inviteUrl} /><button aria-label={text("نسخ رابط الدعوة", "Copy invite link")} className="icon-button touch-target" onClick={copyInvite} title={text("نسخ رابط الدعوة", "Copy invite link")} type="button"><Icon name={copied ? "check" : "copy"} size={18} /></button></div>
      <p aria-live="polite">{inviteError ? text("تعذر إنشاء الرابط. حاول مرة أخرى.", "Could not create the invite. Try again.") : copied ? text("تم نسخ الرابط", "Invite link copied") : text("أرسل الرابط لمسؤول المبيعات ليُنشئ حسابه ويفتح شاشة اليوم.", "Send this to your salesperson so they can join and open Today.")}</p>
    </div>}
    {inviteError && !inviteUrl && <p className="form-alert" role="alert">{text("تعذر إنشاء رابط الدعوة. تحقق من صلاحياتك وحاول مجددا.", "Could not create the invite link. Check your permissions and retry.")}</p>}
  </section>;
}