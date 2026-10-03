"use server";

import {createHash, randomBytes} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {parse as parseCsv} from "csv-parse/sync";
import ExcelJS from "exceljs";
import {createClient} from "@/lib/supabase/server";
import type {OrganizationRole} from "@/lib/supabase/database";

type Locale = "ar" | "en";

export type LeadFilePreviewState = {
  headers: string[];
  rows: string[][];
  error: string | null;
};

export type LeadImportState = {
  created: number;
  duplicates: number;
  failed: number;
  error: string | null;
};

export type WebhookSecretState = {
  secret: string | null;
  error: string | null;
};

export type CreateLeadResult = {
  fieldErrors: {fullName?: string; phone?: string; email?: string};
  error: "auth" | "lead" | null;
  success: "created" | "duplicate" | null;
};

export type CreateSalesInviteResult = {url: string | null; error: "auth" | "forbidden" | "invite" | null};

const emptyLeadFilePreview: LeadFilePreviewState = {headers: [], rows: [], error: null};
const emptyLeadImport: LeadImportState = {created: 0, duplicates: 0, failed: 0, error: null};

function getLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ar";
}

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getRawText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return process.env.NODE_ENV === "production" ? "https://example.com" : "http://localhost:3000";
}

async function requireMembership(organizationId: string) {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return {supabase, user: null, role: null};

  const {data: membership} = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  return {supabase, user, role: membership?.role ?? null};
}

export async function signIn(formData: FormData) {
  const locale = getLocale(formData.get("locale"));
  const email = getText(formData, "email");
  const password = getRawText(formData, "password");

  if (!email || !password) redirect(`/${locale}?error=auth`);

  const supabase = await createClient();
  const {error} = await supabase.auth.signInWithPassword({email, password});
  if (error) redirect(`/${locale}?error=auth`);

  redirect(`/${locale}`);
}

export async function signUp(formData: FormData) {
  const locale = getLocale(formData.get("locale"));
  const email = getText(formData, "email");
  const password = getRawText(formData, "password");

  if (!email || password.length < 8) redirect(`/${locale}?error=auth`);

  const origin = getSiteOrigin();
  const supabase = await createClient();
  const {data, error} = await supabase.auth.signUp({
    email,
    password,
    options: {emailRedirectTo: `${origin}/${locale}/auth/callback`},
  });

  if (error) redirect(`/${locale}?error=auth`);
  if (!data.session) redirect(`/${locale}?notice=account-created`);

  redirect(`/${locale}`);
}

export async function createSalesInvite(organizationId: string, locale: Locale): Promise<CreateSalesInviteResult> {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return {url: null, error: "auth"};

  const {data: membership} = await supabase.from("memberships")
    .select("role, is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership?.is_active || (membership.role !== "owner" && membership.role !== "manager")) {
    return {url: null, error: "forbidden"};
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const {error} = await supabase.rpc("create_sales_invite", {
    target_organization_id: organizationId,
    target_token_hash: tokenHash,
  });
  if (error) return {url: null, error: "invite"};

  const origin = getSiteOrigin();
  return {url: new URL(`/${locale}/invite/${token}`, origin).toString(), error: null};
}

export async function activateDefaultFollowUp(organizationId: string, locale: Locale) {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}`);
  const {error} = await supabase.rpc("activate_default_lead_workflow", {target_organization_id: organizationId});
  if (error) redirect(`/${locale}/dashboard?notice=workflow-error`);
  revalidatePath(`/${locale}/dashboard`);
  redirect(`/${locale}/dashboard?notice=workflow-activated`);
}

export async function acceptSalesInvite(formData: FormData) {
  const locale = getLocale(formData.get("locale"));
  const token = getText(formData, "inviteToken");
  const email = getText(formData, "email");
  const password = getRawText(formData, "password");
  if (token.length < 32 || !email || !password) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=auth`);

  const supabase = await createClient();
  const {error: authError} = await supabase.auth.signInWithPassword({email, password});
  if (authError) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=auth`);

  const {error} = await supabase.rpc("accept_organization_invite", {invite_token: token});
  if (error) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=invite`);
  redirect(`/${locale}/dashboard?notice=invite-accepted`);
}

