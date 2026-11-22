/* SBAC Compiler — Phase 2 API server: runs code on a real Microsoft SQL Server.
 *
 * Sandbox per browser session:
 *   - each session gets its own database  sbac_<session>  (size-capped)
 *   - user code runs as a loginless database user (EXECUTE AS USER … WITH NO REVERT),
 *     so it is confined to that database: no server-level permissions, no other databases
 *   - query timeout, row cap, request size cap, per-IP rate limit, idle databases are dropped
 *
 * Also serves the static site, so `node server.js` → http://localhost:3000 works on its own.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const sql = require('msnodesqlv8');

const CFG = {
  port: +(process.env.PORT || 5199),
  host: process.env.HOST || '127.0.0.1',
  server: process.env.SBAC_SQL_SERVER || '(local)',
  driver: process.env.SBAC_ODBC_DRIVER || '',
  timeoutSec: +(process.env.SBAC_TIMEOUT || 10),
  maxRows: +(process.env.SBAC_MAX_ROWS || 2000),
  maxCode: 200 * 1024,
  maxDbMB: +(process.env.SBAC_MAX_DB_MB || 64),
  idleMinutes: +(process.env.SBAC_IDLE_MINUTES || 120),
  maxSessions: +(process.env.SBAC_MAX_SESSIONS || 200),
  runsPerMinute: +(process.env.SBAC_RUNS_PER_MINUTE || 60),
  origins: (process.env.SBAC_ALLOWED_ORIGINS || 'https://kpanpracha5551150555.github.io').split(',').map((s) => s.trim()).filter(Boolean),
  staticRoot: path.resolve(__dirname, '..'),
};
const RUNNER = 'sbac_runner';

/* ---------------- connections ---------------- */
function connStr(db) {
  return `Driver={${CFG.driver}};Server=${CFG.server};Database=${db || 'master'};Trusted_Connection=yes;TrustServerCertificate=yes;Encrypt=no;APP=SBAC Compiler`;
}
function open(db) {
  return new Promise((resolve, reject) => sql.open({ conn_str: connStr(db), conn_timeout: 5 }, (err, conn) => (err ? reject(err) : resolve(conn))));
}
function close(conn) { return new Promise((resolve) => { try { conn.close(() => resolve()); } catch (e) { resolve(); } }); }
function query(conn, q, params) {
  return new Promise((resolve, reject) => conn.query(q, params || [], (err, rows) => (err ? reject(err) : resolve(rows))));
}
async function detectDriver() {
  if (CFG.driver) return;
  for (const d of ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'SQL Server']) {
    CFG.driver = d;
    try { const c = await open('master'); await close(c); return; } catch (e) {
      // only "driver not installed" moves on to the next driver; any other error means the driver works (e.g. server down)
      if (!(e.sqlstate === 'IM002' || /data source name not found|specified driver could not be loaded/i.test(String(e.message)))) return;
    }
  }
}

/* admin connection (Windows auth of the account running this server) — serialised */
let adminConn = null;
let adminQueue = Promise.resolve();
function admin(fn) {
  const run = adminQueue.then(async () => {
    if (!adminConn) adminConn = await open('master');
    try { return await fn(adminConn); } catch (e) {
      if (/communication link|connection/i.test(String(e.message))) { try { await close(adminConn); } catch (x) { /* ignore */ } adminConn = null; }
      throw e;
    }
  });
  adminQueue = run.catch(() => {});
  return run;
}

/* ---------------- sessions ---------------- */
const sessions = new Map(); // id → { lastUsed }
const validId = (id) => typeof id === 'string' && /^[a-z0-9]{8,32}$/.test(id);
const dbName = (id) => 'sbac_' + id;

