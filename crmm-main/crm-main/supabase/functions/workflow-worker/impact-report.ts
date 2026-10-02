import {PDFDocument, rgb} from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import reshaper from "npm:arabic-persian-reshaper@1.0.1";
import bidiFactory from "npm:bidi-js@1.1.0";

const bidi = bidiFactory();

type ReportData = {
  currency: string;
  baseline: {
    lead_count: number;
    average_first_response_minutes: number | null;
    untouched_over_24h_percent: number | null;
  };
  after: {
    lead_count: number;
    average_first_response_minutes: number | null;
    untouched_over_24h_percent: number | null;
  };
  rescued_by_reminder: number;
  rescued_by_escalation: number;
  leads_saved: number;
  average_deal_value: number;
  close_rate_percent: number;
  estimated_revenue_protected: number;
};

type ClaimedReport = {
  report_id: string;
  organization_id: string;
  organization_name: string;
  organization_language: "ar" | "en";
  organization_currency: string;
  period_start: string;
  period_end: string;
  report_data: ReportData;
  recipient_email: string;
};

type EmbeddedFont = Awaited<ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>["embedFont"]>>;
type ReportFonts = {primary: EmbeddedFont; fallback: EmbeddedFont};

function localizedNumber(value: number, locale: "ar" | "en", maximumFractionDigits = 1) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {maximumFractionDigits}).format(value);
}

function formattedMinutes(value: number | null, locale: "ar" | "en") {
  if (value === null) return locale === "ar" ? "لا توجد بيانات" : "No data";
  const number = localizedNumber(value, locale);
  return locale === "ar" ? `${number} دقيقة` : `${number} min`;
}

function formattedPercent(value: number | null, locale: "ar" | "en") {
  if (value === null) return locale === "ar" ? "لا توجد بيانات" : "No data";
  return `${localizedNumber(value, locale)}${locale === "ar" ? "٪" : "%"}`;
}

function formattedMoney(value: number, currency: string, locale: "ar" | "en") {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {maximumFractionDigits: 0}).format(value);
  if (locale === "ar") return `${amount} ${currency === "SAR" ? "ر.س" : "ج.م"}`;
  return `${currency} ${amount}`;
}

function reshapeRtl(text: string) {
  const shaped = reshaper.ArabicShaper.convertArabic(text);
  const embeddingLevels = bidi.getEmbeddingLevels(shaped, "rtl");
  const characters = shaped.split("");
  for (const [start, end] of bidi.getReorderSegments(shaped, embeddingLevels)) {
    const segment = characters.slice(start, end + 1).reverse();
    characters.splice(start, segment.length, ...segment);
  }
  return characters.join("");
}

function drawReportText(
  page: ReturnType<Awaited<ReturnType<typeof PDFDocument.create>>["addPage"]>,
  text: string,
  fonts: ReportFonts,
  y: number,
  size: number,
  locale: "ar" | "en",
  color = rgb(0.12, 0.18, 0.2),
  bold = false,
  anchor = locale === "ar" ? 547 : 48,
) {
  const visualText = locale === "ar" ? reshapeRtl(text) : text;
  const characterSets = {
    primary: new Set(fonts.primary.getCharacterSet()),
    fallback: new Set(fonts.fallback.getCharacterSet()),
  };
  const runs: Array<{text: string; font: EmbeddedFont}> = [];
  for (const character of Array.from(visualText)) {
    const codePoint = character.codePointAt(0) ?? 0;
    const font = characterSets.primary.has(codePoint) ? fonts.primary : fonts.fallback;
    const lastRun = runs.at(-1);
    if (lastRun?.font === font) lastRun.text += character;
    else runs.push({text: character, font});
  }
  const width = runs.reduce((total, run) => total + run.font.widthOfTextAtSize(run.text, size), 0);
  let x = locale === "ar" ? anchor - width : anchor;
  for (const run of runs) {
    page.drawText(run.text, {x, y, size, font: run.font, color, opacity: bold ? 1 : 0.92});
    x += run.font.widthOfTextAtSize(run.text, size);
  }
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character] ?? character);
}

function dateLabel(value: string, locale: "ar" | "en") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"}).format(new Date(`${value}T12:00:00Z`));
}

