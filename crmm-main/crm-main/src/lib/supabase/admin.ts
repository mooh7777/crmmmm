import "server-only";
import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {getSupabaseConfig} from "./config";
import type {Database} from "./database";

export function createAdminClient() {
  const {url} = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  });
}
