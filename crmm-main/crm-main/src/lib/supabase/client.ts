import {createBrowserClient} from "@supabase/ssr";
import {isSupabaseConfigured} from "./config";
import type {Database} from "./database";

export function createClient() {
  if (!isSupabaseConfigured()) return null;

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}