/**
 * Smart Child Registration — ระบบจองคิวเข้าเรียนเนอสเซอรี่
 * ส่วนหลังบ้าน (Google Apps Script + Google Sheets)
 *
 * ชีตที่ใช้ (สร้างให้อัตโนมัติเมื่อเรียกใช้ครั้งแรก):
 *  - Children      ข้อมูลเด็กและผู้ปกครอง
 *  - Applications  ใบสมัคร/คิวรอเข้าเรียน (1 แถว = 1 การสมัคร)
 *  - Rooms         ห้องเรียนและจำนวนที่นั่ง
 *
 * รหัสผ่านเจ้าหน้าที่: เมนู "🧒 ระบบจองคิว" ในชีต > ตั้ง / เปลี่ยนรหัสผ่านเจ้าหน้าที่
 */

// ---------- ตั้งค่า ----------
const TZ = 'Asia/Bangkok';
const SLOW_AFTER_FAILS = 5; // รหัสเจ้าหน้าที่ผิดเกินจำนวนนี้ใน 10 นาที ระบบจะตอบช้าลงเพื่อกันการสุ่มรหัส

// กลุ่มตามอายุ ณ วันที่เริ่มเรียน
const GROUPS = [
  { id: 1, name: 'กลุ่ม 1', label: '6 สัปดาห์ – 1 ขวบ' },
  { id: 2, name: 'กลุ่ม 2', label: '1 – 2 ขวบ' },
  { id: 3, name: 'กลุ่ม 3', label: '2 – 3 ขวบ' },
];
// ห้องเริ่มต้น (แก้จำนวนที่นั่งได้จากหน้าเจ้าหน้าที่ > ตั้งค่าห้อง)
const DEFAULT_ROOMS = [
  { room: '1', group: 1, capacity: 10 },
  { room: '2/1', group: 2, capacity: 10 },
  { room: '2/2', group: 2, capacity: 10 },
  { room: '3/1', group: 3, capacity: 10 },
  { room: '3/2', group: 3, capacity: 10 },
  { room: '3/3', group: 3, capacity: 10 },
];
const APP_STATUSES = ['waiting', 'enrolled', 'cancelled', 'left'];
const START_AHEAD_DAYS = 548; // เลือกวันเริ่มเรียนล่วงหน้าได้ไม่เกิน ~18 เดือน

const SHEETS = {
  children: {
    name: 'Children',
    cols: ['id', 'hn', 'first_name', 'last_name', 'nickname', 'gender', 'birth_date', 'citizen_id', 'blood_type',
      'weight', 'height', 'allergies', 'conditions', 'parent_name', 'parent_relation', 'parent_phone', 'address',
      'note', 'created_at', 'updated_at'],
  },
  applications: {
    name: 'Applications',
    cols: ['id', 'child_id', 'group', 'queue_no', 'start_date', 'status', 'room', 'note', 'source',
      'enrolled_at', 'created_at', 'updated_at'],
  },
  rooms: {
    name: 'Rooms',
    cols: ['room', 'group', 'capacity'],
  },
};
const NUM_COLS = ['id', 'child_id', 'group', 'queue_no', 'weight', 'height', 'capacity'];

// ---------- เมนูในชีต ----------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧒 ระบบจองคิว')
    .addItem('ตั้ง / เปลี่ยนรหัสผ่านเจ้าหน้าที่', 'setPasswordFromMenu')
    .addToUi();
}

function setPasswordFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ตั้งรหัสผ่านเจ้าหน้าที่',
    'รหัสนี้ใช้เข้าหน้าเจ้าหน้าที่ ควรยาว 12 ตัวขึ้นไป และไม่ซ้ำกับรหัสอีเมล', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (key.length < 8) {
    ui.alert('รหัสสั้นเกินไป กรุณาตั้งอย่างน้อย 8 ตัว (แนะนำ 12 ตัวขึ้นไป)');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ACCESS_KEY', key);
  setup();
  ui.alert('ตั้งรหัสผ่านเรียบร้อย ✅\nเจ้าหน้าที่ใช้รหัสนี้เข้าหน้าเจ้าหน้าที่ได้เลย');
}

// สร้างชีตที่ยังไม่มี (เรียกซ้ำได้ ไม่ลบข้อมูลเดิม)
function setup() {
  Object.keys(SHEETS).forEach((k) => sheetFor(k));
}

