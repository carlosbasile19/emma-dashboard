import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client for client components (uses the public anon key only).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
