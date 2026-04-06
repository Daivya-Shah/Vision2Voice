/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Set to `http://127.0.0.1:8000` for local Python backend (skip Edge Function). */
  readonly VITE_BACKEND_URL?: string;
  /** Legacy name; same as publishable/anon key if you prefer. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