function sheetFor(name) {
  const def = SHEETS[name];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight('bold').setBackground('#e8f1fd');
    sh.setFrozenRows(1);
    if (name === 'rooms') {
      sh.getRange(2, 1, DEFAULT_ROOMS.length, 3)
        .setValues(DEFAULT_ROOMS.map((r) => ["'" + r.room, r.group, r.capacity]));
    }
  }
  return sh;
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
    const path = String(req.path || '');
    const isParent = path.indexOf('/parent/') === 0; // ผู้ปกครองยืนยันตัวตนด้วยข้อมูลเด็ก ไม่ใช้รหัสเจ้าหน้าที่
    if (!isParent) checkKey(req.key);
    const method = String(req.method || 'GET').toUpperCase();
    const write = method !== 'GET';
    const lock = LockService.getScriptLock();
    if (write) lock.waitLock(20000);
    try {
      const data = isParent
        ? dispatch(PARENT_ROUTES, method, path, req.query || {}, req.body || {}, req.auth || {})
        : dispatch(ROUTES, method, path, req.query || {}, req.body || {}, null);
      return json({ status: 200, data });
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
  if (!real) throw new HttpError(500, 'ยังไม่ได้ตั้งรหัสผ่านเจ้าหน้าที่ (เมนู 🧒 ระบบจองคิว ในชีต)');
  if (String(key || '') === real) return; // รหัสถูกเข้าได้เสมอ คนนอกจึงล็อกเจ้าหน้าที่ออกจากระบบไม่ได้
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0) + 1;
  cache.put('login_fails', String(fails), 600);
  if (fails > SLOW_AFTER_FAILS) Utilities.sleep(Math.min(fails, 20) * 500);
  throw new HttpError(401, 'รหัสผ่านไม่ถูกต้อง');
}

// ---------- ตัวช่วยชีต ----------
function table(name) {
  const sh = sheetFor(name);
  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const o = { _row: i + 1 };
    header.forEach((h, j) => { o[h] = fromCell(h, values[i][j]); });
    if (name === 'rooms' ? o.room : o.id) rows.push(o);
  }
  return { sh, header, rows };
}

function fromCell(col, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (col === 'created_at' || col === 'updated_at' || col === 'enrolled_at') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
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

function nextSeq(key, currentMax) {
  const props = PropertiesService.getScriptProperties();
  const n = Math.max(Number(props.getProperty(key) || 0), currentMax) + 1;
  props.setProperty(key, String(n));
  return n;
}
const nextId = (name, rows) => nextSeq('seq_' + name, rows.reduce((m, r) => Math.max(m, r.id), 0));

const strip = (o) => { if (!o) return o; const c = Object.assign({}, o); delete c._row; return c; };
const todayStr = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const nowStamp = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const clean = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const digits = (v) => String(v || '').replace(/[^\d]/g, '');
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function validCitizenId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

// ---------- อายุและกลุ่ม ----------
function ageParts(birth, at) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = at.split('-').map(Number);
  let months = (ay - by) * 12 + (am - bm);
  if (ad < bd) months--;
  const days = Math.round((Date.parse(at) - Date.parse(birth)) / 86400000);
  return { months, days };
}

// คืนเลขกลุ่ม หรือ throw ถ้าอายุไม่อยู่ในช่วงที่รับ
function groupFor(birth, startDate) {
  const a = ageParts(birth, startDate);
  if (a.days < 42) throw new HttpError(400, 'ณ วันเริ่มเรียน น้องจะอายุยังไม่ถึง 6 สัปดาห์ กรุณาเลือกวันเริ่มเรียนให้ช้าลง');
  if (a.months < 12) return 1;
  if (a.months < 24) return 2;
  if (a.months < 36) return 3;
  throw new HttpError(400, 'ณ วันเริ่มเรียน น้องจะอายุครบ 3 ขวบแล้ว ซึ่งเกินช่วงอายุที่รับ (6 สัปดาห์ – 3 ขวบ)');
}