export async function acceptCurrentSalesInvite(formData: FormData) {
  const locale = getLocale(formData.get("locale"));
  const token = getText(formData, "inviteToken");
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user || token.length < 32) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=auth`);
  const {error} = await supabase.rpc("accept_organization_invite", {invite_token: token});
  if (error) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=invite`);
  redirect(`/${locale}/dashboard?notice=invite-accepted`);
}

export async function createAccountFromInvite(formData: FormData) {
  const locale = getLocale(formData.get("locale"));
  const token = getText(formData, "inviteToken");
  const email = getText(formData, "email");
  const password = getRawText(formData, "password");
  if (token.length < 32 || !email || password.length < 8) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=signup`);

  const origin = getSiteOrigin();
  const supabase = await createClient();
  const {data, error} = await supabase.auth.signUp({
    email,
    password,
    options: {emailRedirectTo: `${origin}/${locale}/auth/callback?invite=${encodeURIComponent(token)}`},
  });
  if (error) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=signup`);
  if (!data.session) redirect(`/${locale}/invite/${encodeURIComponent(token)}?notice=check-email`);

  const {error: inviteError} = await supabase.rpc("accept_organization_invite", {invite_token: token});
  if (inviteError) redirect(`/${locale}/invite/${encodeURIComponent(token)}?error=invite`);
  redirect(`/${locale}/dashboard?notice=invite-accepted`);
}

