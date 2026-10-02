"use client";

import {useId, useRef, type KeyboardEvent} from "react";
import {Icon, type MasarIconName} from "@/components/ui/icon";
import {directionMultiplier} from "@/lib/motion";

export type TabItem = {id: string; label: string; icon?: MasarIconName};

export function Tabs({
  items,
  value,
  onChange,
  label,
  direction = "rtl",
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  direction?: "ltr" | "rtl";
}) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const physicalDelta = event.key === "ArrowRight" ? 1 : -1;
    const logicalDelta = physicalDelta * directionMultiplier(direction);
    const nextIndex = (index + logicalDelta + items.length) % items.length;
    buttons.current[nextIndex]?.focus();
    onChange(items[nextIndex].id);
  }

  return <div aria-label={label} className="ds-tabs" role="tablist">
    {items.map((item, index) => <button
      aria-selected={value === item.id}
      className="ds-tab"
      id={`${id}-${item.id}`}
      key={item.id}
      onClick={() => onChange(item.id)}
      onKeyDown={(event) => onKeyDown(event, index)}
      ref={(element) => { buttons.current[index] = element; }}
      role="tab"
      tabIndex={value === item.id ? 0 : -1}
      type="button"
    >{item.icon && <Icon aria-hidden="true" name={item.icon} size={18} />}{item.label}</button>)}
  </div>;
}