// ---------- ข้อมูลเด็ก ----------
function readChild(body, requireCitizen) {
  const c = {
    first_name: clean(body.first_name),
    last_name: clean(body.last_name),
    nickname: clean(body.nickname),
    gender: clean(body.gender),
    birth_date: clean(body.birth_date),
    citizen_id: digits(body.citizen_id) || null,
    blood_type: clean(body.blood_type),
    weight: num(body.weight),
    height: num(body.height),
    allergies: clean(body.allergies),
    conditions: clean(body.conditions),
    parent_name: clean(body.parent_name),
    parent_relation: clean(body.parent_relation),
    parent_phone: digits(body.parent_phone) || null,
    address: clean(body.address),
    note: clean(body.note),
  };
  if (!c.first_name || !c.last_name) throw new HttpError(400, 'กรุณากรอกชื่อและนามสกุลของเด็ก');
  if (!isDate(c.birth_date)) throw new HttpError(400, 'กรุณาระบุวันเกิดให้ถูกต้อง');
  if (c.birth_date > todayStr()) throw new HttpError(400, 'วันเกิดต้องไม่เป็นวันในอนาคต');
  if (requireCitizen && !c.citizen_id) throw new HttpError(400, 'กรุณากรอกเลขบัตรประชาชนของเด็ก');
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
  const max = rows.filter((r) => r.hn && r.hn.indexOf(prefix + '-') === 0)
    .reduce((m, r) => Math.max(m, Number(r.hn.split('-')[1]) || 0), 0);
  return prefix + '-' + String(nextSeq('seq_hn_' + prefix, max)).padStart(5, '0');
}

function assertUniqueCitizen(rows, citizenId, exceptId) {
  if (citizenId && rows.some((c) => c.citizen_id === citizenId && c.id !== exceptId)) {
    throw new HttpError(409, 'เลขบัตรประชาชนนี้มีในระบบแล้ว');
  }
}

function insertChild(c) {
  const t = table('children');
  assertUniqueCitizen(t.rows, c.citizen_id, 0);
  const now = nowStamp();
  const row = Object.assign({ id: nextId('children', t.rows), hn: nextHn(t.rows) }, c, { created_at: now, updated_at: now });
  writeRow(t, row);
  return row;
}

// ---------- ใบสมัคร / คิว ----------
const qLabel = (a) => a.group + '-' + String(a.queue_no).padStart(3, '0');
const ACTIVE = (a) => a.status === 'waiting' || a.status === 'enrolled';

// ลำดับปัจจุบันในกลุ่ม (เฉพาะคิวที่ยังรออยู่)
function positionOf(a, apps) {
  if (a.status !== 'waiting') return null;
  return 1 + apps.filter((x) => x.status === 'waiting' && x.group === a.group && x.queue_no < a.queue_no).length;
}

// ตรวจวันเริ่มเรียนและคืนเลขกลุ่ม
function checkStart(birthDate, startDate) {
  if (!isDate(startDate)) throw new HttpError(400, 'กรุณาเลือกวันที่ต้องการให้เริ่มเรียน');
  if (startDate < todayStr()) throw new HttpError(400, 'วันเริ่มเรียนต้องไม่ใช่วันที่ผ่านมาแล้ว');
  if (startDate > addDays(todayStr(), START_AHEAD_DAYS)) throw new HttpError(400, 'เลือกวันเริ่มเรียนล่วงหน้าได้ไม่เกิน 18 เดือน');
  return groupFor(birthDate, startDate);
}

function createApplication(child, body, source) {
  const startDate = clean(body.start_date);
  const group = checkStart(child.birth_date, startDate);
  const t = table('applications');
  if (t.rows.some((a) => a.child_id === child.id && ACTIVE(a))) {
    throw new HttpError(409, 'น้องมีคิวหรือกำลังเรียนอยู่แล้ว');
  }
  const max = t.rows.filter((a) => a.group === group).reduce((m, a) => Math.max(m, a.queue_no), 0);
  const now = nowStamp();
  const row = {
    id: nextId('applications', t.rows), child_id: child.id, group, queue_no: nextSeq('seq_queue_g' + group, max),
    start_date: startDate, status: 'waiting', room: null, note: clean(body.note), source,
    enrolled_at: null, created_at: now, updated_at: now,
  };
  writeRow(t, row);
  row.position = positionOf(row, t.rows.concat([row]));
  return row;
}

function appView(a, apps, childMap) {
  const v = strip(a);
  v.queue_label = qLabel(a);
  v.position = positionOf(a, apps);
  const c = childMap && childMap[a.child_id];
  if (c) {
    Object.assign(v, {
      hn: c.hn, first_name: c.first_name, last_name: c.last_name, nickname: c.nickname, birth_date: c.birth_date,
      gender: c.gender, parent_name: c.parent_name, parent_phone: c.parent_phone, allergies: c.allergies,
    });
  }
  return v;
}

