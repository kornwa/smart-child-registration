/**
 * Smart Child Registration — ส่วนหลังบ้าน (Google Apps Script + Google Sheets)
 *
 * วิธีติดตั้ง (ดูรายละเอียดใน README.md):
 *  1. สร้าง Google Sheet ใหม่ > ส่วนขยาย > Apps Script แล้ววางโค้ดนี้แทนของเดิม
 *  2. ตั้งค่าโปรเจกต์ (รูปเฟือง) > คุณสมบัติของสคริปต์ > เพิ่ม ACCESS_KEY = รหัสผ่านเจ้าหน้าที่
 *  3. เลือกฟังก์ชัน setup แล้วกด "เรียกใช้" หนึ่งครั้ง
 *  4. ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > เว็บแอป
 *     ดำเนินการในฐานะ: ฉัน / ผู้มีสิทธิ์เข้าถึง: ทุกคน
 */

// ---------- ตั้งค่า ----------
const TZ = 'Asia/Bangkok';
const SLOT_CAPACITY = 3; // จำนวนเด็กต่อช่วงเวลา
const SLOTS = [
  '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
];
const SERVICES = ['ตรวจสุขภาพเด็กดี', 'ฉีดวัคซีน', 'ตรวจพัฒนาการ', 'ตรวจรักษาทั่วไป', 'ปรึกษาโภชนาการ'];
const STATUSES = ['waiting', 'serving', 'done', 'cancelled'];
const SLOW_AFTER_FAILS = 5; // ใส่รหัสผิดเกินจำนวนนี้ใน 10 นาที ระบบจะตอบช้าลงเพื่อกันการสุ่มรหัส

const SHEETS = {
  children: {
    name: 'Children',
    cols: ['id', 'hn', 'first_name', 'last_name', 'nickname', 'gender', 'birth_date', 'citizen_id', 'blood_type',
      'weight', 'height', 'allergies', 'conditions', 'parent_name', 'parent_relation', 'parent_phone', 'address',
      'note', 'created_at', 'updated_at'],
  },
  bookings: {
    name: 'Bookings',
    cols: ['id', 'child_id', 'date', 'slot', 'queue_no', 'service', 'note', 'status', 'created_at', 'updated_at'],
  },
};
const NUM_COLS = ['id', 'child_id', 'queue_no', 'weight', 'height'];

// ---------- ติดตั้งครั้งแรก ----------
function setup() {
  const ss = SpreadsheetApp.getActive();
  for (const def of Object.values(SHEETS)) {
    let sh = ss.getSheetByName(def.name);
    if (!sh) sh = ss.insertSheet(def.name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight('bold').setBackground('#e8f1fd');
      sh.setFrozenRows(1);
    }
  }
  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(blank);
  if (!PropertiesService.getScriptProperties().getProperty('ACCESS_KEY')) {
    throw new Error('สร้างชีตเรียบร้อย แต่ยังไม่ได้ตั้งรหัสผ่าน: ไปที่ ตั้งค่าโปรเจกต์ > คุณสมบัติของสคริปต์ > เพิ่ม ACCESS_KEY');
  }
  Logger.log('ติดตั้งเรียบร้อย พร้อมทำให้ใช้งานได้เป็นเว็บแอป');
}

// ---------- เมนูในชีต: ตั้งรหัสผ่านได้โดยไม่ต้องเข้า Apps Script ----------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧒 ระบบจองคิว')
    .addItem('ตั้ง / เปลี่ยนรหัสผ่านเจ้าหน้าที่', 'setPasswordFromMenu')
    .addToUi();
}

function setPasswordFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ตั้งรหัสผ่านเจ้าหน้าที่',
    'รหัสนี้ใช้เข้าเว็บจองคิว ควรยาว 12 ตัวขึ้นไป และไม่ซ้ำกับรหัสอีเมล', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (key.length < 8) {
    ui.alert('รหัสสั้นเกินไป กรุณาตั้งอย่างน้อย 8 ตัว (แนะนำ 12 ตัวขึ้นไป)');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ACCESS_KEY', key);
  setup();
  ui.alert('ตั้งรหัสผ่านเรียบร้อย ✅\nเจ้าหน้าที่ใช้รหัสนี้เข้าเว็บจองคิวได้เลย');
}

// ---------- จุดรับคำขอ ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function doGet() {
  return json({ status: 200, data: { ok: true, message: 'Smart Child Registration API พร้อมใช้งาน' } });
}