async function ensureDb(id) {
  const name = dbName(id);
  const known = sessions.get(id);
  if (known && known.ready) { known.lastUsed = Date.now(); return name; }
  if (!known && sessions.size >= CFG.maxSessions) throw userError('เซิร์ฟเวอร์มีผู้ใช้เต็มแล้ว ลองใหม่ภายหลัง');
  await admin(async (c) => {
    const exists = await query(c, 'SELECT DB_ID(?) AS id', [name]);
    if (exists[0].id == null) {
      await query(c, `CREATE DATABASE [${name}]`);
      await query(c, `ALTER DATABASE [${name}] SET RECOVERY SIMPLE`);
      const files = await query(c, `SELECT name FROM sys.master_files WHERE database_id = DB_ID(?)`, [name]);
      for (const f of files) await query(c, `ALTER DATABASE [${name}] MODIFY FILE (NAME = N'${f.name.replace(/'/g, "''")}', MAXSIZE = ${CFG.maxDbMB}MB)`);
    }
    await query(c, `USE [${name}]; IF USER_ID(N'${RUNNER}') IS NULL CREATE USER [${RUNNER}] WITHOUT LOGIN; ALTER ROLE db_owner ADD MEMBER [${RUNNER}]; USE master;`);
  });
  sessions.set(id, { lastUsed: Date.now(), ready: true });
  return name;
}
async function dropDb(id) {
  const name = dbName(id);
  sessions.delete(id);
  await admin(async (c) => {
    await query(c, `IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`);
  });
}
async function cleanupIdle() {
  const limit = Date.now() - CFG.idleMinutes * 60000;
  for (const [id, s] of sessions) if (s.lastUsed < limit) { try { await dropDb(id); log('dropped idle', dbName(id)); } catch (e) { log('drop failed', e.message); } }
}
async function adoptExisting() {
  const rows = await admin((c) => query(c, "SELECT name FROM sys.databases WHERE name LIKE 'sbac[_]%'"));
  rows.forEach((r) => { const id = r.name.slice(5); if (validId(id)) sessions.set(id, { lastUsed: Date.now(), ready: false }); });
}

/* ---------------- running user code ---------------- */
function splitBatches(code) {
  // Split on lines that contain only GO [n] (outside block comments / strings, good enough for scripts)
  const lines = code.split(/\r?\n/);
  const batches = [];
  let buf = [], start = 1, inBlock = false, inStr = false;
  lines.forEach((line, i) => {
    if (!inBlock && !inStr && /^\s*GO(\s+\d+)?\s*(--.*)?$/i.test(line)) {
      const count = Math.min(+((/GO\s+(\d+)/i.exec(line) || [])[1] || 1), 100);
      if (buf.join('').trim()) for (let k = 0; k < count; k++) batches.push({ sql: buf.join('\n'), line: start });
      buf = []; start = i + 2;
      return;
    }
    buf.push(line);
    for (let j = 0; j < line.length; j++) {
      const c = line[j], d = line[j + 1];
      if (inBlock) { if (c === '*' && d === '/') { inBlock = false; j++; } continue; }
      if (inStr) { if (c === "'") { if (d === "'") j++; else inStr = false; } continue; }
      if (c === '-' && d === '-') break;
      if (c === '/' && d === '*') { inBlock = true; j++; continue; }
      if (c === "'") inStr = true;
    }
  });
  if (buf.join('').trim()) batches.push({ sql: buf.join('\n'), line: start });
  return batches;
}

const NUMERIC = /^(int|bigint|smallint|tinyint|decimal|numeric|money|smallmoney|float|real)$/i;
const pad = (n, w) => String(n).padStart(w || 2, '0');
function fmtCell(v, m) {
  if (v === null || v === undefined) return null;
  const t = String((m && m.sqlType) || '').toLowerCase();
  if (v instanceof Date) {
    // msnodesqlv8 returns UTC-based Date for date/time types
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (t === 'date') return d;
    const tm = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
    if (t === 'time') return tm;
    return `${d} ${tm}.${pad(v.getUTCMilliseconds(), 3)}`;
  }
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex').toUpperCase().slice(0, 64) + (v.length > 32 ? '…' : '');
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && /^(int|smallint|tinyint)$/.test(t)) return Number(v);
  if (typeof v === 'number' && /^(decimal|numeric|money|smallmoney)$/.test(t) && m.scale != null) return v.toFixed(/money/.test(t) ? 4 : m.scale);
  return v;
}
const cleanMsg = (msg) => String(msg || '').replace(/^(\[[^\]]*\])+/, '').trim();