function roomsWithUsage(apps) {
  return table('rooms').rows.map((r) => {
    const kids = apps.filter((a) => a.status === 'enrolled' && a.room === r.room);
    return { room: r.room, group: r.group, capacity: r.capacity, used: kids.length };
  });
}

// ---------- เส้นทาง API ----------
function makeRoute(list) {
  return (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([0-9]+)'; }) + '$');
    list.push({ method, re, keys, handler });
  };
}
const ROUTES = [];
const PARENT_ROUTES = [];
const route = makeRoute(ROUTES);
const parentRoute = makeRoute(PARENT_ROUTES);

function dispatch(list, method, path, query, body, auth) {
  for (const r of list) {
    const m = r.method === method && path.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });
    return list === PARENT_ROUTES
      ? r.handler(parentAuth(auth, path), params, query, body)
      : r.handler(params, query, body);
  }
  throw new HttpError(404, 'ไม่พบ API');
}

// =====================================================================
// เจ้าหน้าที่ (ต้องใช้รหัสผ่านเจ้าหน้าที่)
// =====================================================================
route('GET', '/api/config', () => ({ groups: GROUPS, statuses: APP_STATUSES, today: todayStr() }));

route('GET', '/api/stats', () => {
  const apps = table('applications').rows;
  const rooms = roomsWithUsage(apps);
  return {
    children: table('children').rows.length,
    groups: GROUPS.map((g) => {
      const rs = rooms.filter((r) => r.group === g.id);
      return {
        id: g.id, name: g.name, label: g.label,
        waiting: apps.filter((a) => a.group === g.id && a.status === 'waiting').length,
        enrolled: rs.reduce((s, r) => s + r.used, 0),
        capacity: rs.reduce((s, r) => s + r.capacity, 0),
      };
    }),
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
  return rows.slice(0, 300).map(strip);
});

route('GET', '/api/children/:id', (p) => {
  const child = table('children').rows.find((c) => c.id === p.id);
  if (!child) throw new HttpError(404, 'ไม่พบข้อมูลเด็ก');
  const apps = table('applications').rows;
  const out = strip(child);
  out.applications = apps.filter((a) => a.child_id === p.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((a) => appView(a, apps, null));
  return out;
});

route('POST', '/api/children', (p, q, body) => strip(insertChild(readChild(body, false))));

route('PUT', '/api/children/:id', (p, q, body) => {
  const t = table('children');
  const old = t.rows.find((c) => c.id === p.id);
  if (!old) throw new HttpError(404, 'ไม่พบข้อมูลเด็ก');
  const c = readChild(body, false);
  assertUniqueCitizen(t.rows, c.citizen_id, p.id);
  const row = Object.assign({}, old, c, { updated_at: nowStamp() });
  writeRow(t, row, old._row);
  return strip(row);
});

route('DELETE', '/api/children/:id', (p) => {
  const at = table('applications');
  deleteRows(at, at.rows.filter((a) => a.child_id === p.id).map((a) => a._row));
  const ct = table('children');
  const c = ct.rows.find((x) => x.id === p.id);
  if (!c) throw new HttpError(404, 'ไม่พบข้อมูลเด็ก');
  ct.sh.deleteRow(c._row);
  return { ok: true };
});

// คิว / ใบสมัคร
route('GET', '/api/applications', (p, query) => {
  const apps = table('applications').rows;
  const map = {};
  table('children').rows.forEach((c) => { map[c.id] = c; });
  const g = Number(query.group) || 0;
  const s = APP_STATUSES.includes(query.status) ? query.status : '';
  return apps
    .filter((a) => map[a.child_id] && (!g || a.group === g) && (!s || a.status === s))
    .sort((a, b) => (a.group - b.group) || (a.queue_no - b.queue_no))
    .map((a) => appView(a, apps, map));
});

route('POST', '/api/applications', (p, q, body) => {
  const child = table('children').rows.find((c) => c.id === Number(body.child_id));
  if (!child) throw new HttpError(400, 'กรุณาเลือกเด็ก');
  return strip(createApplication(child, body, 'staff'));
});

function findApp(id) {
  const t = table('applications');
  const a = t.rows.find((x) => x.id === id);
  if (!a) throw new HttpError(404, 'ไม่พบคิว');
  return { t, a };
}

function assertRoomFree(roomName, apps, exceptAppId) {
  const room = table('rooms').rows.find((r) => r.room === roomName);
  if (!room) throw new HttpError(400, 'ไม่พบห้อง ' + roomName);
  const used = apps.filter((a) => a.status === 'enrolled' && a.room === room.room && a.id !== exceptAppId).length;
  if (used >= room.capacity) throw new HttpError(409, 'ห้อง ' + room.room + ' เต็มแล้ว (' + used + '/' + room.capacity + ')');
  return room;
}

// รับเข้าเรียน / ย้ายห้อง
route('POST', '/api/applications/:id/enroll', (p, q, body) => {
  const { t, a } = findApp(p.id);
  if (a.status !== 'waiting' && a.status !== 'enrolled') throw new HttpError(400, 'คิวนี้ถูกยกเลิกหรือออกไปแล้ว ให้คืนสถานะรอคิวก่อน');
  const room = assertRoomFree(clean(body.room), t.rows, a.id);
  const now = nowStamp();
  const row = Object.assign({}, a, {
    status: 'enrolled', room: room.room, // เลขคิวเดิมคงไว้ ห้องบอกว่าเรียนกลุ่มไหน
    enrolled_at: a.status === 'enrolled' ? a.enrolled_at : now, updated_at: now,
  });
  writeRow(t, row, a._row);
  return strip(row);
});

// เปลี่ยนสถานะ: กลับไปรอคิว / ยกเลิก / ออกแล้ว
route('POST', '/api/applications/:id/status', (p, q, body) => {
  const status = String(body.status || '');
  if (!['waiting', 'cancelled', 'left'].includes(status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
  const { t, a } = findApp(p.id);
  if (status === 'waiting' && t.rows.some((x) => x.child_id === a.child_id && x.id !== a.id && ACTIVE(x))) {
    throw new HttpError(409, 'เด็กคนนี้มีคิวอื่นที่ยังใช้งานอยู่');
  }
  const row = Object.assign({}, a, { status, room: status === 'left' ? a.room : null, updated_at: nowStamp() });
  writeRow(t, row, a._row);
  return strip(row);
});

route('DELETE', '/api/applications/:id', (p) => {
  const { t, a } = findApp(p.id);
  t.sh.deleteRow(a._row);
  return { ok: true };
});

// ห้องเรียน
route('GET', '/api/rooms', () => {
  const apps = table('applications').rows;
  const map = {};
  table('children').rows.forEach((c) => { map[c.id] = c; });
  return roomsWithUsage(apps).map((r) => Object.assign(r, {
    children: apps.filter((a) => a.status === 'enrolled' && a.room === r.room && map[a.child_id])
      .map((a) => appView(a, apps, map)),
  }));
});

route('PUT', '/api/rooms', (p, q, body) => {
  const t = table('rooms');
  const apps = table('applications').rows;
  const updates = Array.isArray(body.rooms) ? body.rooms : [];
  updates.forEach((u) => {
    const r = t.rows.find((x) => x.room === String(u.room));
    if (!r) return;
    const cap = Number(u.capacity);
    if (!Number.isInteger(cap) || cap < 0 || cap > 200) throw new HttpError(400, 'จำนวนที่นั่งห้อง ' + r.room + ' ไม่ถูกต้อง');
    const used = apps.filter((a) => a.status === 'enrolled' && a.room === r.room).length;
    if (cap < used) throw new HttpError(400, 'ห้อง ' + r.room + ' มีเด็กเรียนอยู่ ' + used + ' คน ตั้งที่นั่งน้อยกว่านี้ไม่ได้');
    writeRow(t, Object.assign({}, r, { capacity: cap }), r._row);
  });
  return roomsWithUsage(apps);
});

// =====================================================================
// ผู้ปกครอง: สมัครเอง และเข้าดูด้วย เลขบัตรประชาชนเด็กหรือ HN + เบอร์โทรผู้ปกครอง
// เห็นและจัดการได้เฉพาะข้อมูลของเด็กคนนั้นเท่านั้น
// =====================================================================
const PARENT_MAX_FAILS = 5;     // กรอกผิดเกินนี้ ล็อกตัวระบุนั้น 15 นาที
const APPLY_LIMIT_HOURLY = 60;  // จำนวนใบสมัครออนไลน์สูงสุดต่อชั่วโมง (กันสแปม)

function parentAuth(auth, path) {
  if (path === '/parent/apply' || path === '/parent/config') return null; // สมัครใหม่ไม่ต้องยืนยันตัวตน
  const ident = digits(auth.ident);
  const phone = digits(auth.phone);
  if (!ident || !phone) throw new HttpError(401, 'กรุณากรอกเลขบัตรประชาชน/HN และเบอร์โทรให้ครบ');
  const cache = CacheService.getScriptCache();
  const ck = 'pfail_' + ident;
  const fails = Number(cache.get(ck) || 0);
  if (fails >= PARENT_MAX_FAILS) throw new HttpError(429, 'กรอกข้อมูลผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
  const child = table('children').rows.find((c) =>
    (c.citizen_id === ident || digits(c.hn) === ident) && digits(c.parent_phone) === phone);
  if (!child) {
    cache.put(ck, String(fails + 1), 900);
    Utilities.sleep(800);
    throw new HttpError(401, 'ไม่พบข้อมูล กรุณาตรวจสอบเลขบัตรประชาชน/HN และเบอร์โทรที่ใช้ตอนสมัคร');
  }
  cache.remove(ck);
  return child;
}

// ส่งเฉพาะข้อมูลที่ผู้ปกครองจำเป็นต้องเห็น
function parentChildView(c) {
  return {
    hn: c.hn, first_name: c.first_name, last_name: c.last_name, nickname: c.nickname, gender: c.gender,
    birth_date: c.birth_date, blood_type: c.blood_type, weight: c.weight, height: c.height,
    allergies: c.allergies, conditions: c.conditions, parent_name: c.parent_name,
  };
}

function parentAppView(a, apps) {
  return {
    id: a.id, group: a.group, queue_label: qLabel(a), start_date: a.start_date, status: a.status, room: a.room,
    note: a.note, created_at: a.created_at, enrolled_at: a.enrolled_at, position: positionOf(a, apps),
  };
}

function parentState(child) {
  const apps = table('applications').rows;
  return {
    child: parentChildView(child),
    applications: apps.filter((a) => a.child_id === child.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((a) => parentAppView(a, apps)),
    config: { groups: GROUPS, today: todayStr(), start_ahead_days: START_AHEAD_DAYS },
  };
}

parentRoute('GET', '/parent/config', () => ({ groups: GROUPS, today: todayStr(), start_ahead_days: START_AHEAD_DAYS }));

parentRoute('POST', '/parent/apply', (none, p, q, body) => {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('apply_count') || 0);
  if (n >= APPLY_LIMIT_HOURLY) throw new HttpError(429, 'มีผู้สมัครจำนวนมาก กรุณาลองใหม่ภายหลัง');
  if (body.consent !== true) throw new HttpError(400, 'กรุณากดยินยอมให้เก็บข้อมูลก่อนสมัคร');
  const c = readChild(body, true);
  const existing = table('children').rows.find((x) => x.citizen_id === c.citizen_id);
  if (existing) throw new HttpError(409, 'น้องเคยสมัครไว้แล้ว กรุณากด "เช็กคิว" แล้วเข้าด้วยเลขบัตรประชาชนและเบอร์โทร');
  checkStart(c.birth_date, clean(body.start_date)); // ตรวจก่อนบันทึก จะได้ไม่มีข้อมูลเด็กค้างถ้าวันหรืออายุไม่ตรง
  const child = insertChild(c);
  const app = createApplication(child, body, 'parent');
  cache.put('apply_count', String(n + 1), 3600);
  return Object.assign(parentState(child), { new_application_id: app.id });
});

parentRoute('GET', '/parent/me', (child) => parentState(child));

// สมัครคิวใหม่อีกครั้ง (เช่น เคยยกเลิกไปแล้ว)
parentRoute('POST', '/parent/applications', (child, p, q, body) => {
  createApplication(child, body, 'parent');
  return parentState(child);
});

parentRoute('POST', '/parent/applications/:id/cancel', (child, p) => {
  const t = table('applications');
  const a = t.rows.find((x) => x.id === p.id && x.child_id === child.id);
  if (!a) throw new HttpError(404, 'ไม่พบคิว');
  if (a.status !== 'waiting') throw new HttpError(400, 'ยกเลิกได้เฉพาะคิวที่ยังรออยู่ ถ้าน้องเรียนอยู่แล้วกรุณาติดต่อเจ้าหน้าที่');
  writeRow(t, Object.assign({}, a, { status: 'cancelled', updated_at: nowStamp() }), a._row);
  return parentState(child);
});
