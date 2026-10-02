"use client";

import {useEffect, useId, useRef, type ReactNode} from "react";
import {Icon} from "@/components/ui/icon";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      if (!dialog.open) dialog.showModal();
      dialog.classList.remove("dialog-closing");
    } else if (dialog.open && closeTimer.current === null) {
      dialog.classList.add("dialog-closing");
      closeTimer.current = window.setTimeout(() => {
        dialog.close();
        dialog.classList.remove("dialog-closing");
        closeTimer.current = null;
      }, 160);
    }
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (dialogRef.current?.open) dialogRef.current.close();
  }, []);

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className="ds-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onOpenChange(false);
      }}
      ref={dialogRef}
    >
      <header className="ds-dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
          <button aria-label={closeLabel} className="ds-icon-button touch-target" onClick={() => onOpenChange(false)} type="button">
          <Icon name="close" size={20} />
        </button>
      </header>
      <div className="ds-dialog-content">{children}</div>
    </dialog>
  );
}