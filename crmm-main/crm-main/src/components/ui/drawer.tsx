"use client";

import {useEffect, useRef, type ReactNode} from "react";
import {Icon} from "@/components/ui/icon";

export function Drawer({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    if (open) {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      if (!drawer.open) drawer.showModal();
      drawer.classList.remove("drawer-closing");
      return;
    }
    if (drawer.open && closeTimer.current === null) {
      drawer.classList.add("drawer-closing");
      closeTimer.current = window.setTimeout(() => {
        drawer.close();
        drawer.classList.remove("drawer-closing");
        closeTimer.current = null;
      }, 240);
    }
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (drawerRef.current?.open) drawerRef.current.close();
  }, []);

  return <dialog
    aria-label={title}
    className="ds-drawer"
    onCancel={(event) => {
      event.preventDefault();
      onOpenChange(false);
    }}
    onClick={(event) => {
      if (event.target === drawerRef.current) onOpenChange(false);
    }}
    ref={drawerRef}
  >
    <header className="ds-drawer-header">
      <h2>{title}</h2>
      <button aria-label={closeLabel} className="ds-icon-button touch-target" onClick={() => onOpenChange(false)} type="button">
        <Icon name="close" size={20} />
      </button>
    </header>
    <div className="ds-drawer-content">{children}</div>
  </dialog>;
}