export async function createImpactPdf(report: ClaimedReport) {
  const locale = report.organization_language;
  const data = report.report_data;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontPath = new URL(locale === "ar" ? "./fonts/arabic.woff" : "./fonts/latin.woff", import.meta.url);
  const fontBytes = await Deno.readFile(fontPath);
  const font = await pdf.embedFont(fontBytes, {subset: true});
  const fallbackBytes = locale === "ar" ? await Deno.readFile(new URL("./fonts/latin.woff", import.meta.url)) : fontBytes;
  const fallbackFont = locale === "ar" ? await pdf.embedFont(fallbackBytes, {subset: true}) : font;
  const fonts = {primary: font, fallback: fallbackFont};
  const page = pdf.addPage([595, 842]);
  const dark = rgb(0.12, 0.18, 0.2);
  const muted = rgb(0.35, 0.42, 0.43);
  const accent = rgb(0.08, 0.43, 0.4);
  const pale = rgb(0.91, 0.96, 0.94);
  const rightX = 547;
  let y = 790;
  const write = (text: string, size: number, color = dark, bold = false) => {
    drawReportText(page, text, fonts, y, size, locale, color, bold);
    y -= size + 12;
  };

  page.drawText("MASAR", {x: 48, y, size: 10, font: fallbackFont, color: accent});
  y -= 34;
  write(locale === "ar" ? "تقرير الأثر الأسبوعي" : "Weekly Impact Report", 24, dark, true);
  write(report.organization_name, 14, muted, true);
  write(`${dateLabel(report.period_start, locale)} - ${dateLabel(report.period_end, locale)}`, 10, muted);
  page.drawLine({start: {x: 48, y: y + 1}, end: {x: rightX, y: y + 1}, thickness: 1, color: rgb(0.84, 0.88, 0.87)});
  y -= 28;

  const savedLabel = locale === "ar" ? "عملاء أُنقذوا هذا الأسبوع" : "Leads saved this week";
  drawReportText(page, savedLabel, fonts, y, 12, locale, muted, true);
  y -= 51;
  drawReportText(page, localizedNumber(data.leads_saved, locale, 0), fonts, y, 40, locale, accent, true);
  y -= 54;

  page.drawRectangle({x: 48, y: y - 18, width: 499, height: 66, color: pale});
  const revenueTitle = locale === "ar" ? "الإيراد المحتمل حمايته" : "Estimated revenue protected";
  drawReportText(page, revenueTitle, fonts, y + 20, 11, locale, muted, true);
  drawReportText(page, formattedMoney(data.estimated_revenue_protected, data.currency, locale), fonts, y - 4, 21, locale, dark, true);
  y -= 74;

  write(locale === "ar" ? "قبل وبعد" : "Before and after", 14, dark, true);
  const baselineResponse = formattedMinutes(data.baseline.average_first_response_minutes, locale);
  const recentResponse = formattedMinutes(data.after.average_first_response_minutes, locale);
  const baselineUntouched = formattedPercent(data.baseline.untouched_over_24h_percent, locale);
  const recentUntouched = formattedPercent(data.after.untouched_over_24h_percent, locale);
  const beforeLabel = locale === "ar" ? "خط الأساس · أول 7 أيام" : "Baseline · first 7 days";
  const afterLabel = locale === "ar" ? "الفترة الأخيرة · 7 أيام" : "Latest period · 7 days";
  const labelX = locale === "ar" ? 547 : 48;
  const beforeX = locale === "ar" ? 380 : 245;
  const afterX = locale === "ar" ? 220 : 405;
  drawReportText(page, beforeLabel, fonts, y, 10, locale, muted, true, beforeX);
  drawReportText(page, afterLabel, fonts, y, 10, locale, muted, true, afterX);
  y -= 43;
  for (const [label, before, after] of [
    [locale === "ar" ? "متوسط أول استجابة" : "Avg. first response", baselineResponse, recentResponse],
    [locale === "ar" ? "بلا تواصل بعد 24 ساعة" : "Untouched after 24h", baselineUntouched, recentUntouched],
  ]) {
    drawReportText(page, label, fonts, y, 9, locale, muted, false, labelX);
    drawReportText(page, before, fonts, y, 9, locale, dark, false, beforeX);
    drawReportText(page, after, fonts, y, 9, locale, dark, false, afterX);
    y -= 23;
  }
  y -= 13;
  page.drawLine({start: {x: 48, y}, end: {x: rightX, y}, thickness: 1, color: rgb(0.84, 0.88, 0.87)});
  y -= 25;

  write(locale === "ar" ? "العملاء الذين أعادتهم المتابعة" : "Leads brought back by follow-up", 13, dark, true);
  write(locale === "ar"
    ? `التذكيرات: ${localizedNumber(data.rescued_by_reminder, locale, 0)}   ·   التصعيدات: ${localizedNumber(data.rescued_by_escalation, locale, 0)}`
    : `Reminders: ${localizedNumber(data.rescued_by_reminder, locale, 0)}   ·   Escalations: ${localizedNumber(data.rescued_by_escalation, locale, 0)}`,
  10, muted);
  y -= 6;
  const assumptionLines = locale === "ar"
    ? [
      `التقدير مبني على متوسط صفقة ${formattedMoney(data.average_deal_value, data.currency, locale)} ومعدل إغلاق ${formattedPercent(data.close_rate_percent, locale)}.`,
      "الإيراد المحتمل تقديري وليس إيرادًا محققًا.",
    ]
    : [
      `Estimate uses an average deal value of ${formattedMoney(data.average_deal_value, data.currency, locale)} and a ${formattedPercent(data.close_rate_percent, locale)} close rate.`,
      "Potential revenue is an estimate, not booked revenue.",
    ];
  drawReportText(page, assumptionLines[0], fonts, y, 8, locale, muted);
  drawReportText(page, assumptionLines[1], fonts, y - 11, 8, locale, muted);
  page.drawText(locale === "ar" ? "مسار · تقرير آلي قابل للمشاركة" : "Masar · Automated report for sharing", {
    x: 48,
    y: 30,
    size: 8,
    font,
    color: muted,
  });
  return await pdf.save();
}