function doPost(e) {
  try {
    let req;
    try { req = JSON.parse(e.postData.contents); } catch (err) { throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
    checkKey(req.key);
    const method = String(req.method || 'GET').toUpperCase();
    const write = method !== 'GET';
    const lock = LockService.getScriptLock();
    if (write) lock.waitLock(20000);
    try {
      return json({ status: 200, data: dispatch(method, String(req.path || ''), req.query || {}, req.body || {}) });
    } finally {
      if (write) lock.releaseLock();
    }
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return json({ status: err.status || 500, error: err instanceof HttpError ? err.message : 'เกิดข้อผิดพลาดในระบบ: ' + err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey(key) {
  const real = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  if (!real) throw new HttpError(500, 'ผู้ดูแลยังไม่ได้ตั้งรหัสผ่าน (ACCESS_KEY) ใน Apps Script');
  if (String(key || '') === real) return; // รหัสถูกเข้าได้เสมอ คนนอกจึงล็อกเจ้าหน้าที่ออกจากระบบไม่ได้
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0) + 1;
  cache.put('login_fails', String(fails), 600);
  if (fails > SLOW_AFTER_FAILS) Utilities.sleep(Math.min(fails, 20) * 500);
  throw new HttpError(401, 'รหัสผ่านไม่ถูกต้อง');
}

// ---------- ตัวช่วยชีต ----------
function table(name) {
  const def = SHEETS[name];
  const sh = SpreadsheetApp.getActive().getSheetByName(def.name);
  if (!sh) throw new HttpError(500, 'ไม่พบชีต ' + def.name + ' กรุณารันฟังก์ชัน setup ก่อน');
  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const o = { _row: i + 1 };
    header.forEach((h, j) => { o[h] = fromCell(h, values[i][j]); });
    if (o.id) rows.push(o);
  }
  return { sh, header, rows };
}

function fromCell(col, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (col === 'slot') return Utilities.formatDate(v, TZ, 'HH:mm');
    if (col === 'created_at' || col === 'updated_at') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  if (NUM_COLS.includes(col)) return Number(v);
  return String(v);
}

function toCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  return "'" + String(v); // บังคับเป็นข้อความ: กันเลข 0 นำหน้าหาย วันที่ถูกแปลง และสูตรแปลกปลอม
}

function writeRow(t, obj, rowNo) {
  const vals = [t.header.map((h) => toCell(obj[h]))];
  t.sh.getRange(rowNo || t.sh.getLastRow() + 1, 1, 1, t.header.length).setValues(vals);
}

function deleteRows(t, rowNos) {
  rowNos.sort((a, b) => b - a).forEach((r) => t.sh.deleteRow(r));
}

function nextId(name, rows) {
  const props = PropertiesService.getScriptProperties();
  const key = 'seq_' + name;
  const max = rows.reduce((m, r) => Math.max(m, r.id), 0);
  const n = Math.max(Number(props.getProperty(key) || 0), max) + 1;
  props.setProperty(key, String(n));
  return n;
}

const strip = (o) => { if (!o) return o; const c = Object.assign({}, o); delete c._row; return c; };
const todayStr = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const nowStamp = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const clean = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function validCitizenId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

function readChild(body) {
  const c = {
    first_name: clean(body.first_name),
    last_name: clean(body.last_name),
    nickname: clean(body.nickname),
    gender: clean(body.gender),
    birth_date: clean(body.birth_date),
    citizen_id: (clean(body.citizen_id) || '').replace(/[\s-]/g, '') || null,
    blood_type: clean(body.blood_type),
    weight: num(body.weight),
    height: num(body.height),
    allergies: clean(body.allergies),
    conditions: clean(body.conditions),
    parent_name: clean(body.parent_name),
    parent_relation: clean(body.parent_relation),
    parent_phone: (clean(body.parent_phone) || '').replace(/[\s-]/g, '') || null,
    address: clean(body.address),
    note: clean(body.note),
  };
  if (!c.first_name || !c.last_name) throw new HttpError(400, 'กรุณากรอกชื่อและนามสกุลของเด็ก');
  if (!isDate(c.birth_date)) throw new HttpError(400, 'กรุณาระบุวันเกิดให้ถูกต้อง');
  if (c.birth_date > todayStr()) throw new HttpError(400, 'วันเกิดต้องไม่เป็นวันในอนาคต');
  if (c.citizen_id && !validCitizenId(c.citizen_id)) throw new HttpError(400, 'เลขบัตรประชาชนไม่ถูกต้อง');
  if (!c.parent_name) throw new HttpError(400, 'กรุณากรอกชื่อผู้ปกครอง');
  if (!c.parent_phone || !/^0\d{8,9}$/.test(c.parent_phone)) throw new HttpError(400, 'เบอร์โทรผู้ปกครองไม่ถูกต้อง (เช่น 0812345678)');
  ['weight', 'height'].forEach((k) => {
    if (c[k] !== null && (!isFinite(c[k]) || c[k] <= 0 || c[k] > 300)) throw new HttpError(400, 'น้ำหนัก/ส่วนสูงไม่ถูกต้อง');
  });
  return c;
}

function nextHn(rows) {
  // เลข HN ไม่ถูกนำกลับมาใช้ซ้ำ แม้จะลบข้อมูลเด็กไปแล้ว
  const prefix = String(Number(Utilities.formatDate(new Date(), TZ, 'yyyy')) + 543).slice(-2);
  const props = PropertiesService.getScriptProperties();
  const key = 'seq_hn_' + prefix;
  const max = rows.filter((r) => r.hn && r.hn.indexOf(prefix + '-') === 0)
    .reduce((m, r) => Math.max(m, Number(r.hn.split('-')[1]) || 0), 0);
  const n = Math.max(Number(props.getProperty(key) || 0), max) + 1;
  props.setProperty(key, String(n));
  return prefix + '-' + String(n).padStart(5, '0');
}

function slotUsage(bookings, date) {
  const used = {};
  bookings.forEach((b) => { if (b.date === date && b.status !== 'cancelled') used[b.slot] = (used[b.slot] || 0) + 1; });
  return SLOTS.map((s) => ({ slot: s, used: used[s] || 0, capacity: SLOT_CAPACITY }));
}

function bookingView(b, childMap) {
  const c = childMap[b.child_id] || {};
  return Object.assign(strip(b), {
    hn: c.hn, first_name: c.first_name, last_name: c.last_name, nickname: c.nickname, birth_date: c.birth_date,
    parent_name: c.parent_name, parent_phone: c.parent_phone, allergies: c.allergies,
  });
}

function joined() {
  const ct = table('children');
  const bt = table('bookings');
  const map = {};
  ct.rows.forEach((c) => { map[c.id] = c; });
  return { ct, bt, map, views: bt.rows.filter((b) => map[b.child_id]).map((b) => bookingView(b, map)) };
}

const byQueue = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.queue_no - b.queue_no);

// ---------- เส้นทาง API (เหมือนเวอร์ชัน Node เดิม) ----------
const ROUTES = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
  ROUTES.push({ method, re, keys, handler });
}

