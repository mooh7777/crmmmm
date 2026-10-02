"use client";

import {useCountUp} from "@/components/ui/motion";
import {Icon, type MasarIconName} from "@/components/ui/icon";

export function KpiCard({
  label,
  value,
  detail,
  icon,
  locale,
  tone = "default",
}: {
  label: string;
  value: number;
  detail?: string;
  icon: MasarIconName;
  locale: "ar" | "en";
  tone?: "default" | "success" | "warning";
}) {
  const number = useCountUp(value, 600);
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(number);

  return <article className={`metric-block kpi-card kpi-${tone}`}>
    <div className="metric-label"><span>{label}</span><Icon aria-hidden="true" name={icon} size={18} /></div>
    <strong className="metric-value" dir="auto" aria-live="off">{formatted}</strong>
    {detail && <span className="metric-footnote">{detail}</span>}
  </article>;
}