export async function createOrganization(formData: FormData) {
  const locale = getLocale(formData.get("locale"));
  const name = getText(formData, "name");
  const timezone = getText(formData, "timezone");
  const currency = getText(formData, "currency");
  const language = getText(formData, "language");

  if (
    name.length < 2 || name.length > 120 ||
    !["Africa/Cairo", "Asia/Riyadh"].includes(timezone) ||
    !["EGP", "SAR"].includes(currency) ||
    !["ar", "en"].includes(language)
  ) redirect(`/${locale}?error=organization`);

  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}?error=auth`);

  const {error} = await supabase.rpc("create_organization", {
    organization_name: name,
    organization_timezone: timezone,
    organization_currency: currency,
    organization_weekend_days: [5, 6],
    organization_working_hours: {start: "09:00", end: "18:00"},
    organization_language: language,
  });

  if (error) redirect(`/${locale}?error=organization`);
  revalidatePath(`/${locale}`);
  redirect(`/${language}/dashboard?notice=organization-created`);
}

export async function createLead(
  organizationId: string,
  locale: Locale,
  formData: FormData,
): Promise<CreateLeadResult> {
  const fullName = getText(formData, "fullName");
  const phone = getText(formData, "phone");
  const email = getText(formData, "email") || null;
  const source = getText(formData, "source") || null;
  const propertyInterest = getText(formData, "propertyInterest") || null;

  const fieldErrors: CreateLeadResult["fieldErrors"] = {};
  if (fullName.length < 2 || fullName.length > 160) fieldErrors.fullName = "required";
  if (!phone) fieldErrors.phone = "required";
  if (Object.keys(fieldErrors).length) return {fieldErrors, error: null, success: null};

  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || !role) return {fieldErrors: {}, error: "auth", success: null};

  const {data, error} = await supabase.rpc("create_lead", {
    target_organization_id: organizationId,
    lead_full_name: fullName,
    lead_phone: phone,
    lead_email: email,
    lead_source: source,
    lead_property_interest: propertyInterest,
    requested_assignee_id: null,
  });

  if (error || !data) {
    if (error?.code === "22023" && /phone/i.test(error.message)) fieldErrors.phone = "invalid";
    return {fieldErrors, error: fieldErrors.phone ? null : "lead", success: null};
  }
  revalidatePath(`/${locale}/dashboard`);
  return {fieldErrors: {}, error: null, success: data.duplicate ? "duplicate" : "created"};
}

function spreadsheetValue(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && /^0+$/.test(cell.numFmt)) {
    return String(Math.trunc(value)).padStart(cell.numFmt.length, "0");
  }
  if (cell.text) return cell.text;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("result" in value) return value.result instanceof Date ? value.result.toISOString() : String(value.result ?? "");
    if ("hyperlink" in value && typeof value.text === "string") return value.text;
    return "";
  }
  return String(value);
}

function validateIntakeRole(role: OrganizationRole | null): role is "owner" | "manager" {
  return role === "owner" || role === "manager";
}

export async function previewLeadFile(
  _previousState: LeadFilePreviewState,
  formData: FormData,
): Promise<LeadFilePreviewState> {
  const organizationId = getText(formData, "organizationId");
  const file = formData.get("file");
  const {user, role} = await requireMembership(organizationId);
  if (!user || !validateIntakeRole(role)) return {...emptyLeadFilePreview, error: "forbidden"};
  if (!(file instanceof File) || file.size === 0) return {...emptyLeadFilePreview, error: "missing-file"};
  if (file.size > 5 * 1024 * 1024) return {...emptyLeadFilePreview, error: "file-too-large"};

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx") {
    return {...emptyLeadFilePreview, error: "unsupported-file"};
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    let records: string[][];

    if (extension === "csv") {
      records = (parseCsv(buffer, {
        bom: true,
        delimiter: [",", ";", "\t"],
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: 100_000,
      }) as unknown[][]).map((row) => row.map((cell) => String(cell ?? "").trim()));
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return {...emptyLeadFilePreview, error: "empty-file"};
      if (worksheet.rowCount > 501) return {...emptyLeadFilePreview, error: "too-many-rows"};
      records = [];
      worksheet.eachRow({includeEmpty: false}, (row) => {
        records.push(Array.from({length: worksheet.columnCount}, (_, index) => spreadsheetValue(row.getCell(index + 1))));
      });
    }

    if (records.length < 2 || records[0].every((header) => !header)) {
      return {...emptyLeadFilePreview, error: "empty-file"};
    }
    if (records.length > 501) return {...emptyLeadFilePreview, error: "too-many-rows"};

    const width = Math.max(records[0].length, ...records.slice(1).map((row) => row.length));
    const headers = Array.from({length: width}, (_, index) => records[0][index] ?? "");
    const rows = records.slice(1)
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => Array.from({length: width}, (_, index) => row[index] ?? ""));

    if (rows.length > 500) return {...emptyLeadFilePreview, error: "too-many-rows"};
    return {headers, rows, error: null};
  } catch {
    return {...emptyLeadFilePreview, error: "invalid-file"};
  }
}

export async function importLeadRows(
  _previousState: LeadImportState,
  formData: FormData,
): Promise<LeadImportState> {
  const organizationId = getText(formData, "organizationId");
  const rowsJson = getText(formData, "rowsPayload");
  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || !validateIntakeRole(role)) return {...emptyLeadImport, error: "forbidden"};

  let rows: unknown;
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return {...emptyLeadImport, error: "invalid-rows"};
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
    return {...emptyLeadImport, error: "invalid-rows"};
  }

  const normalizedRows = rows.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      full_name: typeof value.full_name === "string" ? value.full_name.slice(0, 160) : "",
      phone: typeof value.phone === "string" ? value.phone.slice(0, 64) : "",
      email: typeof value.email === "string" ? value.email.slice(0, 254) : "",
      source: typeof value.source === "string" ? value.source.slice(0, 120) : "",
      property_interest: typeof value.property_interest === "string" ? value.property_interest.slice(0, 160) : "",
    };
  });

  const {data, error} = await supabase.rpc("import_leads", {
    target_organization_id: organizationId,
    rows_payload: normalizedRows,
  });
  if (error || !data) return {...emptyLeadImport, error: "import-failed"};

  revalidatePath(`/${getLocale(formData.get("locale"))}/dashboard`);
  return {
    created: data.created,
    duplicates: data.duplicates,
    failed: data.failed,
    error: null,
  };
}

export async function rotateWebhookSecret(
  _previousState: WebhookSecretState,
  formData: FormData,
): Promise<WebhookSecretState> {
  const organizationId = getText(formData, "organizationId");
  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || !validateIntakeRole(role)) return {secret: null, error: "forbidden"};

  const {data, error} = await supabase.rpc("rotate_organization_webhook_secret", {
    target_organization_id: organizationId,
  });
  if (error || !data) return {secret: null, error: "rotate-failed"};

  return {secret: data, error: null};
}

export async function completeTask(organizationId: string, taskId: string, locale: Locale) {
  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || !role) redirect(`/${locale}?error=auth`);

  const {error} = await supabase
    .from("tasks")
    .update({completed_at: new Date().toISOString()})
    .eq("id", taskId)
    .eq("organization_id", organizationId);

  if (error) redirect(`/${locale}/dashboard?error=task`);
  revalidatePath(`/${locale}/dashboard`);
}

export async function markNotificationRead(organizationId: string, notificationId: string, locale: Locale) {
  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || !role) redirect(`/${locale}?error=auth`);

  const {error} = await supabase
    .from("notifications")
    .update({read_at: new Date().toISOString()})
    .eq("id", notificationId)
    .eq("organization_id", organizationId)
    .eq("recipient_id", user.id);

  if (error) redirect(`/${locale}/dashboard?error=notification`);
  revalidatePath(`/${locale}/dashboard`);
}

export async function saveOrganizationSettings(organizationId: string, locale: Locale, formData: FormData) {
  const name = getText(formData, "name");
  const timezone = getText(formData, "timezone");
  const currency = getText(formData, "currency");
  const language = getText(formData, "language");
  const start = getText(formData, "start");
  const end = getText(formData, "end");
  const weekendDays = formData.getAll("weekendDays").map(Number);
  const followUpMinutes = Number(getText(formData, "followUpMinutes"));
  const escalationMinutes = Number(getText(formData, "escalationMinutes"));
  const autoAssignEnabled = formData.get("autoAssign") === "enabled";
  const activeSalesIds = [...new Set(formData.getAll("activeSalesIds").filter((value): value is string => typeof value === "string"))];
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  if (
    name.length < 2 || name.length > 120 ||
    !["Africa/Cairo", "Asia/Riyadh"].includes(timezone) ||
    !["EGP", "SAR"].includes(currency) ||
    !["ar", "en"].includes(language) ||
    !validTime(start) || !validTime(end) || start >= end ||
    weekendDays.length > 7 || weekendDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    !Number.isInteger(followUpMinutes) || followUpMinutes < 1 || followUpMinutes > 10080 ||
    !Number.isInteger(escalationMinutes) || escalationMinutes < 0 || escalationMinutes > 1440 ||
    activeSalesIds.some((id) => !validId(id))
  ) redirect(`/${locale}/settings?error=settings`);

  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || !role || !(["owner", "manager"] as OrganizationRole[]).includes(role)) {
    redirect(`/${locale}/dashboard`);
  }

  const {error} = await supabase.rpc("save_workflow_settings", {
    target_organization_id: organizationId,
    organization_name: name,
    organization_timezone: timezone,
    organization_currency: currency,
    organization_language: language,
    organization_weekend_days: [...new Set(weekendDays)],
    organization_working_hours: {start, end},
    follow_up_minutes: followUpMinutes,
    escalation_minutes: escalationMinutes,
    auto_assign_enabled: autoAssignEnabled,
    active_sales_ids: activeSalesIds,
  });

  if (error) redirect(`/${locale}/settings?error=settings`);
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/dashboard`);
  redirect(`/${language}/settings?notice=saved`);
}

export async function saveImpactAssumptions(organizationId: string, locale: Locale, formData: FormData) {
  const averageDealValue = Number(getText(formData, "averageDealValue"));
  const closeRatePercent = Number(getText(formData, "closeRatePercent"));
  if (
    !Number.isFinite(averageDealValue) || averageDealValue <= 0 || averageDealValue > 1_000_000_000 ||
    !Number.isFinite(closeRatePercent) || closeRatePercent < 0 || closeRatePercent > 100
  ) redirect(`/${locale}/settings?error=impact`);

  const {supabase, user, role} = await requireMembership(organizationId);
  if (!user || role !== "owner") redirect(`/${locale}/settings?error=impact-forbidden`);

  const {error} = await supabase.rpc("save_impact_assumptions", {
    target_organization_id: organizationId,
    assumed_average_deal_value: averageDealValue,
    assumed_close_rate_percent: closeRatePercent,
  });
  if (error) redirect(`/${locale}/settings?error=impact`);

  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/dashboard`);
  redirect(`/${locale}/settings?notice=impact-saved`);
}

export async function signOut(locale: Locale) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}