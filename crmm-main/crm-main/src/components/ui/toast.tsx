"use client";

import {useCallback, useEffect, useRef} from "react";
import {Icon, type MasarIconName} from "@/components/ui/icon";

type ToastTone = "success" | "warning" | "error" | "info";
const toneIcon: Record<ToastTone, MasarIconName> = {
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
};

export function Toast({
  message,
  open,
  onClose,
  dismissLabel,
  tone = "success",
  undoLabel,
  onUndo,
}: {
  message: string;
  open: boolean;
  onClose: () => void;
  dismissLabel: string;
  tone?: ToastTone;
  undoLabel?: string;
  onUndo?: () => void;
}) {
  const timer = useRef<number | null>(null);
  const deadline = useRef(0);
  const remaining = useRef(5000);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(0, deadline.current - Date.now());
  }, []);

  const resumeTimer = useCallback(() => {
    if (!open || timer.current !== null) return;
    deadline.current = Date.now() + remaining.current;
    timer.current = window.setTimeout(onClose, remaining.current);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      remaining.current = 5000;
      return;
    }
    resumeTimer();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [open, resumeTimer]);

  if (!open) return null;

  return <div
    aria-live={tone === "error" ? "assertive" : "polite"}
    className={`ds-toast toast-${tone}`}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeTimer();
    }}
    onFocus={clearTimer}
    onMouseEnter={clearTimer}
    onMouseLeave={resumeTimer}
    role={tone === "error" ? "alert" : "status"}
  >
    <Icon aria-hidden="true" name={toneIcon[tone]} size={20} />
    <span>{message}</span>
    {onUndo && undoLabel && <button className="toast-undo" onClick={onUndo} onFocus={clearTimer} type="button">{undoLabel}</button>}
    <button aria-label={dismissLabel} className="ds-icon-button touch-target" onClick={onClose} type="button">
      <Icon aria-hidden="true" name="close" size={18} />
    </button>
  </div>;
}