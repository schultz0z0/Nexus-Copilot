import { createClient } from "@supabase/supabase-js";

// Ensure these are set in your .env file
// VITE_SUPABASE_URL=your_project_url
// VITE_SUPABASE_ANON_KEY=your_anon_key

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