function runBatch(conn, batch, items) {
  return new Promise((resolve) => {
    let cur = null, meta = null, row = null, error = null, finished = false, pendingCount = null, timedOut = false, zeroCounts = 0;
    const startLen = items.length;
    const flushCount = () => {
      if (pendingCount != null) items.push({ kind: 'msg', text: `(${pendingCount} ${pendingCount === 1 ? 'row' : 'rows'} affected)`, tone: 'muted' });
      pendingCount = null;
    };
    let q;
    const watchdog = setTimeout(() => {
      timedOut = true;
      if (!error) error = Object.assign(new Error(`Query timeout expired — คำสั่งทำงานเกิน ${CFG.timeoutSec} วินาที จึงถูกยกเลิก`), { code: 'TIMEOUT' });
      try { q && q.cancelQuery(() => {}); } catch (e) { /* ignore */ }
      finish();
    }, (CFG.timeoutSec + 2) * 1000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      flushCount();
      if (!error && zeroCounts && items.length === startLen && /(UPDATE|DELETE|INSERT|MERGE)/i.test(batch.sql)) {
        items.push({ kind: 'msg', text: '(0 rows affected)', tone: 'muted' });
      }
      resolve({ error, timedOut });
    };
    try {
      q = conn.query({ query_str: batch.sql, query_timeout: CFG.timeoutSec, query_polling: true, numeric_string: true });
    } catch (e) { error = e; return finish(); }
    q.on('meta', (m) => {
      pendingCount = null; // the count reported just before a result set belongs to that SELECT
      meta = m;
      cur = { kind: 'table', columns: m.map((c) => c.name || ''), numeric: m.map((c) => NUMERIC.test(c.sqlType || '')), rows: [], truncated: false };
      items.push(cur);
    });
    q.on('row', () => {
      if (!cur) return;
      if (cur.rows.length >= CFG.maxRows) { cur.truncated = true; row = null; return; }
      row = new Array(cur.columns.length).fill(null);
      cur.rows.push(row);
    });
    q.on('column', (i, data, more) => {
      if (!row) return;
      if (row._partial === i) row[i] = (row[i] || '') + data;
      else row[i] = more ? data : fmtCell(data, meta && meta[i]);
      row._partial = more ? i : undefined;
    });
    // the driver also reports 0 after DDL / SET / DECLARE, so zero counts are only shown when nothing else was printed
    q.on('rowcount', (n) => { flushCount(); if (n > 0) pendingCount = n; else if (n === 0) zeroCounts++; });
    q.on('info', (e) => { flushCount(); items.push({ kind: 'msg', text: cleanMsg(e.message), tone: 'print' }); });
    q.on('error', (e) => { flushCount(); if (!error) error = e; });
    q.on('free', finish);
    q.on('closed', finish);
  });
}

async function runCode(id, code) {
  const db = await ensureDb(id);
  const t0 = Date.now();
  const items = [];
  const batches = splitBatches(code);
  let ok = true, statements = 0, broken = false;
  const conn = await open(db);
  let cookie = null;
  try {
    // impersonate the sandbox user; the cookie (kept here, never sent to user code) is the only way back
    const r = await query(conn, `SET NOCOUNT ON; DECLARE @c varbinary(8000); EXECUTE AS USER = N'${RUNNER}' WITH COOKIE INTO @c; SELECT @c AS c; SET NOCOUNT OFF;`);
    cookie = r[0].c;
    for (const b of batches) {
      const { error: err, timedOut } = await runBatch(conn, b, items);
      statements++;
      if (err) {
        ok = false;
        broken = timedOut;
        const line = err.lineNumber ? b.line + err.lineNumber - 1 : b.line;
        items.push({ kind: 'error', message: cleanMsg(err.message), code: err.code, line, sql: b.sql.trim().slice(0, 600) });
        break;
      }
    }
  } finally {
    if (!broken && cookie) {
      try {
        await query(conn, `IF @@TRANCOUNT > 0 ROLLBACK; REVERT WITH COOKIE = 0x${Buffer.from(cookie).toString('hex')};`);
      } catch (e) { broken = true; }
    }
    if (broken) close(conn); else await close(conn);
  }
  items.forEach((it) => { if (it.rows) it.rows.forEach((r) => { delete r._partial; }); });
  if (ok && !items.length && statements) items.push({ kind: 'msg', text: 'Commands completed successfully.', tone: 'okmsg' });
  if (!statements) items.push({ kind: 'msg', text: 'ไม่มีคำสั่งให้รัน', tone: 'muted' });
  sessions.get(id).lastUsed = Date.now();
  return { ok, items, ms: Date.now() - t0, statements };
}

