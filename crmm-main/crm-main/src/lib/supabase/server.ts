import {createServerClient} from "@supabase/ssr";
import {connection} from "next/server";
import {cookies} from "next/headers";
import {getSupabaseConfig} from "./config";
import type {Database} from "./database";

export async function createClient() {
  await connection();
  const {url, anonKey} = getSupabaseConfig();

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({name, value, options}) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot mutate cookies; Server Actions can.
        }
      },
    },
  });
}