/* SBAC Compiler — Phase 4: classroom pages
 *   #/classroom                         my classes (teach / study), create, join
 *   #/classroom/<cid>[?tab=]            class: teacher → work / students / scores; student → assignments
 *   #/classroom/<cid>/edit/<aid|new>    assignment editor (teacher)
 *   #/classroom/<cid>/a/<aid>           student: do the work · teacher: results (?mode=work to try it)
 */
(function (S) {
  'use strict';
  const U = S.util;
  const { h, icon, toast, modal, confirmBox, promptBox } = U;
  const cloud = S.cloud, C = S.classroom, store = S.store;
  const LEVELS = { easy: 'ง่าย', medium: 'ปานกลาง', hard: 'ยาก' };
  let root, route = null, token = 0, cm = null;

  const fmtDate = (t) => (t ? new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const isLate = (a, t) => a.due_at && new Date(t || Date.now()) > new Date(a.due_at);
  const savedName = () => store.get('displayName', '');
  const go = (hash) => { location.hash = hash; };
  const add = (el, ...kids) => el.append(...kids.filter((k) => k != null && k !== false));
  function loadingEl(text) { return h('div', { class: 'muted', style: { padding: '30px 0' } }, h('span', { class: 'spinner', style: { display: 'inline-block', width: '16px', height: '16px', verticalAlign: '-3px', marginRight: '8px' } }), text || 'กำลังโหลด…'); }
  function page(...children) { root.innerHTML = ''; root.classList.add('page-scroll'); const c = h('div', { class: 'container' }, children); root.append(c); return c; }
  function fail(e) { page(h('a', { class: 'back-link', href: '#/classroom' }, icon('arrowLeft'), 'ห้องเรียนของฉัน'), U.errorBox({ message: e.message || String(e) })); }

  /* ================= home ================= */
  async function renderHome() {
    const my = ++token;
    if (!cloud.enabled) return page(h('div', { class: 'empty' }, h('h2', null, 'ระบบบัญชียังไม่เปิดใช้งาน')));
    if (!cloud.loggedIn) {
      return page(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ห้องเรียน'), h('p', null, 'ครูสร้างห้องและมอบหมายงาน นักเรียนเข้าห้องด้วยรหัส ส่งงานแล้วระบบตรวจให้อัตโนมัติ'))),
        h('div', { class: 'banner' }, h('div', null, h('b', null, 'ต้องเข้าสู่ระบบก่อนใช้ห้องเรียน'), h('p', null, 'ทั้งครูและนักเรียนใช้บัญชีอีเมลของตัวเอง')),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('button', { class: 'btn', onclick: () => S.account.authDialog('signup') }, 'สมัครสมาชิก'),
            h('button', { class: 'btn btn-primary', onclick: () => S.account.authDialog('login') }, 'เข้าสู่ระบบ'))));
    }
    const c = page(h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'ห้องเรียน'), h('p', null, 'ครูสร้างห้องและมอบหมายงาน · นักเรียนเข้าห้องด้วยรหัส 6 ตัว')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: joinDialog }, icon('key'), 'เข้าห้องด้วยรหัส'),
        h('button', { class: 'btn btn-primary', onclick: createDialog }, icon('plus'), 'สร้างห้องเรียน'))), loadingEl());
    let classes;
    try { classes = await C.myClasses(); } catch (e) { if (my === token) fail(e); return; }
    if (my !== token) return;
    c.lastChild.remove();
    const teach = classes.filter((x) => x.role === 'teacher'), study = classes.filter((x) => x.role === 'student');
    const card = (x) => h('a', { class: 'card', href: '#/classroom/' + x.id, style: { color: 'var(--text)', textDecoration: 'none' } },
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        h('div', { class: 'card-ico', style: { background: x.role === 'teacher' ? 'var(--brand)' : 'var(--green)' } }, (x.name[0] || '?').toUpperCase()),
        h('div', null, h('h3', null, x.name), h('span', { class: 'muted small' }, x.role === 'teacher' ? 'รหัสเข้าห้อง ' + x.join_code : 'ชื่อในห้อง: ' + (x.my_name || '-')))));
    c.append(h('h2', { class: 'section-title' }, '👩‍🏫 ห้องที่ฉันสอน'));
    c.append(teach.length ? h('div', { class: 'cards' }, teach.map(card)) : h('p', { class: 'muted' }, 'ยังไม่มี — กด "สร้างห้องเรียน" เพื่อเริ่ม'));
    c.append(h('h2', { class: 'section-title' }, '🎒 ห้องที่ฉันเรียน'));
    c.append(study.length ? h('div', { class: 'cards' }, study.map(card)) : h('p', { class: 'muted' }, 'ยังไม่มี — ขอรหัส 6 ตัวจากครู แล้วกด "เข้าห้องด้วยรหัส"'));
  }

  async function createDialog() {
    const name = await promptBox('สร้างห้องเรียน', 'ชื่อห้อง เช่น ม.5/1 ฐานข้อมูล', '');
    if (!name) return;
    try { const c = await C.createClass(name.slice(0, 120)); toast('สร้างห้องแล้ว รหัสเข้าห้อง ' + c.join_code, 'ok'); go('#/classroom/' + c.id); } catch (e) { toast(e.message, 'err'); }
  }
  function joinDialog() {
    const code = h('input', { class: 'input', placeholder: 'เช่น K7Q2MX', maxlength: 6, style: { textTransform: 'uppercase', letterSpacing: '4px', fontFamily: 'var(--mono)', fontSize: '18px' } });
    const name = h('input', { class: 'input', placeholder: 'ชื่อ-นามสกุล และเลขที่', value: savedName(), maxlength: 80 });
    const msg = h('div', { class: 'auth-msg err', hidden: true });
    modal({
      title: 'เข้าห้องด้วยรหัส',
      body: h('div', null, h('label', { class: 'field', style: { marginBottom: '12px' } }, 'รหัสห้อง 6 ตัว (ขอจากครู)', code),
        h('label', { class: 'field', style: { marginBottom: '12px' } }, 'ชื่อที่ครูจะเห็น', name), msg),
      actions: [{ label: 'ยกเลิก' }, { label: 'เข้าห้อง', primary: true, onClick: async () => {
        const cv = code.value.trim().toUpperCase(), nv = name.value.trim();
        if (!/^[A-Z0-9]{6}$/.test(cv)) { msg.hidden = false; msg.textContent = 'รหัสห้องต้องเป็นตัวอักษร/ตัวเลข 6 ตัว'; return false; }
        if (!nv) { msg.hidden = false; msg.textContent = 'กรุณาใส่ชื่อ'; return false; }
        try { const id = await C.joinClass(cv, nv); store.set('displayName', nv); toast('เข้าห้องแล้ว', 'ok'); go('#/classroom/' + id); return true; } catch (e) { msg.hidden = false; msg.textContent = e.message; return false; }
      } }],
    });
  }

  /* ================= class ================= */
  async function renderClass(cid, tab) {
    const my = ++token;
    const c = page(h('a', { class: 'back-link', href: '#/classroom' }, icon('arrowLeft'), 'ห้องเรียนของฉัน'), loadingEl());
    let cls, assignments, members = [], subs = [];
    try {
      cls = await C.getClass(cid);
      assignments = await C.assignments(cid);
      if (cls.role === 'teacher') {
        members = await C.members(cid);
        subs = await C.classSubmissions(assignments.map((a) => a.id));
      } else subs = await C.mySubmissions(assignments.map((a) => a.id));
    } catch (e) { if (my === token) fail(e); return; }
    if (my !== token) return;
    c.lastChild.remove();
    if (cls.role === 'teacher') teacherClass(c, cls, assignments, members, subs, tab || 'work');
    else studentClass(c, cls, assignments, subs);
  }

  function teacherClass(c, cls, assignments, members, subs, tab) {
    const students = members.filter((m) => m.role === 'student');
    c.append(h('div', { class: 'page-head', style: { marginTop: '10px' } },
      h('div', null, h('div', { class: 'eyebrow' }, 'ห้องที่ฉันสอน'), h('h1', null, cls.name), h('p', null, `นักเรียน ${students.length} คน · งาน ${assignments.length} ชิ้น`)),
      h('div', { class: 'join-box' }, h('span', { class: 'muted small' }, 'รหัสเข้าห้อง'), h('b', { class: 'join-code' }, cls.join_code),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { class: 'btn btn-xs', onclick: () => U.copyText(cls.join_code).then(() => toast('คัดลอกรหัสแล้ว', 'ok')) }, icon('copy'), 'คัดลอก'),
          h('button', { class: 'btn btn-xs', onclick: () => classMenu(cls) }, icon('settings'), 'จัดการห้อง')))));
    const tabs = h('div', { class: 'subtabs' });
    [['work', 'งานที่มอบหมาย'], ['students', `นักเรียน (${students.length})`], ['scores', 'สมุดคะแนน']].forEach(([id, label]) =>
      tabs.append(h('button', { class: tab === id ? 'active' : '', onclick: () => go(`#/classroom/${cls.id}?tab=${id}`) }, label)));
    c.append(tabs);

    if (tab === 'work') {
      c.append(h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), h('a', { class: 'btn btn-primary btn-sm', href: `#/classroom/${cls.id}/edit/new` }, icon('plus'), 'สร้างงานใหม่')));
      if (!assignments.length) c.append(h('div', { class: 'empty' }, h('h2', null, 'ยังไม่มีงาน'), h('p', null, 'กด "สร้างงานใหม่" แล้วเลือกโจทย์จากคลัง หรือเขียนโจทย์เอง')));
      const list = h('div', { class: 'proj-list' });
      assignments.forEach((a) => {
        const done = new Set(subs.filter((s) => s.assignment_id === a.id && s.passed).map((s) => s.user_id + '|' + s.item_key));
        const total = a.items.length * students.length;
        list.append(h('div', { class: 'proj-row' },
          h('div', { class: 'proj-ico' }, icon('target')),
          h('div', { style: { minWidth: 0 } }, h('a', { class: 't', href: `#/classroom/${cls.id}/a/${a.id}`, style: { color: 'var(--text)' } }, a.title, a.published ? null : h('span', { class: 'badge medium', style: { marginLeft: '8px' } }, 'ฉบับร่าง')),
            h('div', { class: 'd' }, `${a.items.length} ข้อ · ${a.due_at ? 'ส่งภายใน ' + fmtDate(a.due_at) : 'ไม่กำหนดวันส่ง'} · ผ่านแล้ว ${done.size}/${total}`)),
          h('div', { class: 'acts' },
            h('a', { class: 'btn btn-sm', href: `#/classroom/${cls.id}/a/${a.id}` }, 'ดูผล'),
            h('a', { class: 'btn btn-sm', href: `#/classroom/${cls.id}/edit/${a.id}` }, 'แก้ไข'))));
      });
      c.append(list);
    } else if (tab === 'students') {
      c.append(h('p', { class: 'muted' }, 'ให้นักเรียนเข้าเว็บ → เมนู "ห้องเรียน" → "เข้าห้องด้วยรหัส" แล้วใส่รหัส ', h('b', null, cls.join_code)));
      if (!students.length) c.append(h('div', { class: 'muted' }, 'ยังไม่มีนักเรียนเข้าห้อง'));
      else c.append(U.dataGrid(['ชื่อ', 'เข้าห้องเมื่อ'], students.map((m) => [m.display_name || '(ไม่มีชื่อ)', fmtDate(m.joined_at)]), { rowNumbers: true }));
      const rm = h('div', { class: 'chips', style: { marginTop: '12px' } });
      students.forEach((m) => rm.append(h('button', { class: 'chip', title: 'นำออกจากห้อง', onclick: async () => {
        if (!(await confirmBox('นำนักเรียนออก', `นำ <b>${U.esc(m.display_name)}</b> ออกจากห้อง? (งานที่ส่งแล้วยังเก็บไว้ ถ้าเข้าห้องใหม่จะกลับมา)`, 'นำออก', true))) return;
        try { await C.removeMember(cls.id, m.user_id); renderClass(cls.id, 'students'); } catch (e) { toast(e.message, 'err'); }
      } }, '✕ ' + (m.display_name || 'ไม่มีชื่อ'))));
      if (students.length) c.append(h('p', { class: 'muted small', style: { marginTop: '14px' } }, 'คลิกชื่อด้านล่างเพื่อนำนักเรียนออกจากห้อง'), rm);
    } else {
      gradebook(c, cls, assignments, students, subs);
    }
  }

  function classMenu(cls) {
    modal({
      title: 'จัดการห้อง ' + cls.name,
      body: h('div', { style: { display: 'grid', gap: '10px' } },
        h('button', { class: 'btn', onclick: async () => { const n = await promptBox('เปลี่ยนชื่อห้อง', 'ชื่อห้อง', cls.name); if (n) { try { await C.renameClass(cls.id, n.slice(0, 120)); U.closeMenus(); renderClass(cls.id); } catch (e) { toast(e.message, 'err'); } } } }, 'เปลี่ยนชื่อห้อง'),
        h('button', { class: 'btn', onclick: async () => { if (await confirmBox('สร้างรหัสใหม่', 'รหัสเดิมจะใช้เข้าห้องไม่ได้อีก (นักเรียนที่อยู่ในห้องแล้วไม่กระทบ)', 'สร้างรหัสใหม่')) { try { const code = await C.newJoinCode(cls.id); toast('รหัสใหม่ ' + code, 'ok'); renderClass(cls.id); } catch (e) { toast(e.message, 'err'); } } } }, 'สร้างรหัสเข้าห้องใหม่'),
        h('button', { class: 'btn btn-danger', onclick: async () => {
          if (!(await confirmBox('ลบห้องเรียน', `ลบห้อง <b>${U.esc(cls.name)}</b> รวมงานและคะแนนทั้งหมด? <b>กู้คืนไม่ได้</b>`, 'ลบห้อง', true))) return;
          try { await C.deleteClass(cls.id); toast('ลบห้องแล้ว'); go('#/classroom'); } catch (e) { toast(e.message, 'err'); }
        } }, 'ลบห้องเรียน')),
    });
  }

  function studentClass(c, cls, assignments, subs) {
    c.append(h('div', { class: 'page-head', style: { marginTop: '10px' } },
      h('div', null, h('div', { class: 'eyebrow' }, 'ห้องที่ฉันเรียน'), h('h1', null, cls.name), h('p', null, `งาน ${assignments.length} ชิ้น`)),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-sm', onclick: async () => {
          const n = await promptBox('ชื่อที่ครูเห็น', 'ชื่อ-นามสกุล และเลขที่', savedName());
          if (!n) return;
          try { await C.setMyName(cls.id, n.slice(0, 80)); store.set('displayName', n); toast('เปลี่ยนชื่อแล้ว', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, 'เปลี่ยนชื่อที่ครูเห็น'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!(await confirmBox('ออกจากห้อง', `ออกจากห้อง <b>${U.esc(cls.name)}</b>?`, 'ออกจากห้อง', true))) return;
          try { await C.leaveClass(cls.id); go('#/classroom'); } catch (e) { toast(e.message, 'err'); }
        } }, 'ออกจากห้อง'))));
    if (!assignments.length) { c.append(h('div', { class: 'empty' }, h('h2', null, 'ยังไม่มีงาน'), h('p', null, 'เมื่อครูมอบหมายงานจะขึ้นที่นี่'))); return; }
    const list = h('div', { class: 'proj-list' });
    assignments.forEach((a) => {
      const mine = subs.filter((s) => s.assignment_id === a.id);
      const passed = mine.filter((s) => s.passed).length;
      const total = a.items.length;
      const status = passed >= total ? h('span', { class: 'badge easy' }, '✓ ครบแล้ว')
        : isLate(a) ? h('span', { class: 'badge hard' }, 'เลยกำหนด') : h('span', { class: 'badge medium' }, 'ยังไม่ครบ');
      list.append(h('div', { class: 'proj-row' },
        h('div', { class: 'proj-ico' }, icon('target')),
        h('div', { style: { minWidth: 0 } }, h('a', { class: 't', href: `#/classroom/${cls.id}/a/${a.id}`, style: { color: 'var(--text)' } }, a.title),
          h('div', { class: 'd' }, `${total} ข้อ · ผ่าน ${passed}/${total} · ${a.due_at ? 'ส่งภายใน ' + fmtDate(a.due_at) : 'ไม่กำหนดวันส่ง'}`)),
        h('div', { class: 'acts' }, status, h('a', { class: 'btn btn-sm btn-primary', href: `#/classroom/${cls.id}/a/${a.id}` }, passed ? 'ทำต่อ' : 'เริ่มทำ'))));
    });
    c.append(list);
  }

  /* ================= gradebook (teacher) — re-checks every submission in this browser ================= */
  const verifyCache = new Map();
  function verify(p, sub, solution) {
    const k = p.key + '|' + sub.code + '|' + (solution || '');
    if (!verifyCache.has(k)) verifyCache.set(k, C.grade(p, sub.code, solution).ok);
    return verifyCache.get(k);
  }
  async function verifyAll(assignments, subs, onProgress) {
    const keys = {};
    for (const a of assignments) { try { keys[a.id] = await C.getKeys(a.id); } catch (e) { keys[a.id] = {}; } }
    const res = new Map();
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const a = assignments.find((x) => x.id === s.assignment_id);
      const item = a && a.items.map(C.resolve).find((p) => p && p.key === s.item_key);
      if (item) res.set(s.assignment_id + '|' + s.user_id + '|' + s.item_key, verify(item, s, keys[a.id] && keys[a.id][item.key]));
      if (i % 15 === 14) { onProgress && onProgress(i + 1, subs.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    return { res, keys };
  }
  function gradebook(c, cls, assignments, students, subs) {
    if (!assignments.length || !students.length) { c.append(h('div', { class: 'muted' }, 'ยังไม่มีข้อมูลคะแนน (ต้องมีทั้งงานและนักเรียน)')); return; }
    const status = loadingEl('กำลังตรวจคำตอบซ้ำในเครื่องนี้…');
    c.append(status);
    verifyAll(assignments, subs, (n, t) => { status.lastChild.textContent = `กำลังตรวจคำตอบซ้ำ ${n}/${t}…`; }).then(({ res }) => {
      status.remove();
      const cols = ['นักเรียน'].concat(assignments.map((a) => a.title), ['รวม']);
      const totalItems = assignments.reduce((n, a) => n + a.items.length, 0);
      const rows = students.map((m) => {
        let sum = 0;
        const cells = assignments.map((a) => {
          let n = 0;
          a.items.forEach((it) => { const p = C.resolve(it); if (p && res.get(a.id + '|' + m.user_id + '|' + p.key)) n++; });
          sum += n;
          return `${n}/${a.items.length}`;
        });
        return [m.display_name || '(ไม่มีชื่อ)'].concat(cells, [`${sum}/${totalItems}`]);
      });
      const claimed = subs.filter((s) => s.passed && res.get(s.assignment_id + '|' + s.user_id + '|' + s.item_key) === false).length;
      c.append(h('div', { class: 'toolbar' },
        h('span', { class: 'muted small' }, 'คะแนน = จำนวนข้อที่ผ่าน โดยตรวจโค้ดของนักเรียนซ้ำในเครื่องของครู'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-sm', onclick: () => U.downloadText(`คะแนน-${cls.name}.csv`, U.toCSV(cols, rows), 'text/csv') }, icon('download'), 'ส่งออก CSV (Excel)')));
      if (claimed) c.append(h('div', { class: 'hint-box' }, `⚠ มี ${claimed} คำตอบที่บันทึกว่าผ่าน แต่ตรวจซ้ำแล้วไม่ผ่าน — ไม่นับคะแนน (ดูรายละเอียดในหน้าผลของแต่ละงาน)`));
      c.append(U.dataGrid(cols, rows, { big: true }));
    }).catch((e) => { status.replaceWith(U.errorBox({ message: e.message })); });
  }

  /* ================= assignment results (teacher) ================= */
  async function renderResults(cid, aid) {
    const my = ++token;
    const c = page(h('a', { class: 'back-link', href: '#/classroom/' + cid }, icon('arrowLeft'), 'กลับไปที่ห้อง'), loadingEl());
    let cls, a, members, subs, keys;
    try {
      cls = await C.getClass(cid);
      if (cls.role !== 'teacher') return renderWork(cid, aid);
      a = await C.getAssignment(aid);
      members = (await C.members(cid)).filter((m) => m.role === 'student');
      subs = await C.classSubmissions([aid]);
      keys = await C.getKeys(aid);
    } catch (e) { if (my === token) fail(e); return; }
    if (my !== token) return;
    c.lastChild.remove();
    const items = a.items.map(C.resolve).filter(Boolean);
    c.append(h('div', { class: 'page-head', style: { marginTop: '10px' } },
      h('div', null, h('div', { class: 'eyebrow' }, cls.name), h('h1', null, a.title),
        h('p', null, `${items.length} ข้อ · ${a.due_at ? 'ส่งภายใน ' + fmtDate(a.due_at) : 'ไม่กำหนดวันส่ง'} · ${a.published ? 'นักเรียนเห็นแล้ว' : 'ฉบับร่าง (นักเรียนยังไม่เห็น)'}`)),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('a', { class: 'btn btn-sm', href: `#/classroom/${cid}/a/${aid}?mode=work` }, icon('play'), 'ลองทำแบบนักเรียน'),
        h('a', { class: 'btn btn-sm btn-primary', href: `#/classroom/${cid}/edit/${aid}` }, 'แก้ไขงาน'))));
    if (!members.length) { c.append(h('div', { class: 'muted' }, 'ยังไม่มีนักเรียนในห้อง')); return; }
    const table = h('table', { class: 'grid big' });
    const head = h('tr', null, h('th', null, 'นักเรียน'), items.map((p, i) => h('th', { title: p.title }, `ข้อ ${i + 1}`)), h('th', null, 'ผ่าน'));
    const tbody = h('tbody');
    const perItem = items.map(() => 0);
    members.forEach((m) => {
      let n = 0;
      const tr = h('tr', null, h('td', { style: { fontFamily: 'var(--font)' } }, m.display_name || '(ไม่มีชื่อ)'));
      items.forEach((p, i) => {
        const s = subs.find((x) => x.user_id === m.user_id && x.item_key === p.key);
        let mark = '–', color = 'var(--muted)', title = 'ยังไม่ส่ง';
        if (s) {
          const ok = verify(p, s, keys[p.key]);
          if (ok) { n++; perItem[i]++; }
          mark = ok ? '✓' : (s.passed ? '⚠' : '✗');
          color = ok ? 'var(--ok)' : 'var(--err)';
          title = (ok ? 'ผ่าน' : s.passed ? 'บันทึกว่าผ่าน แต่ตรวจซ้ำไม่ผ่าน' : 'ยังไม่ผ่าน') + ' · ส่ง ' + fmtDate(s.submitted_at) + (isLate(a, s.submitted_at) ? ' (เลยกำหนด)' : '');
        }
        tr.append(h('td', { style: { textAlign: 'center', color, cursor: s ? 'pointer' : 'default', fontWeight: '700' }, title, onclick: s ? () => showSubmission(m, p, s, keys[p.key], a) : null }, mark + (s && isLate(a, s.submitted_at) ? '⏰' : '')));
      });
      tr.append(h('td', { class: 'num' }, `${n}/${items.length}`));
      tbody.append(tr);
    });
    tbody.append(h('tr', null, h('td', { style: { fontFamily: 'var(--font)', fontWeight: '600' } }, 'ผ่านทั้งห้อง'),
      perItem.map((n) => h('td', { style: { textAlign: 'center' } }, `${Math.round((n / members.length) * 100)}%`)), h('td')));
    table.append(h('thead', null, head), tbody);
    c.append(h('p', { class: 'muted small' }, '✓ ผ่าน · ✗ ส่งแล้วยังไม่ผ่าน · ⚠ บันทึกว่าผ่านแต่ตรวจซ้ำไม่ผ่าน · ⏰ ส่งเลยกำหนด · คลิกเครื่องหมายเพื่อดูโค้ด'));
    c.append(h('div', { class: 'grid-wrap' }, table));
    c.append(h('h2', { class: 'section-title' }, 'โจทย์ในงานนี้'));
    items.forEach((p, i) => c.append(h('div', { class: 'proj-row', style: { marginBottom: '8px' } }, h('div', { class: 'ex-num' }, String(i + 1)),
      h('div', null, h('div', { class: 't' }, p.title), h('div', { class: 'd', html: p.prompt })), h('span', { class: 'badge ' + p.level }, LEVELS[p.level] || ''))));
  }
  function showSubmission(m, p, s, solution, a) {
    const g = C.grade(p, s.code, solution);
    modal({
      title: `${m.display_name} — ${p.title}`, wide: true,
      body: h('div', null,
        h('p', { class: 'muted small' }, 'ส่งเมื่อ ' + fmtDate(s.submitted_at) + (isLate(a, s.submitted_at) ? ' (เลยกำหนด)' : '')),
        h('pre', { class: 'code-block' }, s.code || '(ว่าง)'),
        h('div', { class: 'verdict ' + (g.ok ? 'ok' : 'bad'), style: { marginTop: '12px' } }, g.ok ? 'ตรวจซ้ำแล้ว: ถูกต้อง' : 'ตรวจซ้ำแล้ว: ' + g.verdict.reason),
        g.user ? h('div', null, h('div', { class: 'out-label' }, 'ผลลัพธ์ของนักเรียน'), U.dataGrid(g.user.columns, g.user.rows)) : U.renderItems(g.result.items.filter((i) => i.kind === 'error'))),
    });
  }

  /* ================= assignment editor (teacher) ================= */
  async function renderEditor(cid, aid) {
    const my = ++token;
    const c = page(h('a', { class: 'back-link', href: '#/classroom/' + cid }, icon('arrowLeft'), 'กลับไปที่ห้อง'), loadingEl());
    let cls, a = null, keys = {};
    try {
      cls = await C.getClass(cid);
      if (cls.role !== 'teacher') throw new Error('เฉพาะครูของห้องนี้เท่านั้น');
      if (aid !== 'new') { a = await C.getAssignment(aid); keys = await C.getKeys(aid); }
    } catch (e) { if (my === token) fail(e); return; }
    if (my !== token) return;
    c.lastChild.remove();
    const st = {
      title: a ? a.title : '', description: a ? a.description : '', due: a && a.due_at ? toLocalInput(a.due_at) : '',
      published: a ? a.published : true, show_expected: a ? a.show_expected : true,
      items: a ? JSON.parse(JSON.stringify(a.items)) : [], solutions: Object.assign({}, keys),
    };
    const title = h('input', { class: 'input', value: st.title, placeholder: 'เช่น งานที่ 1: SELECT และ WHERE', maxlength: 160 });
    const desc = h('textarea', { class: 'textarea', rows: 3, placeholder: 'คำอธิบาย/คำสั่งสำหรับนักเรียน (ไม่บังคับ)', style: { fontFamily: 'var(--font)', fontSize: '14px' } });
    desc.value = st.description;
    const due = h('input', { class: 'input', type: 'datetime-local', value: st.due, style: { maxWidth: '260px' } });
    const pub = h('input', { type: 'checkbox', checked: st.published });
    const showExp = h('input', { type: 'checkbox', checked: st.show_expected });
    const itemsBox = h('div', { class: 'proj-list' });
    function drawItems() {
      itemsBox.innerHTML = '';
      if (!st.items.length) itemsBox.append(h('div', { class: 'muted' }, 'ยังไม่มีโจทย์ — เพิ่มจากคลังโจทย์หรือเขียนโจทย์เอง'));
      st.items.forEach((it, i) => {
        const p = C.resolve(it);
        itemsBox.append(h('div', { class: 'proj-row' },
          h('div', { class: 'ex-num' }, String(i + 1)),
          h('div', { style: { minWidth: 0 } }, h('div', { class: 't' }, p ? p.title : '(ไม่พบโจทย์)'),
            h('div', { class: 'd' }, (it.type === 'bank' ? 'คลังโจทย์ · ' : 'โจทย์ของครู · ') + (p ? (LEVELS[p.level] || '') + ' · ' + (p.dataset ? S.datasets[p.dataset].name : 'ข้อมูลกำหนดเอง') : ''))),
          h('div', { class: 'acts' },
            h('button', { class: 'btn btn-xs', disabled: i === 0, onclick: () => { st.items.splice(i - 1, 0, st.items.splice(i, 1)[0]); drawItems(); } }, '↑'),
            h('button', { class: 'btn btn-xs', disabled: i === st.items.length - 1, onclick: () => { st.items.splice(i + 1, 0, st.items.splice(i, 1)[0]); drawItems(); } }, '↓'),
            it.type === 'custom' ? h('button', { class: 'btn btn-xs', onclick: () => customDialog(st, it, drawItems) }, 'แก้ไข') : null,
            h('button', { class: 'btn btn-xs btn-danger', onclick: () => { st.items.splice(i, 1); drawItems(); } }, icon('trash')))));
      });
    }
    drawItems();
    c.append(h('div', { class: 'page-head', style: { marginTop: '10px' } }, h('div', null, h('div', { class: 'eyebrow' }, cls.name), h('h1', null, a ? 'แก้ไขงาน' : 'สร้างงานใหม่'))));
    c.append(h('div', { style: { display: 'grid', gap: '14px', maxWidth: '820px' } },
      h('label', { class: 'field' }, 'ชื่องาน', title),
      h('label', { class: 'field' }, 'คำอธิบาย', desc),
      h('label', { class: 'field' }, 'กำหนดส่ง (ไม่บังคับ — เลยกำหนดยังส่งได้ แต่จะถูกทำเครื่องหมาย ⏰)', due),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, pub, 'เผยแพร่ให้นักเรียนเห็น (ไม่ติ๊ก = เก็บเป็นฉบับร่าง)'),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, showExp, 'ให้นักเรียนดู "ผลลัพธ์ที่ควรได้" ของแต่ละข้อ')));
    c.append(h('h2', { class: 'section-title' }, 'โจทย์'), itemsBox,
      h('div', { class: 'toolbar', style: { marginTop: '12px' } },
        h('button', { class: 'btn btn-sm', onclick: () => bankDialog(st, drawItems) }, icon('plus'), 'เพิ่มจากคลังโจทย์'),
        h('button', { class: 'btn btn-sm', onclick: () => customDialog(st, null, drawItems) }, icon('code'), 'เขียนโจทย์เอง')));
    const saveBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
      if (!title.value.trim()) return toast('ใส่ชื่องาน', 'err');
      if (!st.items.length) return toast('ต้องมีโจทย์อย่างน้อย 1 ข้อ', 'err');
      saveBtn.disabled = true;
      try {
        const saved = await C.saveAssignment({
          id: a ? a.id : null, class_id: cid, title: title.value.trim(), description: desc.value.trim(),
          due_at: due.value ? new Date(due.value).toISOString() : null, published: pub.checked, show_expected: showExp.checked, items: st.items,
        }, st.solutions);
        toast('บันทึกงานแล้ว', 'ok');
        go(`#/classroom/${cid}/a/${saved.id}`);
      } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
    } }, icon('save'), 'บันทึกงาน');
    c.append(h('div', { class: 'toolbar', style: { marginTop: '28px', paddingTop: '16px', borderTop: '1px solid var(--line)' } },
      saveBtn,
      a ? h('button', { class: 'btn btn-danger', onclick: async () => {
        if (!(await confirmBox('ลบงาน', `ลบงาน <b>${U.esc(a.title)}</b> และงานที่นักเรียนส่งทั้งหมด? กู้คืนไม่ได้`, 'ลบงาน', true))) return;
        try { await C.deleteAssignment(a.id); go('#/classroom/' + cid); } catch (e) { toast(e.message, 'err'); }
      } }, icon('trash'), 'ลบงาน') : null));
  }
  function toLocalInput(iso) {
    const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function bankDialog(st, redraw) {
    const chosen = new Set(st.items.filter((i) => i.type === 'bank').map((i) => i.id));
    const list = h('div', { style: { display: 'grid', gap: '6px', maxHeight: '55vh', overflow: 'auto' } });
    ['easy', 'medium', 'hard'].forEach((lv) => {
      list.append(h('div', { class: 'side-section' }, LEVELS[lv]));
      S.exercises.filter((e) => e.level === lv).forEach((e) => {
        const cb = h('input', { type: 'checkbox', checked: chosen.has(e.id), onchange: (ev) => { if (ev.target.checked) chosen.add(e.id); else chosen.delete(e.id); } });
        list.append(h('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '6px 4px', cursor: 'pointer' } }, cb,
          h('div', null, h('b', null, e.title), h('div', { class: 'muted small' }, `${e.topic} · ${S.datasets[e.dataset].name}`))));
      });
    });
    modal({
      title: 'เลือกโจทย์จากคลัง', body: list, wide: true,
      actions: [{ label: 'ยกเลิก' }, { label: 'ใช้โจทย์ที่เลือก', primary: true, onClick: () => {
        st.items = st.items.filter((i) => i.type !== 'bank' || chosen.has(i.id));
        S.exercises.forEach((e) => { if (chosen.has(e.id) && !st.items.some((i) => i.type === 'bank' && i.id === e.id)) st.items.push({ type: 'bank', id: e.id }); });
        redraw();
      } }],
    });
  }

  function customDialog(st, existing, redraw) {
    const it = existing || { type: 'custom', key: 'c' + Date.now().toString(36), title: '', prompt: '', level: 'medium', dataset: 'shop', setup: null, ordered: false, check: null };
    const title = h('input', { class: 'input', value: it.title, placeholder: 'ชื่อโจทย์' });
    const prompt = h('textarea', { class: 'textarea', rows: 3, placeholder: 'โจทย์ เช่น แสดงชื่อลูกค้าที่อยู่ประเทศ UK', style: { fontFamily: 'var(--font)', fontSize: '14px' } });
    prompt.value = (it.prompt || '').replace(/<[^>]+>/g, '');
    const level = h('select', { class: 'select' }, Object.entries(LEVELS).map(([k, v]) => h('option', { value: k, selected: it.level === k }, v)));
    const ds = h('select', { class: 'select' }, Object.values(S.datasets).map((d) => h('option', { value: d.id, selected: it.dataset === d.id }, d.name)), h('option', { value: '__custom', selected: !it.dataset }, 'กำหนดเอง (เขียน SQL สร้างตาราง)'));
    const setupHost = h('div', { class: 'runner', style: { margin: '0' } });
    const solHost = h('div', { class: 'runner', style: { margin: '0' } });
    const checkInput = h('input', { class: 'input', value: it.check || '', placeholder: 'เช่น SELECT * FROM Customers ORDER BY customer_id;' });
    const ordered = h('input', { type: 'checkbox', checked: !!it.ordered });
    const out = h('div');
    const setupWrap = h('label', { class: 'field' }, 'SQL สร้างตารางและข้อมูลตั้งต้น', setupHost);
    const toggleSetup = () => { setupWrap.hidden = ds.value !== '__custom'; };
    ds.addEventListener('change', toggleSetup);
    let setupCm, solCm;
    const current = () => ({
      key: it.key, type: 'custom', title: title.value.trim(), prompt: U.esc(prompt.value.trim()).replace(/\n/g, '<br>'), level: level.value,
      dataset: ds.value === '__custom' ? null : ds.value, setup: ds.value === '__custom' ? setupCm.getValue() : null,
      ordered: ordered.checked, check: checkInput.value.trim() || null,
    });
    const test = () => {
      const p = C.resolve(current());
      const r = C.runProblem(p, solCm.getValue());
      out.innerHTML = '';
      if (!r.ok || (p.check && r.check && !r.check.ok)) { out.append(U.renderItems((r.check || r).items.filter((x) => x.kind === 'error'))); return null; }
      const t = C.resultTable(p, r);
      if (!t) { out.append(U.errorBox({ message: 'เฉลยต้องจบด้วย SELECT (หรือกรอกช่อง "คำสั่งตรวจ")' })); return null; }
      out.append(h('div', { class: 'out-label' }, `ผลลัพธ์ที่ควรได้ · ${t.rows.length} แถว`), U.dataGrid(t.columns, t.rows));
      return t;
    };
    modal({
      title: existing ? 'แก้ไขโจทย์' : 'เขียนโจทย์เอง', wide: true,
      body: h('div', { style: { display: 'grid', gap: '12px' } },
        h('label', { class: 'field' }, 'ชื่อโจทย์', title),
        h('label', { class: 'field' }, 'โจทย์ (นักเรียนเห็น)', prompt),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, h('label', { class: 'field' }, 'ระดับ', level), h('label', { class: 'field' }, 'ข้อมูลที่ใช้', ds)),
        setupWrap,
        h('label', { class: 'field' }, 'เฉลย (นักเรียนไม่เห็น — ใช้คำนวณผลลัพธ์ที่ควรได้)', solHost),
        h('label', { class: 'field' }, 'คำสั่งตรวจ (ไม่บังคับ — สำหรับโจทย์ INSERT/UPDATE/CREATE: รันหลังโค้ดนักเรียนแล้วเทียบผล)', checkInput),
        h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, ordered, 'ต้องเรียงลำดับแถวให้ตรง (ORDER BY)'),
        h('div', null, h('button', { class: 'btn btn-sm', onclick: test }, icon('play'), 'ทดลองรันเฉลย')), out),
      actions: [{ label: 'ยกเลิก' }, { label: existing ? 'บันทึกโจทย์' : 'เพิ่มโจทย์', primary: true, onClick: () => {
        const cur = current();
        if (!cur.title || !prompt.value.trim()) { toast('ใส่ชื่อโจทย์และโจทย์', 'err'); return false; }
        const t = test();
        if (!t) { toast('เฉลยยังรันไม่ผ่าน', 'err'); return false; }
        cur.expected = { columns: t.columns, rows: t.rows };
        st.solutions[cur.key] = solCm.getValue();
        if (existing) Object.assign(existing, cur); else st.items.push(cur);
        redraw();
        return true;
      } }],
    });
    setTimeout(() => {
      setupCm = U.codeEditor(setupHost, { value: it.setup || 'CREATE TABLE Items (\n    id INT PRIMARY KEY,\n    name NVARCHAR(50)\n);\nINSERT INTO Items VALUES (1, N\'ปากกา\'), (2, N\'สมุด\');\n', cm: { viewportMargin: Infinity } });
      solCm = U.codeEditor(solHost, { value: st.solutions[it.key] || 'SELECT * FROM Customers;', cm: { viewportMargin: Infinity } });
      toggleSetup();
    }, 30);
  }

  /* ================= work page (student, or teacher trying it) ================= */
  async function renderWork(cid, aid, startKey) {
    const my = ++token;
    root.innerHTML = '';
    root.append(h('div', { class: 'container' }, loadingEl()));
    let cls, a, subs, keys = {};
    try {
      cls = await C.getClass(cid);
      a = await C.getAssignment(aid);
      subs = await C.mySubmissions([aid]);
      if (cls.role === 'teacher') keys = await C.getKeys(aid);
    } catch (e) { if (my === token) fail(e); return; }
    if (my !== token) return;
    const items = a.items.map(C.resolve).filter(Boolean);
    if (!items.length) return fail(new Error('งานนี้ยังไม่มีโจทย์'));
    let cur = items.find((p) => p.key === startKey) || items.find((p) => !subs.some((s) => s.item_key === p.key && s.passed)) || items[0];
    const draftKey = (p) => `draft:${aid}:${p.key}`;
    const subOf = (p) => subs.find((s) => s.item_key === p.key);

    root.innerHTML = '';
    root.classList.remove('page-scroll');
    const left = h('div', { class: 'left' });
    const host = h('div', { class: 'ex-editor' });
    const out = h('div', { class: 'ex-out' });
    const actions = h('div', { class: 'ex-actions' });
    root.append(h('div', { class: 'ex-detail' }, left, h('div', { class: 'right' }, host, actions, out)));
    cm = U.codeEditor(host, { value: '', onRun: () => run() });
    cm.on('change', U.debounce(() => store.set(draftKey(cur), cm.getValue()), 400));

    function drawLeft() {
      left.innerHTML = '';
      const passedN = items.filter((p) => (subOf(p) || {}).passed).length;
      add(left, h('a', { class: 'back-link', href: cls.role === 'teacher' ? `#/classroom/${cid}/a/${aid}` : `#/classroom/${cid}` }, icon('arrowLeft'), cls.role === 'teacher' ? 'กลับไปหน้าผล' : cls.name),
        h('h1', null, a.title),
        h('p', { class: 'muted small' }, `ผ่าน ${passedN}/${items.length} ข้อ` + (a.due_at ? ` · ส่งภายใน ${fmtDate(a.due_at)}` + (isLate(a) ? ' (เลยกำหนดแล้ว ยังส่งได้แต่จะถูกทำเครื่องหมาย)' : '') : '') + (cls.role === 'teacher' ? ' · โหมดครูทดลองทำ' : '')),
        a.description ? h('div', { class: 'callout' }, a.description) : null);
      const nav = h('div', { class: 'chips', style: { margin: '10px 0 16px' } });
      items.forEach((p, i) => {
        const s = subOf(p);
        nav.append(h('button', { class: 'chip' + (p.key === cur.key ? ' active' : ''), title: p.title, onclick: () => select(p) }, (s && s.passed ? '✓ ' : s ? '✗ ' : '') + `ข้อ ${i + 1}`));
      });
      add(left, nav,
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'badge ' + cur.level }, LEVELS[cur.level] || ''), h('b', null, cur.title)),
        h('div', { class: 'ex-prompt', style: { margin: '10px 0' }, html: cur.prompt }),
        cur.check ? h('p', { class: 'muted small' }, 'ข้อนี้ตรวจจากข้อมูลในตารางหลังโค้ดทำงาน — ไม่ต้อง SELECT เอง') : null);
      if (a.show_expected || cls.role === 'teacher') {
        const exp = h('details', { class: 'dataset-box' }, h('summary', null, 'ผลลัพธ์ที่ควรได้'));
        exp.addEventListener('toggle', () => {
          if (!exp.open || exp.children.length > 1) return;
          const t = C.expectedOf(cur, keys[cur.key]);
          exp.append(t ? h('div', null, h('p', { class: 'muted small' }, `${t.rows.length} แถว · ${cur.ordered ? 'ต้องเรียงตามนี้' : 'ลำดับแถวไม่สำคัญ'}`), U.dataGrid(t.columns, t.rows)) : h('p', null, '-'));
        });
        add(left, exp);
      }
      const dsBox = h('details', { class: 'dataset-box', open: true }, h('summary', null, 'ตารางที่ใช้'));
      dsBox.append(C.datasetTablesEl(cur, 12));
      add(left, dsBox);
    }
    function drawActions() {
      actions.innerHTML = '';
      const s = subOf(cur);
      add(actions, 
        h('button', { class: 'btn btn-sm', onclick: run, title: 'Ctrl + Enter' }, icon('play'), 'รัน'),
        h('button', { class: 'btn btn-sm btn-run', onclick: submit }, icon('check'), 'ส่งคำตอบ'),
        h('span', { class: 'grow' }),
        s ? h('span', { class: 'muted small' }, (s.passed ? '✓ ผ่านแล้ว · ' : 'ส่งล่าสุด · ') + fmtDate(s.submitted_at)) : h('span', { class: 'muted small' }, 'ยังไม่ส่ง'),
        cur.hint ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => out.prepend(h('div', { class: 'hint-box' }, '💡 ' + cur.hint)) }, icon('bulb'), 'คำใบ้') : null);
    }
    function select(p) {
      cur = p;
      const s = subOf(p);
      cm.setValue(store.get(draftKey(p), null) ?? (s ? s.code : `-- ${p.title}\n-- เขียนคำตอบด้านล่าง แล้วกด "ส่งคำตอบ"\n\n`));
      cm.setOption('hintOptions', { tables: {}, completeSingle: false });
      out.innerHTML = '';
      out.append(h('div', { class: 'out-placeholder' }, 'กด "รัน" เพื่อลองดูผล หรือ "ส่งคำตอบ" เพื่อส่งให้ครู'));
      drawLeft(); drawActions();
      setTimeout(() => { cm.refresh(); cm.focus(); cm.setCursor(cm.lineCount(), 0); }, 0);
    }
    function run() {
      const r = C.runProblem(cur, cm.getValue());
      out.innerHTML = '';
      out.append(h('div', { class: 'out-label' }, 'Output:', h('span', { class: 'run-meta' }, `${r.statements} คำสั่ง · ${Math.max(1, Math.round(r.ms))} ms`)),
        U.renderItems(cur.check && r.check ? r.items.concat(r.check.items) : r.items));
    }
    async function submit() {
      const code = cm.getValue();
      const g = C.grade(cur, code, keys[cur.key]);
      out.innerHTML = '';
      if (g.ok) out.append(h('div', { class: 'verdict ok' }, icon('checkCircle'), h('div', null, 'ถูกต้อง! กำลังส่งให้ครู…')));
      else out.append(h('div', { class: 'verdict bad' }, icon('xCircle'), h('div', null, g.verdict.reason, g.verdict.sub ? h('div', { class: 'sub' }, g.verdict.sub) : null, h('div', { class: 'sub' }, 'ระบบบันทึกคำตอบล่าสุดไว้ แก้แล้วส่งใหม่ได้เรื่อย ๆ'))));
      if (!g.result.ok) out.append(U.renderItems(g.result.items.filter((i) => i.kind === 'error')));
      if (g.user) out.append(h('div', { class: 'out-label' }, 'ผลลัพธ์ของคุณ'), U.dataGrid(g.user.columns, g.user.rows));
      try {
        const saved = await C.submit(aid, cur.key, code, g.ok);
        subs = subs.filter((s) => s.item_key !== cur.key).concat([saved]);
        store.remove(draftKey(cur));
        const v = out.querySelector('.verdict.ok div');
        if (v) v.firstChild.textContent = 'ถูกต้อง! ส่งให้ครูแล้ว 🎉';
        drawLeft(); drawActions();
        const next = items.find((p) => !(subOf(p) || {}).passed);
        if (g.ok && next) out.insertBefore(h('button', { class: 'btn btn-primary btn-sm', style: { margin: '0 0 12px' }, onclick: () => select(next) }, 'ข้อถัดไป', icon('arrowRight')), out.children[1] || null);
        if (g.ok && !next) out.insertBefore(h('div', { class: 'hint-box' }, '🎉 ทำผ่านครบทุกข้อในงานนี้แล้ว'), out.children[1] || null);
      } catch (e) { toast('ส่งไม่สำเร็จ: ' + e.message, 'err'); }
    }
    select(cur);
  }

  /* ================= router ================= */
  S.pages = S.pages || {};
  S.pages.classroom = {
    init(el) {
      root = el;
      cloud.on((type) => { if (type === 'auth' && !root.hidden && route) S.pages.classroom.show(route); });
    },
    show(r) {
      route = r;
      cm = null;
      const [cid, sub, aid] = r.params;
      if (!cid) return renderHome();
      if (!cloud.loggedIn) return renderHome();
      if (sub === 'edit' && aid) return renderEditor(cid, aid);
      if (sub === 'a' && aid) return r.query.get('mode') === 'work' ? renderWork(cid, aid) : renderResults(cid, aid);
      return renderClass(cid, r.query.get('tab'));
    },
    onTheme() { if (cm) cm.refresh(); },
  };
})(window.SBAC);