/* ---------------- schema / data ---------------- */
async function schema(id) {
  const db = await ensureDb(id);
  return admin(async (c) => {
    await query(c, `USE [${db}]`);
    try {
      const objs = await query(c, `SELECT o.object_id, SCHEMA_NAME(o.schema_id) AS sch, o.name, o.type,
          (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0,1)) AS row_count,
          OBJECT_DEFINITION(o.object_id) AS def
        FROM sys.objects o WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0 ORDER BY CASE o.type WHEN 'U' THEN 0 ELSE 1 END, o.create_date`);
      const cols = await query(c, `SELECT c.object_id, c.name, t.name AS type, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.column_id,
          CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
             WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS bit) AS pk,
          dc.definition AS dflt
        FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
        LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
        WHERE c.object_id IN (SELECT object_id FROM sys.objects WHERE type IN ('U','V') AND is_ms_shipped = 0)
        ORDER BY c.object_id, c.column_id`);
      const fks = await query(c, `SELECT fkc.parent_object_id AS object_id, pc.name AS [from], OBJECT_NAME(fkc.referenced_object_id) AS [table], rc.name AS [to]
        FROM sys.foreign_key_columns fkc
        JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
        JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id`);
      const idx = await query(c, `SELECT object_id, name FROM sys.indexes WHERE is_primary_key = 0 AND is_unique_constraint = 0 AND name IS NOT NULL
        AND object_id IN (SELECT object_id FROM sys.objects WHERE type = 'U' AND is_ms_shipped = 0)`);
      const typeText = (col) => {
        const t = col.type;
        if (/^(n?varchar|n?char|varbinary|binary)$/.test(t)) return `${t}(${col.max_length === -1 ? 'max' : /^n/.test(t) ? col.max_length / 2 : col.max_length})`;
        if (/^(decimal|numeric)$/.test(t)) return `${t}(${col.precision},${col.scale})`;
        return t + (col.is_identity ? ' identity' : '');
      };
      return objs.map((o) => ({
        name: o.sch === 'dbo' ? o.name : `${o.sch}.${o.name}`,
        type: o.type.trim() === 'V' ? 'view' : 'table',
        sql: o.def || null,
        rowCount: o.row_count == null ? null : Number(o.row_count),
        columns: cols.filter((x) => x.object_id === o.object_id).map((x) => ({ name: x.name, type: typeText(x), notnull: !x.is_nullable, pk: !!x.pk, dflt: x.dflt })),
        fks: fks.filter((f) => f.object_id === o.object_id).map((f) => ({ from: f.from, table: f.table, to: f.to })),
        indexes: idx.filter((i) => i.object_id === o.object_id).map((i) => i.name),
      }));
    } finally { await query(c, 'USE master'); }
  });
}
async function tableData(id, name, limit) {
  const db = await ensureDb(id);
  const list = await schema(id);
  const t = list.find((x) => x.name === name);
  if (!t) throw userError('ไม่พบตาราง ' + name);
  const parts = name.split('.');
  const ident = parts.map((p) => '[' + p.replace(/]/g, ']]') + ']').join('.');
  const n = Math.max(1, Math.min(10000, limit | 0 || 10000));
  const conn = await open(db);
  try {
    const items = [];
    const { error: err } = await runBatch(conn, { sql: `SELECT TOP (${n}) * FROM ${ident}`, line: 1 }, items);
    if (err) throw err;
    const tbl = items.find((i) => i.kind === 'table') || { columns: [], rows: [] };
    return { columns: tbl.columns, rows: tbl.rows, numeric: tbl.numeric };
  } finally { await close(conn); }
}

