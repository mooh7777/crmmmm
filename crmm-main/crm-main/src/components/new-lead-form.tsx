"use client";

import {useState, useTransition, type FormEvent} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";
import {createLead} from "@/app/[locale]/actions";
import {Icon} from "@/components/ui/icon";
import {useDelayedPending} from "@/components/ui/motion";
import {Input, Select} from "@/components/ui/primitives";
import type {OrganizationRow} from "@/lib/supabase/database";

function asciiDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String.fromCharCode(code >= 0x6f0 ? code - 0x6f0 + 48 : code - 0x660 + 48);
  });
}

function groupPhone(value: string, timezone: OrganizationRow["timezone"]) {
  const normalized = asciiDigits(value).replace(/[^0-9+]/g, "").replace(/(?!^)\+/g, "");
  if (!normalized) return "";
  const digits = normalized.replace(/\D/g, "");
  if (normalized.startsWith("+966") || (timezone === "Asia/Riyadh" && digits.startsWith("966"))) {
    const national = digits.slice(3);
    return `+966 ${national.slice(0, 2)}${national.length > 2 ? ` ${national.slice(2, 5)}` : ""}${national.length > 5 ? ` ${national.slice(5, 9)}` : ""}`.trim();
  }
  if (normalized.startsWith("+20") || (timezone === "Africa/Cairo" && digits.startsWith("20"))) {
    const national = digits.slice(2);
    return `+20 ${national.slice(0, 2)}${national.length > 2 ? ` ${national.slice(2, 6)}` : ""}${national.length > 6 ? ` ${national.slice(6, 10)}` : ""}`.trim();
  }
  if (digits.startsWith("0") && digits.length > 4) {
    return `${digits.slice(0, 3)} ${digits.slice(3, timezone === "Asia/Riyadh" ? 6 : 7)} ${digits.slice(timezone === "Asia/Riyadh" ? 6 : 7, 12)}`.trim();
  }
  return normalized;
}

export function NewLeadForm({
  organizationId,
  locale,
  timezone,
}: {
  organizationId: string;
  locale: "ar" | "en";
  timezone: OrganizationRow["timezone"];
}) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const showPending = useDelayedPending(pending);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [propertyInterest, setPropertyInterest] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{fullName?: string; phone?: string; email?: string}>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createLead(organizationId, locale, formData);
      if (result.success) {
        router.push(`/${locale}/dashboard?notice=${result.success}`);
        router.refresh();
        return;
      }
      setFieldErrors(result.fieldErrors);
      setFormError(result.error);
    });
  }

  return <form className="settings-form lead-form" noValidate onSubmit={submit}>
    {formError && <p className="form-alert" role="alert">{formError === "auth" ? t("leadFormAuthError") : t("leadFormError")}</p>}
    <label htmlFor="full-name">{t("leadName")}</label>
    <Input aria-invalid={Boolean(fieldErrors.fullName)} autoComplete="name" id="full-name" maxLength={160} minLength={2} name="fullName" onChange={(event) => setFullName(event.currentTarget.value)} required value={fullName} />
    {fieldErrors.fullName && <span className="field-error" role="alert">{t("leadNameRequired")}</span>}
    <div className="field-grid">
      <div className="field-stack"><label htmlFor="phone">{t("phone")}</label><Input aria-describedby={fieldErrors.phone ? "phone-error" : undefined} aria-invalid={Boolean(fieldErrors.phone)} autoComplete="tel" dir="ltr" id="phone" inputMode="tel" name="phone" onChange={(event) => setPhone(groupPhone(event.currentTarget.value, timezone))} placeholder={timezone === "Africa/Cairo" ? "010 1234 5678" : "050 123 4567"} required type="tel" value={phone} />{fieldErrors.phone && <span className="field-error" id="phone-error" role="alert">{fieldErrors.phone === "invalid" ? t("invalidPhone") : t("phoneRequired")}</span>}</div>
      <div className="field-stack"><label htmlFor="email">{t("email")}</label><Input aria-invalid={Boolean(fieldErrors.email)} autoComplete="email" dir="ltr" id="email" name="email" onChange={(event) => setEmail(event.currentTarget.value)} type="email" value={email} /></div>
    </div>
    <div className="field-grid">
      <div className="field-stack"><label htmlFor="source">{t("leadSource")}</label><Select id="source" name="source" onChange={(event) => setSource(event.currentTarget.value)} value={source}><option value="">{t("selectSource")}</option><option value="website">{t("sourceWebsite")}</option><option value="referral">{t("sourceReferral")}</option><option value="campaign">{t("sourceCampaign")}</option><option value="walk-in">{t("sourceWalkIn")}</option></Select></div>
      <div className="field-stack"><label htmlFor="property-interest">{t("propertyInterest")}</label><Input id="property-interest" maxLength={160} name="propertyInterest" onChange={(event) => setPropertyInterest(event.currentTarget.value)} value={propertyInterest} /></div>
    </div>
    <div className="form-actions"><Link className="secondary-button touch-target" href={`/${locale}/dashboard`}>{t("cancel")}</Link><button aria-busy={pending} className="primary-button lead-submit touch-target" disabled={pending} type="submit">{showPending ? <span aria-hidden="true" className="motion-spinner" /> : <Icon name="add" size={18} />}{showPending ? t("addingLead") : t("createLeadAction")}</button></div>
  </form>;
}