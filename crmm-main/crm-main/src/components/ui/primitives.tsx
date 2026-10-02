import type {ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TableHTMLAttributes, HTMLAttributes} from "react";
import {ViewTransition} from "react";
import Image from "next/image";
import {cn} from "@/lib/utils";
import {Icon, type MasarIconName} from "@/components/ui/icon";

export function Input({className, ...props}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("ds-input", className)} {...props} />;
}

export function Select({className, children, ...props}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="ds-select-wrap">
      <select className={cn("ds-select", className)} {...props}>{children}</select>
      <Icon aria-hidden="true" className="ds-select-icon" name="chevron-down" size={16} />
    </span>
  );
}

export function Table({className, children, ...props}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="ds-table-scroll">
      <table className={cn("ds-table", className)} {...props}>{children}</table>
    </div>
  );
}

export function TableRow({motionId, className, children, ...props}: HTMLAttributes<HTMLTableRowElement> & {motionId?: string}) {
  const row = <tr className={className} {...props}>{children}</tr>;
  return motionId
    ? <ViewTransition default="none" name={`lead-row-${motionId}`}>{row}</ViewTransition>
    : row;
}

export function Badge({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  return <span className={cn("ds-badge", `ds-badge-${tone}`, className)}>{children}</span>;
}

export function StagePill({stage, label}: {stage: "visit" | "deal" | "lost"; label: string}) {
  return <Badge className={`stage-pill stage-${stage}`} tone={stage === "deal" ? "success" : stage === "lost" ? "danger" : "neutral"}>
    <Icon aria-hidden="true" name={`stage-${stage}`} size={16} />{label}
  </Badge>;
}

export function EmptyState({
  icon: iconName,
  illustration,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: MasarIconName;
  illustration?: "empty-leads" | "empty-tasks" | "empty-queue" | "empty-search" | "onboarding-import" | "onboarding-team" | "error-page";
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`ds-empty${compact ? " ds-empty-compact" : ""}`}>
      {illustration
        ? <Image alt="" className="ds-empty-illustration" height={120} src={`/illustrations/${illustration}.svg`} width={160} />
        : <span className="ds-empty-icon"><Icon aria-hidden="true" name={iconName ?? "info"} size={24} /></span>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="ds-empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({className, ...props}: {className?: string; "aria-label"?: string}) {
  return <span aria-hidden="true" className={cn("ds-skeleton", className)} {...props} />;
}