/* SBAC Compiler — account button, login / sign-up / password dialogs */
(function (S) {
  'use strict';
  const U = S.util;
  const { h, icon, toast, modal, popupMenu, confirmBox } = U;
  const cloud = S.cloud;

  function field(label, input) { return h('label', { class: 'field', style: { marginBottom: '12px' } }, label, input); }

  /** mode: 'login' | 'signup' | 'forgot' */
  function authDialog(mode, prefillEmail) {
    const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'you@example.com', value: prefillEmail || '' });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: mode === 'signup' ? 'อย่างน้อย 6 ตัวอักษร' : '' });
    const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const msg = h('div', { class: 'auth-msg', hidden: true });
    const show = (text, ok) => { msg.hidden = false; msg.className = 'auth-msg ' + (ok ? 'ok' : 'err'); msg.textContent = text; };
    const switchTo = (m) => { dlg.close(); authDialog(m, email.value.trim()); };

    const titles = { login: 'เข้าสู่ระบบ', signup: 'สมัครสมาชิก', forgot: 'ลืมรหัสผ่าน' };
    const body = h('form', { class: 'auth-form', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('p', { class: 'muted', style: { marginTop: 0 } }, mode === 'forgot'
        ? 'ใส่อีเมลที่ใช้สมัคร ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้'
        : 'เก็บโปรเจกต์และความคืบหน้าบทเรียนไว้บนคลาวด์ เปิดต่อได้จากทุกเครื่อง'),
      field('อีเมล', email),
      mode !== 'forgot' ? field('รหัสผ่าน', pass) : null,
      mode === 'signup' ? field('ยืนยันรหัสผ่าน', pass2) : null,
      msg,
      h('button', { type: 'submit', hidden: true }),
      h('div', { class: 'auth-links' },
        mode === 'login' ? [h('a', { href: 'javascript:void 0', onclick: () => switchTo('signup') }, 'ยังไม่มีบัญชี? สมัครสมาชิก'),
          h('a', { href: 'javascript:void 0', onclick: () => switchTo('forgot') }, 'ลืมรหัสผ่าน')] : null,
        mode !== 'login' ? h('a', { href: 'javascript:void 0', onclick: () => switchTo('login') }, 'มีบัญชีแล้ว? เข้าสู่ระบบ') : null));

    let busy = false;
    async function submit() {
      if (busy) return false;
      const em = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { show('กรอกอีเมลให้ถูกต้อง'); return false; }
      if (mode !== 'forgot' && pass.value.length < 6) { show('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'); return false; }
      if (mode === 'signup' && pass.value !== pass2.value) { show('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return false; }
      busy = true; show('กำลังดำเนินการ…', true);
      try {
        if (mode === 'login') {
          await cloud.signIn(em, pass.value);
          dlg.close();
          toast('เข้าสู่ระบบแล้ว: ' + em, 'ok');
        } else if (mode === 'signup') {
          const r = await cloud.signUp(em, pass.value);
          if (r.needsConfirm) show('สมัครสำเร็จ! เราส่งลิงก์ยืนยันไปที่ ' + em + ' แล้ว — เปิดลิงก์ในอีเมล แล้วกลับมาเข้าสู่ระบบ', true);
          else { dlg.close(); toast('สมัครและเข้าสู่ระบบแล้ว', 'ok'); }
        } else {
          await cloud.resetPassword(em);
          show('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ' + em + ' แล้ว (ถ้าอีเมลนี้มีบัญชีอยู่)', true);
        }
      } catch (e) { show(e.message); }
      busy = false;
      return false;
    }
    const dlg = modal({
      title: titles[mode], body,
      actions: [{ label: 'ปิด' }, { label: mode === 'forgot' ? 'ส่งลิงก์' : titles[mode], primary: true, onClick: submit }],
    });
    return dlg;
  }

  function newPasswordDialog(title) {
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'อย่างน้อย 6 ตัวอักษร' });
    const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const msg = h('div', { class: 'auth-msg', hidden: true });
    const show = (t, ok) => { msg.hidden = false; msg.className = 'auth-msg ' + (ok ? 'ok' : 'err'); msg.textContent = t; };
    modal({
      title: title || 'ตั้งรหัสผ่านใหม่',
      body: h('div', null, field('รหัสผ่านใหม่', pass), field('ยืนยันรหัสผ่านใหม่', pass2), msg),
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึกรหัสผ่าน', primary: true, onClick: async () => {
        if (pass.value.length < 6) { show('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'); return false; }
        if (pass.value !== pass2.value) { show('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return false; }
        try { await cloud.updatePassword(pass.value); toast('เปลี่ยนรหัสผ่านแล้ว', 'ok'); return true; } catch (e) { show(e.message); return false; }
      } }],
    });
  }

  function renderButton() {
    const slot = U.$('#accountSlot');
    if (!slot) return;
    slot.innerHTML = '';
    if (!cloud.enabled) return;
    if (!cloud.loggedIn) {
      slot.append(h('button', { class: 'btn', onclick: () => authDialog('login') }, h('span', null, 'Login')));
      return;
    }
    const letter = (cloud.email[0] || '?').toUpperCase();
    slot.append(h('button', { class: 'avatar', title: cloud.email, 'aria-label': 'บัญชี ' + cloud.email, onclick: (e) => popupMenu(e.currentTarget, [
      { label: cloud.email, icon: 'key', onClick: () => {} },
      '-',
      { label: 'งานของฉัน (คลาวด์)', icon: 'files', onClick: () => { location.hash = '#/projects'; } },
      { label: 'เปลี่ยนรหัสผ่าน', icon: 'key', onClick: () => newPasswordDialog('เปลี่ยนรหัสผ่าน') },
      '-',
      { label: 'ออกจากระบบ', icon: 'arrowLeft', danger: true, onClick: async () => {
        if (!(await confirmBox('ออกจากระบบ', 'ออกจากระบบ? งานที่บันทึกบนคลาวด์ยังอยู่ เข้าสู่ระบบอีกครั้งเมื่อไรก็เปิดได้', 'ออกจากระบบ'))) return;
        try { await cloud.signOut(); toast('ออกจากระบบแล้ว'); } catch (e) { toast(e.message, 'err'); }
      } },
    ]) }, letter));
  }

  cloud.on((type) => {
    if (type === 'auth') renderButton();
    if (type === 'recovery') newPasswordDialog();
  });

  S.account = { renderButton, authDialog, newPasswordDialog };
})(window.SBAC);
