/* SBAC Compiler — Phase 3: accounts and cloud storage (Supabase) */
(function (S) {
  'use strict';
  const U = S.util;
  const store = S.store;
  const cfg = S.config || {};
  const listeners = new Set();

  const ERRORS = [
    [/Invalid login credentials/i, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'],
    [/Email not confirmed/i, 'ยังไม่ได้ยืนยันอีเมล — เปิดลิงก์ยืนยันในอีเมลก่อน แล้วค่อยเข้าสู่ระบบ'],
    [/User already registered|already been registered/i, 'อีเมลนี้สมัครไว้แล้ว — ลองเข้าสู่ระบบ หรือกด "ลืมรหัสผ่าน"'],
    [/Password should be at least (\d+)/i, (m) => `รหัสผ่านต้องยาวอย่างน้อย ${m[1]} ตัวอักษร`],
    [/Unable to validate email address|invalid format|Email address .* is invalid/i, 'รูปแบบอีเมลไม่ถูกต้อง'],
    [/rate limit|too many requests|security purposes/i, 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่'],
    [/New password should be different/i, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม'],
    [/project limit reached/i, 'บันทึกได้สูงสุด 200 โปรเจกต์ — ลบโปรเจกต์ที่ไม่ใช้ก่อน'],
    [/Failed to fetch|NetworkError|network/i, 'เชื่อมต่ออินเทอร์เน็ตไม่ได้'],
    [/JWT expired|invalid JWT|not authenticated/i, 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่อีกครั้ง'],
  ];
  function thai(err) {
    const msg = String((err && (err.message || err.error_description)) || err || '');
    for (const [re, th] of ERRORS) { const m = re.exec(msg); if (m) return typeof th === 'function' ? th(m) : th; }
    return msg || 'เกิดข้อผิดพลาด';
  }
  function check(res) {
    if (res.error) { const e = new Error(thai(res.error)); e.raw = res.error; throw e; }
    return res.data;
  }
  const siteUrl = () => location.origin + location.pathname;

  const cloud = {
    enabled: false,
    client: null,
    user: null,
    status: 'off', // off | idle | saving | saved | error
    lastSaved: null,
    lastError: null,

    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(type, detail) { listeners.forEach((fn) => { try { fn(type, detail); } catch (e) { console.error(e); } }); },
    setStatus(s, err) { this.status = s; this.lastError = err || null; if (s === 'saved') this.lastSaved = new Date(); this.emit('status'); },

    async init() {
      this.enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
      if (!this.enabled) return;
      this.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      this.client.auth.onAuthStateChange((event, session) => {
        const before = this.user && this.user.id;
        this.user = session ? session.user : null;
        if (event === 'PASSWORD_RECOVERY') this.emit('recovery');
        if ((this.user && this.user.id) !== before) {
          this.setStatus(this.user ? 'idle' : 'off');
          this.emit('auth', event);
          if (this.user) this.afterLogin();
        }
      });
      try {
        const { data } = await this.client.auth.getSession();
        this.user = data.session ? data.session.user : null;
        this.setStatus(this.user ? 'idle' : 'off');
        if (this.user) this.afterLogin();
      } catch (e) { console.warn(e); }
      // ?code=… (email confirm / password reset) has been handled by supabase-js — clean the address bar
      const qs = new URLSearchParams(location.search);
      if (qs.has('code') || qs.has('error_description')) {
        if (qs.has('error_description')) U.toast(thai(qs.get('error_description')), 'err');
        history.replaceState(null, '', location.pathname + location.hash);
      }
    },
    get loggedIn() { return !!this.user; },
    get email() { return this.user ? this.user.email : ''; },

    /* ---------- auth ---------- */
    async signUp(email, password) {
      const data = check(await this.client.auth.signUp({ email, password, options: { emailRedirectTo: siteUrl() } }));
      return { needsConfirm: !data.session };
    },
    async signIn(email, password) { check(await this.client.auth.signInWithPassword({ email, password })); },
    async signOut() { check(await this.client.auth.signOut()); },
    async resetPassword(email) { check(await this.client.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() })); },
    async updatePassword(password) { check(await this.client.auth.updateUser({ password })); },

    /* ---------- projects ---------- */
    async listProjects() {
      return check(await this.client.from('projects').select('id, name, dialect, files, updated_at').order('updated_at', { ascending: false }));
    },
    async getProject(id) {
      return check(await this.client.from('projects').select('*').eq('id', id).single());
    },
    /** Insert (no id) or update (id). Returns the saved row {id, updated_at}. */
    async saveProject(p) {
      const row = { name: p.name, dialect: p.dialect, files: p.files };
      this.setStatus('saving');
      try {
        const res = p.id
          ? await this.client.from('projects').update(row).eq('id', p.id).select('id, updated_at').maybeSingle()
          : await this.client.from('projects').insert(row).select('id, updated_at').single();
        const data = check(res);
        if (!data) { // row was deleted elsewhere → create again
          const again = check(await this.client.from('projects').insert(row).select('id, updated_at').single());
          this.setStatus('saved');
          return again;
        }
        this.setStatus('saved');
        return data;
      } catch (e) { this.setStatus('error', e.message); throw e; }
    },
    async renameProject(id, name) { check(await this.client.from('projects').update({ name }).eq('id', id)); },
    async deleteProject(id) { check(await this.client.from('projects').delete().eq('id', id)); },

    /* ---------- progress (lessons / exercises) ---------- */
    async pullProgress() {
      const row = check(await this.client.from('progress').select('data').maybeSingle());
      return row ? row.data : null;
    },
    async pushProgress(data) {
      check(await this.client.from('progress').upsert({ user_id: this.user.id, data }, { onConflict: 'user_id' }));
    },
    queueProgress: U.debounce(function () {
      if (!cloud.loggedIn || cloud.mergingProgress) return;
      cloud.pushProgress(store.progress()).catch((e) => console.warn('progress sync', e));
    }, 1500),

    /** Merge cloud progress into this browser (a lesson/exercise done anywhere counts). */
    async afterLogin() {
      this.mergingProgress = true;
      try {
        const remote = (await this.pullProgress()) || {};
        const local = store.progress();
        const merged = { lessons: Object.assign({}, remote.lessons || {}, local.lessons || {}), exercises: {} };
        const ids = new Set([...Object.keys(remote.exercises || {}), ...Object.keys(local.exercises || {})]);
        ids.forEach((id) => {
          const a = (remote.exercises || {})[id] || {}, b = (local.exercises || {})[id] || {};
          const newer = (a.solvedAt || 0) > (b.solvedAt || 0) ? a : b;
          merged.exercises[id] = Object.assign({}, a, b, { solved: !!(a.solved || b.solved), code: newer.code || b.code || a.code, solvedAt: Math.max(a.solvedAt || 0, b.solvedAt || 0) || undefined });
        });
        store.set('progress', merged);
        await this.pushProgress(merged);
        this.emit('progress');
      } catch (e) { console.warn('progress merge', e); }
      finally { this.mergingProgress = false; }
    },
  };

  // push progress whenever it changes locally
  store.onSet = (key) => { if (key === 'progress' && cloud.loggedIn) cloud.queueProgress(); };

  cloud.thai = thai;
  S.cloud = cloud;
})(window.SBAC);
