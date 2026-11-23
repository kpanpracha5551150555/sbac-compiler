/* SBAC Compiler — Phase 4: classroom data layer (Supabase) + problem helpers */
(function (S) {
  'use strict';
  const cloud = S.cloud, engine = S.engine;

  const ERR = [
    [/class not found/i, 'ไม่พบห้องเรียนที่ใช้รหัสนี้ — ตรวจสอบรหัส 6 ตัวอีกครั้ง'],
    [/display name required/i, 'กรุณาใส่ชื่อที่จะให้ครูเห็น'],
    [/class limit reached/i, 'สร้างห้องเรียนได้สูงสุด 50 ห้อง'],
    [/relation .* does not exist|Could not find the (table|function)/i, 'ระบบห้องเรียนยังไม่ได้ติดตั้งบนฐานข้อมูล — ต้องรัน supabase/classroom.sql ก่อน'],
    [/permission denied/i, 'ไม่มีสิทธิ์ทำรายการนี้'],
  ];
  function check(res) {
    if (res.error) {
      const raw = String(res.error.message || res.error);
      for (const [re, th] of ERR) if (re.test(raw)) throw new Error(th);
      throw new Error(cloud.thai(res.error));
    }
    return res.data;
  }
  const db = () => cloud.client;
  const me = () => (cloud.user ? cloud.user.id : null);
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newCode() {
    const a = new Uint8Array(6); crypto.getRandomValues(a);
    return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  }

  const api = {
    /* ---------- classes ---------- */
    async myClasses() {
      const rows = check(await db().from('class_members').select('role, display_name, classes(id, name, join_code, owner_id, created_at)').eq('user_id', me()));
      return rows.filter((r) => r.classes).map((r) => Object.assign({}, r.classes, { role: r.classes.owner_id === me() ? 'teacher' : 'student', my_name: r.display_name }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    async getClass(id) {
      const c = check(await db().from('classes').select('*').eq('id', id).maybeSingle());
      if (!c) throw new Error('ไม่พบห้องเรียน หรือคุณไม่ได้อยู่ในห้องนี้');
      c.role = c.owner_id === me() ? 'teacher' : 'student';
      return c;
    },
    async createClass(name) {
      for (let i = 0; i < 5; i++) {
        const res = await db().from('classes').insert({ name, join_code: newCode() }).select('*').single();
        if (res.error && /duplicate key|unique/i.test(res.error.message)) continue;
        return check(res);
      }
      throw new Error('สร้างรหัสห้องไม่สำเร็จ ลองใหม่อีกครั้ง');
    },
    async renameClass(id, name) { check(await db().from('classes').update({ name }).eq('id', id)); },
    async newJoinCode(id) {
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const res = await db().from('classes').update({ join_code: code }).eq('id', id);
        if (res.error && /duplicate key|unique/i.test(res.error.message)) continue;
        check(res); return code;
      }
      throw new Error('สร้างรหัสใหม่ไม่สำเร็จ');
    },
    async deleteClass(id) { check(await db().from('classes').delete().eq('id', id)); },
    async joinClass(code, name) { return check(await db().rpc('join_class', { p_code: code, p_name: name })); },
    async leaveClass(id) { check(await db().from('class_members').delete().eq('class_id', id).eq('user_id', me())); },
    async members(classId) {
      return check(await db().from('class_members').select('user_id, role, display_name, joined_at').eq('class_id', classId).order('display_name'));
    },
    async removeMember(classId, userId) { check(await db().from('class_members').delete().eq('class_id', classId).eq('user_id', userId)); },
    async setMyName(classId, name) { check(await db().from('class_members').update({ display_name: name }).eq('class_id', classId).eq('user_id', me())); },

    /* ---------- assignments ---------- */
    async assignments(classId) {
      return check(await db().from('assignments').select('*').eq('class_id', classId).order('created_at', { ascending: true }));
    },
    async getAssignment(id) {
      const a = check(await db().from('assignments').select('*').eq('id', id).maybeSingle());
      if (!a) throw new Error('ไม่พบงานนี้');
      return a;
    },
    async getKeys(assignmentId) {
      const r = check(await db().from('assignment_keys').select('solutions').eq('assignment_id', assignmentId).maybeSingle());
      return r ? r.solutions : {};
    },
    /** Save assignment + private answer keys. a: {id?, class_id, title, description, due_at, published, show_expected, items}, solutions: {key: sql} */
    async saveAssignment(a, solutions) {
      const row = { class_id: a.class_id, title: a.title, description: a.description || '', due_at: a.due_at || null, published: !!a.published, show_expected: !!a.show_expected, items: a.items };
      const saved = a.id
        ? check(await db().from('assignments').update(row).eq('id', a.id).select('*').single())
        : check(await db().from('assignments').insert(row).select('*').single());
      check(await db().from('assignment_keys').upsert({ assignment_id: saved.id, solutions: solutions || {} }, { onConflict: 'assignment_id' }));
      return saved;
    },
    async deleteAssignment(id) { check(await db().from('assignments').delete().eq('id', id)); },

    /* ---------- submissions ---------- */
    async mySubmissions(assignmentIds) {
      if (!assignmentIds.length) return [];
      return check(await db().from('submissions').select('*').eq('user_id', me()).in('assignment_id', assignmentIds));
    },
    async classSubmissions(assignmentIds) {
      if (!assignmentIds.length) return [];
      return check(await db().from('submissions').select('*').in('assignment_id', assignmentIds));
    },
    async submit(assignmentId, itemKey, code, passed) {
      return check(await db().from('submissions').upsert({ assignment_id: assignmentId, user_id: me(), item_key: itemKey, code, passed, submitted_at: new Date().toISOString() }, { onConflict: 'assignment_id,user_id,item_key' }).select('*').single());
    },
  };

  /* ---------- problems: bank exercise or teacher-written ---------- */
  // item stored in assignments.items:
  //   { type: 'bank', id: 'e01' }
  //   { type: 'custom', key: 'c1', title, prompt, level, dataset | null, setup | null, ordered, check, expected: {columns, rows} }
  function resolve(item) {
    if (item.type === 'bank') {
      const ex = S.exercises.find((e) => e.id === item.id);
      if (!ex) return null;
      return { key: 'bank:' + ex.id, type: 'bank', title: ex.title, prompt: ex.prompt, level: ex.level, topic: ex.topic, dataset: ex.dataset, setup: null, ordered: !!ex.ordered, check: ex.check || null, solution: ex.solution, hint: ex.hint };
    }
    return { key: item.key, type: 'custom', title: item.title, prompt: item.prompt, level: item.level || 'medium', topic: 'โจทย์ของครู', dataset: item.dataset || null, setup: item.setup || null, ordered: !!item.ordered, check: item.check || null, expected: item.expected || null };
  }
  function runProblem(p, code) {
    return p.dataset ? engine.runIsolated(p.dataset, code, 'tsql', p.check) : engine.runWithSetup(p.setup || '', code, 'tsql', p.check);
  }
  const resultTable = (p, r) => engine.lastTable(p.check ? r.check : r);
  /** Expected table: from the stored snapshot (custom) or by running the solution (bank / teacher with key). */
  const expCache = new Map();
  function expectedOf(p, solution) {
    if (p.expected && !solution) return p.expected;
    const sol = solution || p.solution;
    if (!sol) return p.expected || null;
    const k = p.key + '\u0000' + sol + '\u0000' + (p.setup || p.dataset);
    if (!expCache.has(k)) { const r = runProblem(p, sol); expCache.set(k, r.ok ? resultTable(p, r) : null); }
    return expCache.get(k);
  }
  /** Grade code for a problem → {ok, verdict, user, expected, result} */
  function grade(p, code, solution) {
    const r = runProblem(p, code);
    const exp = expectedOf(p, solution);
    if (!r.ok || (p.check && r.check && !r.check.ok)) return { ok: false, verdict: { ok: false, reason: 'โค้ดมีข้อผิดพลาด' }, result: r, expected: exp };
    const ut = resultTable(p, r);
    const v = engine.compare(ut, exp, p.ordered);
    return { ok: v.ok, verdict: v, user: ut, expected: exp, result: r };
  }
  function datasetTablesEl(p, limit) {
    if (p.dataset) return S.renderDataset(p.dataset, limit);
    const U = S.util;
    const wrap = U.h('div');
    const db0 = engine.createDb();
    try {
      engine.execute(db0, p.setup || '', 'tsql');
      engine.schema(db0).forEach((t) => {
        const d = engine.tableData(db0, t.name, { limit });
        wrap.append(U.h('div', { class: 'tbl-card' }, U.h('h3', null, t.name, U.h('span', { class: 'meta' }, `${t.rowCount} แถว`)), U.dataGrid(d.columns, d.rows, { big: true })));
      });
    } finally { db0.close(); }
    if (!wrap.children.length) wrap.append(U.h('p', { class: 'muted' }, 'โจทย์นี้ไม่มีตารางตั้งต้น'));
    return wrap;
  }

  S.classroom = Object.assign(api, { resolve, runProblem, grade, expectedOf, resultTable, datasetTablesEl });
})(window.SBAC);