export function impactEmail(report: ClaimedReport) {
  const locale = report.organization_language;
  const data = report.report_data;
  const rtl = locale === "ar";
  const heading = rtl ? "تقرير أثر مسار الأسبوعي" : "Your weekly Masar impact report";
  const saved = rtl ? "عملاء أُنقذوا" : "Leads saved";
  const revenue = rtl ? "الإيراد المحتمل حمايته" : "Estimated revenue protected";
  const period = `${dateLabel(report.period_start, locale)} - ${dateLabel(report.period_end, locale)}`;
  const responseBefore = formattedMinutes(data.baseline.average_first_response_minutes, locale);
  const responseAfter = formattedMinutes(data.after.average_first_response_minutes, locale);
  const untouchedBefore = formattedPercent(data.baseline.untouched_over_24h_percent, locale);
  const untouchedAfter = formattedPercent(data.after.untouched_over_24h_percent, locale);
  const disclaimer = rtl
    ? `تقدير الإيراد يستخدم متوسط صفقة ${formattedMoney(data.average_deal_value, data.currency, locale)} ومعدل إغلاق ${formattedPercent(data.close_rate_percent, locale)}، ولا يمثل إيرادًا محققًا.`
    : `Revenue estimate uses an average deal value of ${formattedMoney(data.average_deal_value, data.currency, locale)} and a ${formattedPercent(data.close_rate_percent, locale)} close rate. It is not booked revenue.`;
  const rescueLine = rtl
    ? `التذكيرات: ${localizedNumber(data.rescued_by_reminder, locale, 0)} · التصعيدات: ${localizedNumber(data.rescued_by_escalation, locale, 0)}`
    : `Rescued by reminders: ${localizedNumber(data.rescued_by_reminder, locale, 0)} · escalations: ${localizedNumber(data.rescued_by_escalation, locale, 0)}`;
  const html = [
    `<div dir="${rtl ? "rtl" : "ltr"}" style="font-family:Arial,sans-serif;color:#1f3032;max-width:640px;margin:0 auto;line-height:1.7">`,
    `<p style="color:#176e66;font-weight:700">MASAR</p><h1 style="font-size:24px">${escapeHtml(heading)}</h1>`,
    `<p>${escapeHtml(report.organization_name)} · ${escapeHtml(period)}</p>`,
    `<div style="background:#eaf4f1;padding:20px;margin:20px 0"><div style="font-size:12px;color:#536365">${escapeHtml(saved)}</div>`,
    `<strong style="font-size:36px;color:#176e66">${escapeHtml(localizedNumber(data.leads_saved, locale, 0))}</strong>`,
    `<div style="font-size:12px;color:#536365">${escapeHtml(revenue)}</div><strong style="font-size:22px">${escapeHtml(formattedMoney(data.estimated_revenue_protected, data.currency, locale))}</strong></div>`,
    `<table style="width:100%;border-collapse:collapse;text-align:${rtl ? "right" : "left"}"><thead><tr><th></th><th>${rtl ? "خط الأساس" : "Baseline"}</th><th>${rtl ? "آخر 7 أيام" : "Latest 7 days"}</th></tr></thead>`,
    `<tbody><tr><td>${rtl ? "متوسط أول استجابة" : "Average first response"}</td><td>${escapeHtml(responseBefore)}</td><td>${escapeHtml(responseAfter)}</td></tr>`,
    `<tr><td>${rtl ? "بلا تواصل بعد 24 ساعة" : "Untouched after 24h"}</td><td>${escapeHtml(untouchedBefore)}</td><td>${escapeHtml(untouchedAfter)}</td></tr></tbody></table>`,
    `<p>${escapeHtml(rescueLine)}</p><p style="font-size:12px;color:#536365">${escapeHtml(disclaimer)}</p>`,
    `<p style="font-size:11px;color:#7c8889">${rtl ? "تقرير أسبوعي آلي قابل للمشاركة من مسار." : "Automated weekly report from Masar, ready to forward."}</p></div>`,
  ].join("");
  return {
    subject: `${heading} · ${period}`,
    html,
    text: `${heading}\n${report.organization_name}\n${period}\n${saved}: ${localizedNumber(data.leads_saved, locale, 0)}\n${revenue}: ${formattedMoney(data.estimated_revenue_protected, data.currency, locale)}\n${disclaimer}`,
  };
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function deliverImpactReport(report: ClaimedReport, apiKey: string, fromEmail: string) {
  const pdf = await createImpactPdf(report);
  const email = impactEmail(report);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `masar-impact-${report.report_id}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [report.recipient_email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{filename: `masar-impact-${report.period_end}.pdf`, content: toBase64(pdf)}],
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : `Resend returned ${response.status}`);
  return typeof result.id === "string" ? result.id : "accepted";
}

export type {ClaimedReport};