function dispatch(method, path, query, body) {
  for (const r of ROUTES) {
    const m = r.method === method && path.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });
    return r.handler(params, query, body);
  }
  throw new HttpError(404, 'ไม่พบ API');
}

route('GET', '/api/config', () => ({ slots: SLOTS, services: SERVICES, capacity: SLOT_CAPACITY, today: todayStr() }));

route('GET', '/api/stats', () => {
  const t = todayStr();
  const { ct, views } = joined();
  const count = (f) => views.filter(f).length;
  return {
    children: ct.rows.length,
    today: count((b) => b.date === t && b.status !== 'cancelled'),
    waiting: count((b) => b.date === t && b.status === 'waiting'),
    done: count((b) => b.date === t && b.status === 'done'),
    upcoming: count((b) => b.date > t && b.status !== 'cancelled'),
  };
});

// ข้อมูลเด็ก
route('GET', '/api/children', (p, query) => {
  const q = String(query.q || '').trim().toLowerCase();
  let rows = table('children').rows.slice().reverse();
  if (q) {
    const fields = ['first_name', 'last_name', 'nickname', 'hn', 'citizen_id', 'parent_name', 'parent_phone'];
    rows = rows.filter((c) => fields.some((f) => c[f] && String(c[f]).toLowerCase().indexOf(q) !== -1));
  }
  return rows.slice(0, 200).map(strip);
});

route('GET', '/api/children/:id', (p) => {
  const child = table('children').rows.find((c) => c.id === p.id);
  if (!child) throw new HttpError(404, 'ไม่พบข้อมูลเด็ก');
  const out = strip(child);
  out.bookings = table('bookings').rows.filter((b) => b.child_id === p.id)
    .sort((a, b) => (a.date + a.slot < b.date + b.slot ? 1 : -1)).map(strip);
  return out;
});

function assertUniqueCitizen(rows, citizenId, exceptId) {
  if (citizenId && rows.some((c) => c.citizen_id === citizenId && c.id !== exceptId)) {
    throw new HttpError(409, 'เลขบัตรประชาชนนี้มีในระบบแล้ว');
  }
}

route('POST', '/api/children', (p, q, body) => {
  const c = readChild(body);
  const t = table('children');
  assertUniqueCitizen(t.rows, c.citizen_id, 0);
  const now = nowStamp();
  const row = Object.assign({ id: nextId('children', t.rows), hn: nextHn(t.rows) }, c, { created_at: now, updated_at: now });
  writeRow(t, row);
  return row;
});

