import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  "";

/** False until both URL and a client key are set in `.env` (restart Vite after saving). */
export const isSupabaseConfigured = Boolean(url && key);

// Empty key makes @supabase/supabase-js throw at import time → blank page.
// Use placeholders so the UI can mount and show setup instructions.
const safeUrl = url || "https://placeholder.supabase.co";
const safeKey = key || "sb_missing_publishable_key_open_dotenv";

export const supabase = createClient<Database>(safeUrl, safeKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
