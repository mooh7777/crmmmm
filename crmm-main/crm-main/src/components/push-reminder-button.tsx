"use client";

import {useEffect, useState} from "react";
import {useTranslations} from "next-intl";
import {Icon} from "@/components/ui/icon";
import {createClient} from "@/lib/supabase/client";

type PushState = "ready" | "requesting" | "enabled" | "denied" | "unsupported" | "error";

function decodeApplicationServerKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeSubscriptionKey(value: ArrayBuffer | null) {
  if (!value) throw new Error("Push subscription key is unavailable");
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function PushReminderButton({organizationId}: {organizationId: string}) {
  const t = useTranslations("dashboard");
  const [state, setState] = useState<PushState>("ready");
  const applicationServerKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!applicationServerKey) return;
    const checkPushAvailability = () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      void navigator.serviceWorker.ready
        .then(async (registration) => {
          const subscription = await registration.pushManager.getSubscription();
          if (!subscription) return false;
          const client = createClient();
          if (!client) throw new Error("Supabase client is unavailable");
          const {data: {user}, error: userError} = await client.auth.getUser();
          if (userError || !user) return false;
          const {data: savedSubscription, error} = await client
            .from("push_subscriptions")
            .select("endpoint")
            .eq("organization_id", organizationId)
            .eq("user_id", user.id)
            .eq("endpoint", subscription.endpoint)
            .maybeSingle();
          if (error) throw error;
          return Boolean(savedSubscription);
        })
        .then((enabled) => { if (enabled) setState("enabled"); })
        .catch(() => setState("error"));
    };
    const timeout = window.setTimeout(checkPushAvailability, 0);
    return () => window.clearTimeout(timeout);
  }, [applicationServerKey, organizationId]);

  if (!applicationServerKey) return null;
  const vapidKey = applicationServerKey;

  async function enablePush() {
    setState("requesting");
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "ready");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(vapidKey),
      });
      const client = createClient();
      if (!client) throw new Error("Supabase client is unavailable");
      const {data: {user}, error: userError} = await client.auth.getUser();
      if (userError || !user) throw new Error("Authentication required");
      const {error} = await client.from("push_subscriptions").upsert({
        organization_id: organizationId,
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: encodeSubscriptionKey(subscription.getKey("p256dh")),
        auth: encodeSubscriptionKey(subscription.getKey("auth")),
      }, {onConflict: "organization_id,user_id,endpoint"});
      if (error) throw error;
      setState("enabled");
    } catch {
      setState("error");
    }
  }

  if (state === "unsupported") return <span className="push-reminder-status">{t("pushUnsupported")}</span>;
  if (state === "denied") return <span className="push-reminder-status">{t("pushDenied")}</span>;
  if (state === "enabled") return <span className="push-reminder-status push-reminder-enabled"><Icon name="check" size={16} />{t("pushEnabled")}</span>;

  return <button className="secondary-button compact-button push-reminder-button touch-target" disabled={state === "requesting"} onClick={enablePush} type="button">
    <Icon name={state === "error" ? "warning" : "notifications"} size={17} />
    {state === "requesting" ? t("pushEnabling") : state === "error" ? t("pushEnableError") : t("enablePush")}
  </button>;
}