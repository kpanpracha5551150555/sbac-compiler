/* SBAC Compiler — client for the Phase 2 server (real Microsoft SQL Server) */
(function (S) {
  'use strict';
  const store = S.store;
  const DEFAULT_URL = 'http://localhost:3000';

  function hintForMssql(msg) {
    let m;
    if ((m = /Invalid object name '([^']+)'/i.exec(msg))) return `ไม่พบตาราง ${m[1]} — ตรวจสอบชื่อ หรือรันไฟล์ที่สร้างตาราง (เช่น init.sql) ก่อน`;
    if ((m = /Invalid column name '([^']+)'/i.exec(msg))) return `ไม่พบคอลัมน์ ${m[1]} — ดูชื่อคอลัมน์ได้ที่แถบฐานข้อมูลด้านซ้าย`;
    if ((m = /There is already an object named '([^']+)'/i.exec(msg))) return `มีตาราง ${m[1]} อยู่แล้ว — กด Reset DB หรือใช้ DROP TABLE IF EXISTS ${m[1]} ก่อน CREATE`;
    if (/Violation of (PRIMARY KEY|UNIQUE KEY)/i.test(msg)) return 'ค่าซ้ำในคอลัมน์ที่เป็น PRIMARY KEY / UNIQUE';
    if (/Cannot insert the value NULL/i.test(msg)) return 'คอลัมน์นี้ห้ามเป็นค่าว่าง (NOT NULL)';
    if (/FOREIGN KEY constraint/i.test(msg)) return 'ค่าที่อ้างอิงไม่มีอยู่ในตารางแม่ หรือยังมีข้อมูลลูกอ้างถึงอยู่ (FOREIGN KEY)';
    if (/CHECK constraint/i.test(msg)) return 'ข้อมูลไม่ผ่านเงื่อนไข CHECK ของตาราง';
    if ((m = /Incorrect syntax near '([^']*)'/i.exec(msg))) return `ไวยากรณ์ผิดใกล้ "${m[1]}" — ตรวจสอบเครื่องหมาย , ( ) ' และการสะกดคำสั่ง`;
    if (/Conversion failed|Error converting/i.test(msg)) return 'ชนิดข้อมูลไม่ตรงกัน — ลองใช้ CAST/CONVERT หรือใส่ข้อความใน \' \'';
    if (/Must declare the scalar variable/i.test(msg)) return 'ต้องประกาศตัวแปรก่อนด้วย DECLARE (และตัวแปรใช้ได้เฉพาะใน batch เดียวกัน ก่อน GO)';
    if (/is invalid in the select list because it is not contained in either an aggregate/i.test(msg)) return 'คอลัมน์ที่ SELECT ต้องอยู่ใน GROUP BY หรืออยู่ในฟังก์ชันรวม';
    if (/aggregate may not appear in the WHERE clause/i.test(msg)) return 'ใช้ฟังก์ชันรวมใน WHERE ไม่ได้ — ให้ใช้ HAVING แทน';
    if (/permission was denied|permission denied|not able to access the database/i.test(msg)) return 'คำสั่งนี้ถูกปิดไว้ในโหมดเซิร์ฟเวอร์ — แต่ละคนใช้ได้เฉพาะฐานข้อมูลของตัวเอง (สร้าง/ลบ DATABASE หรือ USE ฐานข้อมูลอื่นไม่ได้)';
    if (/Query timeout expired|timeout/i.test(msg)) return 'คำสั่งทำงานนานเกินเวลาที่กำหนด — ตรวจสอบลูป WHILE หรือ JOIN ที่ไม่มีเงื่อนไข';
    if (/Could not allocate space|PRIMARY filegroup is full|log file .* is full/i.test(msg)) return 'ฐานข้อมูลเต็มตามที่เซิร์ฟเวอร์จำกัดไว้ — ลบข้อมูลหรือ Reset DB';
    return null;
  }

  function randomId() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  }

  const remote = {
    cache: [],
    info: null,
    status: 'unknown', // unknown | ok | down

    url() { return String(store.settings().serverUrl || DEFAULT_URL).trim().replace(/\/+$/, ''); },
    defaultUrl: DEFAULT_URL,
    session() {
      let s = store.get('remoteSession', null);
      if (!s || !/^[a-z0-9]{8,32}$/.test(s)) { s = randomId(); store.set('remoteSession', s); }
      return s;
    },

    async call(path, body, timeoutMs) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
      let res;
      try {
        res = await fetch(this.url() + path, {
          method: body ? 'POST' : 'GET',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
      } catch (e) {
        this.status = 'down';
        const err = new Error(`ติดต่อเซิร์ฟเวอร์ ${this.url()} ไม่ได้`);
        err.hint = 'เปิดเซิร์ฟเวอร์ด้วยคำสั่ง  node server/server.js  ในโฟลเดอร์โปรเจกต์ หรือแก้ที่อยู่เซิร์ฟเวอร์ในหน้าตั้งค่า (ไอคอนเฟือง) — หรือสลับกลับไปใช้ "SQL Server · จำลองในเบราว์เซอร์"';
        throw err;
      } finally { clearTimeout(timer); }
      let json = {};
      try { json = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok || json.ok === false && json.error) {
        const err = new Error(json.error || `เซิร์ฟเวอร์ตอบกลับ ${res.status}`);
        if (res.status === 500) {
          this.status = 'down';
          err.hint = 'เซิร์ฟเวอร์ SBAC ทำงานอยู่ แต่ต่อ SQL Server ไม่ได้ — ตรวจว่า service MSSQLSERVER เปิดอยู่ (PowerShell แบบ Administrator: Start-Service MSSQLSERVER)';
        }
        throw err;
      }
      this.status = 'ok';
      return json;
    },

    async health() {
      const r = await this.call('/api/health', null, 10000);
      this.info = r.server;
      this.limits = r.limits;
      return r;
    },
    async run(code) {
      try {
        const r = await this.call('/api/run', { session: this.session(), code });
        if (r.schema) this.cache = r.schema;
        r.items.forEach((it) => { if (it.kind === 'error' && !it.hint) it.hint = hintForMssql(it.message); });
        return r;
      } catch (e) {
        return { ok: false, ms: 0, statements: 0, items: [{ kind: 'error', message: e.message, hint: e.hint || null }] };
      }
    },
    async reset() {
      const r = await this.call('/api/reset', { session: this.session() });
      this.cache = r.schema || [];
    },
    async refresh() {
      const r = await this.call('/api/schema', { session: this.session() });
      this.cache = r.schema || [];
      return this.cache;
    },
    async table(name, limit) {
      return this.call('/api/table', { session: this.session(), name, limit });
    },
  };

  S.remote = remote;
  S.hintForMssql = hintForMssql;
})(window.SBAC);
