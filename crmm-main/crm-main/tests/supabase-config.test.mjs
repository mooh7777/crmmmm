import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupabaseConfigured } from '../src/lib/supabase/config.ts';

test('placeholder Supabase values are rejected', () => {
  assert.equal(
    isSupabaseConfigured({
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'your-supabase-publishable-key',
    }),
    false,
  );
});

test('real Supabase values are accepted', () => {
  assert.equal(
    isSupabaseConfigured({
      NEXT_PUBLIC_SUPABASE_URL: 'https://real-project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123',
    }),
    true,
  );
});
