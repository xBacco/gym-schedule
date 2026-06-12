// Singleton del client Supabase. Importato sia da auth.js sia da store.js.
// L'anon key è pubblica per design: RLS è il vero gate di sicurezza.
import { createClient } from "./vendor/supabase.js";

const SUPABASE_URL = "https://skxqdklhhixekjekujfe.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNreHFka2xoaGl4ZWtqZWt1amZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTM4MzMsImV4cCI6MjA5NTUyOTgzM30._hUixk1jESi0gZLW4rSg2qrYtlKI-bCgg3lXSXBXkiA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // gestisce il redirect del reset password
  },
});
