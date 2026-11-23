/* SBAC Compiler — public configuration.
 * Supabase "Project URL" and "anon public" key (Project Settings → API).
 * The anon key is meant to be public: data is protected by Row Level Security (supabase/schema.sql).
 * Leave empty to run without accounts (everything stays in the browser). */
window.SBAC = window.SBAC || {};
window.SBAC.config = {
  supabaseUrl: 'https://vlumqwflljtauxnipqjj.supabase.co',
  supabaseAnonKey: 'sb_publishable_au2rPS2tO_7Hmlygp9CUwQ_k-ul-6Cl',
};
