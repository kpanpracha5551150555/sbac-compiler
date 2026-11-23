/* SBAC Compiler — public configuration.
 * Supabase "Project URL" and "anon public" key (Project Settings → API).
 * The anon key is meant to be public: data is protected by Row Level Security (supabase/schema.sql).
 * Leave empty to run without accounts (everything stays in the browser). */
window.SBAC = window.SBAC || {};
window.SBAC.config = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
