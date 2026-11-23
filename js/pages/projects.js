/* SBAC Compiler — "งานของฉัน": cloud projects (when logged in) + projects saved in this browser */
(function (S) {
  'use strict';
  const U = S.util;
  const { h, icon, toast, confirmBox, promptBox } = U;
  const store = S.store, ws = S.ws, cloud = S.cloud, D = S.dialects;
  let root, cloudRows = null, loading = false, loadError = null;

  const when = (t) => new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const filesOf = (p) => (Array.isArray(p.files) ? p.files : []);

  async function fetchCloud() {
    if (!cloud.loggedIn) { cloudRows = null; return; }
    loading = true; loadError = null; render();
    try { cloudRows = await cloud.listProjects(); } catch (e) { loadError = e.message; cloudRows = []; }
    loading = false; render();
  }

  async function confirmReplace() {
    if (ws.data.cloudId && cloud.loggedIn) {
      // current work autosaves — flush it before switching
      try { await ws.saveToCloud(); } catch (e) { /* ignore */ }
      return true;
    }
    const hasWork = ws.files().some((f) => f.content.trim()) && !ws.data.projectId;
    if (!hasWork) return true;
    return confirmBox('เปิดโปรเจกต์', 'งานที่เปิดอยู่ตอนนี้ยังไม่ได้บันทึก — จะถูกแทนที่<br>ต้องการเปิดโปรเจกต์นี้ต่อไหม?', 'เปิด');
  }
  async function openCloud(row) {
    if (!(await confirmReplace())) return;
    try {
      const p = await cloud.getProject(row.id);
      await ws.openProject({ id: null, cloudId: p.id, name: p.name, dialect: p.dialect, files: filesOf(p) });
      S.pages.editor.resetOutput();
      location.hash = '#/editor';
      toast('เปิด ' + p.name, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }
  async function openLocal(p) {
    if (!(await confirmReplace())) return;
    await ws.openProject(p);
    S.pages.editor.resetOutput();
    location.hash = '#/editor';
  }
  async function uploadLocal(p, quiet) {
    const row = await cloud.saveProject({ name: p.name, dialect: p.dialect || 'tsql', files: p.files.map((f) => ({ name: f.name, content: f.content })) });
    p.cloudId = row.id;
    store.deleteProject(p.id);
    if (ws.data.projectId === p.id) { ws.data.projectId = null; ws.data.cloudId = row.id; ws.save(); }
    if (!quiet) toast('อัปโหลด ' + p.name + ' ขึ้นคลาวด์แล้ว', 'ok');
  }

  function render() {
    root.innerHTML = '';
    const c = h('div', { class: 'container' });
    root.append(c);
    c.append(h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'งานของฉัน'),
        h('p', null, cloud.loggedIn ? `บัญชี ${cloud.email} — งานบนคลาวด์เปิดได้จากทุกเครื่อง` : 'โปรเจกต์ที่บันทึกไว้')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('a', { class: 'btn', href: '#/templates' }, icon('plus'), 'เริ่มจากแม่แบบ'),
        cloud.loggedIn ? h('button', { class: 'btn', onclick: fetchCloud, title: 'โหลดรายการใหม่' }, icon('refresh')) : null)));

    if (!cloud.enabled) {
      c.append(h('div', { class: 'banner' }, h('div', null, h('b', null, 'ระบบบัญชียังไม่เปิดใช้งาน'),
        h('p', null, 'ตอนนี้งานเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น'))));
    } else if (!cloud.loggedIn) {
      c.append(h('div', { class: 'banner' },
        h('div', null, h('b', null, 'เข้าสู่ระบบเพื่อเก็บงานบนคลาวด์'), h('p', null, 'งานและความคืบหน้าบทเรียนจะตามไปทุกเครื่อง ไม่หายเมื่อล้างเบราว์เซอร์')),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { class: 'btn', onclick: () => S.account.authDialog('signup') }, 'สมัครสมาชิก'),
          h('button', { class: 'btn btn-primary', onclick: () => S.account.authDialog('login') }, 'เข้าสู่ระบบ'))));
    }

    // current workspace
    const cur = ws.data;
    const curState = cloud.loggedIn ? (cur.cloudId ? 'อยู่บนคลาวด์ · บันทึกอัตโนมัติ' : 'ยังไม่ได้บันทึกบนคลาวด์') : (cur.projectId ? 'บันทึกในเครื่องแล้ว' : 'ยังไม่ได้บันทึก');
    c.append(h('h2', { class: 'section-title' }, 'กำลังเปิดอยู่'));
    c.append(h('div', { class: 'proj-row current' },
      h('div', { class: 'proj-ico' }, icon('code')),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 't', onclick: () => { location.hash = '#/editor'; } }, cur.name || 'งานไม่มีชื่อ'),
        h('div', { class: 'd' }, `${cur.files.length} ไฟล์ · ${D.get(cur.dialect).short || D.get(cur.dialect).label} · ${curState}`)),
      h('div', { class: 'acts' },
        cloud.loggedIn && !cur.cloudId ? h('button', { class: 'btn btn-sm btn-primary', onclick: async () => {
          const name = await promptBox('บันทึกบนคลาวด์', 'ชื่อโปรเจกต์', cur.name || 'โปรเจกต์ของฉัน');
          if (!name) return;
          try { await ws.saveToCloud(name); toast('บันทึกบนคลาวด์แล้ว', 'ok'); fetchCloud(); } catch (e) { toast(e.message, 'err'); }
        } }, icon('save'), 'บันทึกขึ้นคลาวด์') : null,
        h('a', { class: 'btn btn-sm', href: '#/editor' }, 'ไปที่ Compiler'))));

    // cloud projects
    if (cloud.loggedIn) {
      c.append(h('h2', { class: 'section-title' }, '☁ บนคลาวด์', cloudRows ? h('span', { class: 'muted small' }, `${cloudRows.length} โปรเจกต์`) : null));
      if (loading && !cloudRows) c.append(h('div', { class: 'muted' }, 'กำลังโหลด…'));
      if (loadError) c.append(U.errorBox({ message: loadError }));
      if (cloudRows && !cloudRows.length && !loadError) c.append(h('div', { class: 'muted' }, 'ยังไม่มีงานบนคลาวด์ — กด Save (Ctrl + S) ในหน้า Compiler เพื่อบันทึกงานปัจจุบัน'));
      if (cloudRows) {
        const list = h('div', { class: 'proj-list' });
        cloudRows.forEach((row) => {
          const isCur = row.id === ws.data.cloudId;
          list.append(h('div', { class: 'proj-row' + (isCur ? ' current' : '') },
            h('div', { class: 'proj-ico' }, '☁'),
            h('div', { style: { minWidth: 0 } }, h('div', { class: 't', onclick: () => (isCur ? (location.hash = '#/editor') : openCloud(row)) }, row.name, isCur ? h('span', { class: 'muted small' }, ' · กำลังเปิดอยู่') : null),
              h('div', { class: 'd' }, `${filesOf(row).length} ไฟล์ · ${(D.get(row.dialect).short || row.dialect)} · แก้ไขล่าสุด ${when(row.updated_at)}`)),
            h('div', { class: 'acts' },
              isCur ? null : h('button', { class: 'btn btn-sm btn-primary', onclick: () => openCloud(row) }, 'เปิด'),
              h('button', { class: 'btn btn-sm', onclick: async () => {
                const name = await promptBox('เปลี่ยนชื่อ', 'ชื่อโปรเจกต์', row.name);
                if (!name || name === row.name) return;
                try { await cloud.renameProject(row.id, name); if (isCur) { ws.data.name = name; ws.save(); } fetchCloud(); } catch (e) { toast(e.message, 'err'); }
              } }, 'เปลี่ยนชื่อ'),
              h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
                if (!(await confirmBox('ลบโปรเจกต์', `ลบ <b>${U.esc(row.name)}</b> ออกจากคลาวด์? (กู้คืนไม่ได้)`, 'ลบ', true))) return;
                try {
                  await cloud.deleteProject(row.id);
                  if (isCur) { ws.data.cloudId = null; ws.save(); ws.emit('projects'); }
                  toast('ลบแล้ว', 'ok'); fetchCloud();
                } catch (e) { toast(e.message, 'err'); }
              } }, icon('trash')))));
        });
        c.append(list);
      }
    }

    // local projects
    const local = store.projects();
    if (local.length || !cloud.loggedIn) {
      c.append(h('h2', { class: 'section-title' }, '💻 ในเบราว์เซอร์เครื่องนี้', h('span', { class: 'muted small' }, `${local.length} โปรเจกต์`)));
      if (cloud.loggedIn && local.length) {
        c.append(h('div', { class: 'banner', style: { background: 'var(--warn-soft)' } },
          h('div', null, h('b', null, 'มีงานที่ยังอยู่แค่ในเครื่องนี้'), h('p', null, 'อัปโหลดขึ้นคลาวด์เพื่อเปิดจากเครื่องอื่นได้ (หลังอัปโหลดจะย้ายออกจากรายการในเครื่อง)')),
          h('button', { class: 'btn btn-primary btn-sm', onclick: async (e) => {
            e.currentTarget.disabled = true;
            let n = 0;
            for (const p of store.projects()) { try { await uploadLocal(p, true); n++; } catch (err) { toast(p.name + ': ' + err.message, 'err'); } }
            toast(`อัปโหลดขึ้นคลาวด์ ${n} โปรเจกต์`, 'ok');
            fetchCloud();
          } }, icon('upload'), 'อัปโหลดทั้งหมด')));
      }
      if (!local.length) c.append(h('div', { class: 'muted' }, 'ยังไม่มี — กด Save (Ctrl + S) ในหน้า Compiler'));
      const list = h('div', { class: 'proj-list' });
      local.forEach((p) => list.append(h('div', { class: 'proj-row' + (p.id === ws.data.projectId ? ' current' : '') },
        h('div', { class: 'proj-ico local' }, icon('files')),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 't', onclick: () => openLocal(p) }, p.name),
          h('div', { class: 'd' }, `${p.files.length} ไฟล์ · ${D.get(p.dialect || 'tsql').short || ''} · บันทึก ${when(p.savedAt)}`)),
        h('div', { class: 'acts' },
          h('button', { class: 'btn btn-sm', onclick: () => openLocal(p) }, 'เปิด'),
          cloud.loggedIn ? h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { try { await uploadLocal(p); fetchCloud(); } catch (e) { toast(e.message, 'err'); } } }, icon('upload'), 'ขึ้นคลาวด์') : null,
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
            if (!(await confirmBox('ลบโปรเจกต์', `ลบ <b>${U.esc(p.name)}</b> จากเครื่องนี้?`, 'ลบ', true))) return;
            store.deleteProject(p.id);
            if (ws.data.projectId === p.id) { ws.data.projectId = null; ws.save(); }
            render();
          } }, icon('trash'))))));
      c.append(list);
    }
  }

  S.pages = S.pages || {};
  S.pages.projects = {
    init(el) {
      root = el;
      cloud.on((type) => { if (type === 'auth') { cloudRows = null; if (!root.hidden) fetchCloud(); } });
      ws.on((type) => { if ((type === 'projects' || type === 'files') && !root.hidden) render(); });
    },
    show() {
      root.classList.add('page-scroll');
      if (cloud.loggedIn) fetchCloud(); else render();
    },
  };
})(window.SBAC);
