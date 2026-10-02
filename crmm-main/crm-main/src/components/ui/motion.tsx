"use client";

import {ViewTransition, startTransition, useEffect, useRef, useState, type ReactNode} from "react";
import {motionIsReduced} from "@/lib/motion";

export function Motion({children, name = "route-content"}: {children: ReactNode; name?: string}) {
  return <ViewTransition default="none" enter="content-enter" exit="content-exit" name={name}>{children}</ViewTransition>;
}

export function MotionItem({children, name, className = ""}: {children: ReactNode; name: string; className?: string}) {
  return <ViewTransition default="none" name={name}><div className={className}>{children}</div></ViewTransition>;
}

export function useListTransition(items: ReadonlyArray<{id: string}>, duration = 1200) {
  const previousIds = useRef<Set<string> | null>(null);
  const [arrivingIds, setArrivingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const currentIds = new Set(items.map((item) => item.id));
    const previous = previousIds.current;
    previousIds.current = currentIds;
    if (!previous) return;

    const addedIds = [...currentIds].filter((id) => !previous.has(id));
    if (!addedIds.length || motionIsReduced()) return;

    startTransition(() => setArrivingIds(new Set(addedIds)));
    const timeout = window.setTimeout(() => startTransition(() => setArrivingIds(new Set())), duration);
    return () => window.clearTimeout(timeout);
  }, [duration, items]);

  return (id: string) => arrivingIds.has(id);
}

export function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (target === 0) {
      if (!hasAnimated.current) startTransition(() => setValue(0));
      return;
    }
    if (hasAnimated.current || motionIsReduced()) {
      hasAnimated.current = true;
      startTransition(() => setValue(target));
      return;
    }

    hasAnimated.current = true;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, target]);

  return value;
}

export function useDelayedPending(pending: boolean, delay = 300) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(pending), pending ? delay : 0);
    return () => window.clearTimeout(timeout);
  }, [delay, pending]);
  return visible;
}

export function CountUpNumber({value, locale, fractionDigits = 0}: {value: number; locale: "ar" | "en"; fractionDigits?: number}) {
  const count = useCountUp(value, 600);
  return <span aria-live="off">{new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {maximumFractionDigits: fractionDigits}).format(count)}</span>;
}

export function useOptimisticMutation<T>(initialValue: T) {
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function mutate(optimisticValue: T, operation: () => Promise<T>) {
    const previousValue = value;
    setError(null);
    setPending(true);
    startTransition(() => setValue(optimisticValue));
    try {
      const confirmedValue = await operation();
      startTransition(() => setValue(confirmedValue));
      return {ok: true as const, value: confirmedValue};
    } catch (cause) {
      startTransition(() => setValue(previousValue));
      const mutationError = cause instanceof Error ? cause : new Error("Mutation failed");
      setError(mutationError);
      return {ok: false as const, value: previousValue, error: mutationError};
    } finally {
      setPending(false);
    }
  }

  return {value, pending, error, mutate};
}
