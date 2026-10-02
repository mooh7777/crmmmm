export function isSupabaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) return false;

  const placeholderPatterns = [
    /^https?:\/\/your-project-ref\.supabase\.co(?:\/)?$/i,
    /^https?:\/\/example\.com(?:\/)?$/i,
    /^your-supabase-publishable-key$/i,
    /^your-[a-z0-9-]*key$/i,
    /^(replace[-_]?me|your[-_]?anon[-_]?key)$/i,
  ];

  if (placeholderPatterns.some((pattern) => pattern.test(url) || pattern.test(anonKey))) {
    return false;
  }

  try {
    new URL(url);
  } catch {
    return false;
  }

  return true;
}

export function getSupabaseConfig(env: Record<string, string | undefined> = process.env) {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!isSupabaseConfigured(env)) {
    throw new Error("Supabase is not configured. Add your real NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY values to .env.local.");
  }

  return {url, anonKey};
}
