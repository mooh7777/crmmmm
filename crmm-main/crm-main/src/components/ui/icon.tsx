import type {CSSProperties} from "react";
import {cn} from "@/lib/utils";

export type MasarIconName =
  | "add" | "arrow-end" | "assign" | "billing" | "calendar" | "call" | "check" | "chevron-down"
  | "clock" | "close" | "company" | "copy" | "dashboard" | "edit" | "error" | "escalate"
  | "export" | "filter" | "import" | "info" | "integrations" | "language" | "leads" | "link"
  | "logout" | "menu" | "more" | "new-lead" | "notifications" | "overdue" | "reports"
  | "search" | "send-message" | "settings" | "stage-deal" | "stage-lost" | "stage-visit"
  | "success" | "tasks" | "team" | "trash" | "user" | "warning" | "whatsapp-queue";

export function Icon({
  name,
  size = 24,
  className,
  label,
}: {
  name: MasarIconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  const style = {
    "--icon-size": `${size}px`,
    "--icon-mask": `url("/icons/${name}.svg")`,
  } as CSSProperties;
  const mirrored = name === "arrow-end" || name === "logout";

  return <span
    aria-hidden={label ? undefined : true}
    aria-label={label}
    className={cn("ui-icon-mask", mirrored && "icon-flip", className)}
    role={label ? "img" : undefined}
    style={style}
  />;
}
