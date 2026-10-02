"use client";

import {useActionState, useState} from "react";
import {useTranslations} from "next-intl";
import {Icon} from "@/components/ui/icon";
import {rotateWebhookSecret, type WebhookSecretState} from "@/app/[locale]/actions";

const initialState: WebhookSecretState = {secret: null, error: null};

export function WebhookSecretPanel({organizationId, siteUrl}: {organizationId: string; siteUrl: string}) {
  const t = useTranslations("organization");
  const [state, action, pending] = useActionState(rotateWebhookSecret, initialState);
  const [copied, setCopied] = useState(false);
  const endpoint = `${siteUrl.replace(/\/$/, "")}/api/webhooks/leads/${organizationId}`;

  async function copySecret() {
    if (!state.secret) return;
    await navigator.clipboard.writeText(state.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section aria-labelledby="webhook-secret-title" className="settings-section webhook-section">
      <div className="section-heading">
        <div>
          <h2 id="webhook-secret-title">{t("webhookTitle")}</h2>
          <p>{t("webhookDescription")}</p>
        </div>
      </div>
      <form action={action}>
        <input name="organizationId" type="hidden" value={organizationId} />
        <button className="secondary-button touch-target" disabled={pending} type="submit">
          <Icon name={state.secret ? "edit" : "link"} size={18} />
          {pending ? t("webhookRotating") : state.secret ? t("webhookRotate") : t("webhookGenerate")}
        </button>
      </form>
      {state.error && <p className="form-alert" role="alert">{t("webhookError")}</p>}
      {state.secret && (
        <div className="webhook-secret-result" role="status">
          <p>{t("webhookRevealOnce")}</p>
          <div className="webhook-secret-value">
            <code dir="ltr">{state.secret}</code>
            <button aria-label={copied ? t("webhookCopied") : t("webhookCopy")} className="ds-icon-button touch-target" onClick={copySecret} type="button">
              <Icon name={copied ? "success" : "copy"} size={18} />
            </button>
          </div>
          <div className="webhook-endpoint">
            <span>{t("webhookEndpoint")}</span>
            <code dir="ltr">{endpoint}</code>
          </div>
          <div className="webhook-endpoint">
            <span>{t("webhookHeader")}</span>
            <code dir="ltr">x-masar-webhook-secret</code>
          </div>
          <p>{t("webhookBody")}</p>
          <p className="webhook-warning">{t("webhookRotationWarning")}</p>
        </div>
      )}
    </section>
  );
}