/* ---------------- HTTP ---------------- */
function userError(msg) { const e = new Error(msg); e.user = true; return e; }
function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > CFG.runsPerMinute;
}
function allowedOrigin(origin) {
  if (!origin) return null;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return origin;
  if (origin === 'null') return 'null'; // index.html opened from disk
  return CFG.origins.includes(origin) || CFG.origins.includes('*') ? origin : null;
}
function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > CFG.maxCode + 4096) { reject(userError('โค้ดยาวเกินไป')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(userError('รูปแบบคำขอไม่ถูกต้อง')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (!/^\/(index\.html|css\/[\w.-]+|js\/[\w./-]+)$/.test(p) || p.includes('..')) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(CFG.staticRoot, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

let serverInfo = null;
const server = http.createServer(async (req, res) => {
  const origin = allowedOrigin(req.headers.origin);
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
    if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Private-Network'] = 'true'; }
    res.writeHead(origin ? 204 : 403, h); return res.end();
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  if (req.headers.origin && !origin) return send(res, 403, { ok: false, error: 'origin not allowed' });
  const ip = req.socket.remoteAddress || '';
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      if (!serverInfo) {
        const r = await admin((c) => query(c, "SELECT @@VERSION AS v, CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS pv, CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS ed"));
        serverInfo = { version: String(r[0].v).split('\n')[0].trim(), productVersion: r[0].pv, edition: r[0].ed };
      }
      return send(res, 200, { ok: true, server: serverInfo, limits: { timeoutSec: CFG.timeoutSec, maxRows: CFG.maxRows, maxDbMB: CFG.maxDbMB } }, origin);
    }
    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not found' }, origin);
    const body = await readBody(req);
    if (!validId(body.session)) throw userError('session ไม่ถูกต้อง');
    if (url.pathname === '/api/run') {
      if (rateLimited(ip)) throw userError('รันถี่เกินไป รอสักครู่แล้วลองใหม่');
      if (typeof body.code !== 'string' || body.code.length > CFG.maxCode) throw userError('โค้ดยาวเกินไป');
      const r = await runCode(body.session, body.code);
      r.schema = await schema(body.session).catch(() => null);
      log('run', body.session.slice(0, 6), r.ok ? 'ok' : 'error', r.ms + 'ms');
      return send(res, 200, r, origin);
    }
    if (url.pathname === '/api/reset') {
      await dropDb(body.session);
      await ensureDb(body.session);
      return send(res, 200, { ok: true, schema: [] }, origin);
    }
    if (url.pathname === '/api/schema') return send(res, 200, { ok: true, schema: await schema(body.session) }, origin);
    if (url.pathname === '/api/table') return send(res, 200, Object.assign({ ok: true }, await tableData(body.session, String(body.name || ''), body.limit)), origin);
    return send(res, 404, { ok: false, error: 'not found' }, origin);
  } catch (e) {
    if (!e.user) log('error', e.message);
    return send(res, e.user ? 400 : 500, { ok: false, error: e.user ? e.message : 'เชื่อมต่อ SQL Server ไม่สำเร็จ: ' + cleanMsg(e.message) }, origin);
  }
});

(async () => {
  await detectDriver();
  try { await adoptExisting(); } catch (e) { log('warning: cannot reach SQL Server yet —', cleanMsg(e.message)); }
  setInterval(() => cleanupIdle().catch(() => {}), 10 * 60000).unref();
  server.listen(CFG.port, CFG.host, () => {
    log(`SBAC Compiler server: http://localhost:${CFG.port}  (SQL Server: ${CFG.server}, driver: ${CFG.driver})`);
  });
})();

module.exports = { splitBatches };
