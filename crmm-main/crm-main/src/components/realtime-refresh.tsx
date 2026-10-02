"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";

export function RealtimeRefresh({organizationId}: {organizationId: string}) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`organization:${organizationId}:follow-up`)
      .on("postgres_changes", {event: "*", schema: "public", table: "leads", filter: `organization_id=eq.${organizationId}`}, () => router.refresh())
      .on("postgres_changes", {event: "*", schema: "public", table: "tasks", filter: `organization_id=eq.${organizationId}`}, () => router.refresh())
      .on("postgres_changes", {event: "*", schema: "public", table: "notifications", filter: `organization_id=eq.${organizationId}`}, () => router.refresh())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, router]);

  return null;
}