route('PUT', '/api/children/:id', (p, q, body) => {
  const t = table('children');
  const old = t.rows.find((c) => c.id === p.id);
  if (!old) throw new HttpError(404, 'ไม่พบข้อมูลเด็ก');
  const c = readChild(body);
  assertUniqueCitizen(t.rows, c.citizen_id, p.id);
  const row = Object.assign({}, old, c, { updated_at: nowStamp() });
  writeRow(t, row, old._row);
  return strip(row);
});

route('DELETE', '/api/children/:id', (p) => {
  const bt = table('bookings');
  deleteRows(bt, bt.rows.filter((b) => b.child_id === p.id).map((b) => b._row));
  const ct = table('children');
  const c = ct.rows.find((x) => x.id === p.id);
  if (!c) throw new HttpError(404, 'ไม่พบข้อมูลเด็ก');
  ct.sh.deleteRow(c._row);
  return { ok: true };
});

// คิว
route('GET', '/api/slots', (p, query) => {
  if (!isDate(query.date)) throw new HttpError(400, 'วันที่ไม่ถูกต้อง');
  return slotUsage(table('bookings').rows, query.date);
});

route('GET', '/api/bookings', (p, query) => {
  if (query.date && !isDate(query.date)) throw new HttpError(400, 'วันที่ไม่ถูกต้อง');
  return joined().views
    .filter((b) => (!query.date || b.date === query.date) && (!STATUSES.includes(query.status) || b.status === query.status))
    .sort(byQueue).slice(0, 500);
});

route('POST', '/api/bookings', (p, q, body) => {
  const childId = Number(body.child_id);
  const date = clean(body.date);
  const slot = clean(body.slot);
  const service = clean(body.service);
  const { bt, map } = joined();
  if (!map[childId]) throw new HttpError(400, 'กรุณาเลือกเด็กที่ต้องการจองคิว');
  if (!isDate(date)) throw new HttpError(400, 'กรุณาเลือกวันที่');
  if (date < todayStr()) throw new HttpError(400, 'ไม่สามารถจองคิวย้อนหลังได้');
  if (!SLOTS.includes(slot)) throw new HttpError(400, 'กรุณาเลือกช่วงเวลา');
  if (!SERVICES.includes(service)) throw new HttpError(400, 'กรุณาเลือกบริการ');
  if (bt.rows.some((b) => b.child_id === childId && b.date === date && b.status !== 'cancelled')) {
    throw new HttpError(409, 'เด็กคนนี้มีคิวในวันดังกล่าวแล้ว');
  }
  if (slotUsage(bt.rows, date).find((s) => s.slot === slot).used >= SLOT_CAPACITY) {
    throw new HttpError(409, 'ช่วงเวลานี้เต็มแล้ว กรุณาเลือกเวลาอื่น');
  }
  const queueNo = bt.rows.filter((b) => b.date === date).reduce((m, b) => Math.max(m, b.queue_no), 0) + 1;
  const now = nowStamp();
  const row = { id: nextId('bookings', bt.rows), child_id: childId, date, slot, queue_no: queueNo, service,
    note: clean(body.note), status: 'waiting', created_at: now, updated_at: now };
  writeRow(bt, row);
  return bookingView(row, map);
});

route('PATCH', '/api/bookings/:id', (p, q, body) => {
  if (!STATUSES.includes(body.status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
  const { bt, map } = joined();
  const b = bt.rows.find((x) => x.id === p.id);
  if (!b) throw new HttpError(404, 'ไม่พบคิว');
  const row = Object.assign({}, b, { status: body.status, updated_at: nowStamp() });
  writeRow(bt, row, b._row);
  return bookingView(row, map);
});

route('DELETE', '/api/bookings/:id', (p) => {
  const bt = table('bookings');
  const b = bt.rows.find((x) => x.id === p.id);
  if (!b) throw new HttpError(404, 'ไม่พบคิว');
  bt.sh.deleteRow(b._row);
  return { ok: true };
});

// หน้าจอเรียกคิว (ส่งเฉพาะข้อมูลย่อ)
route('GET', '/api/display', () => {
  const t = todayStr();
  const views = joined().views.filter((b) => b.date === t);
  const mask = (b) => ({ queue_no: b.queue_no, slot: b.slot, service: b.service, name: b.nickname || b.first_name });
  return {
    date: t,
    serving: views.filter((b) => b.status === 'serving').sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).map(mask),
    waiting: views.filter((b) => b.status === 'waiting').sort(byQueue).slice(0, 10).map(mask),
  };
});
