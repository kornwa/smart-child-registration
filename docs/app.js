// ---------- ตัวช่วยทั่วไป ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- เชื่อมต่อ Google Apps Script ----------
const store = {
  get: (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v, remember) => {
    try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch {}
  },
  clear: (k) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} },
};
const apiUrl = () => (window.APP_CONFIG && window.APP_CONFIG.API_URL) || store.get('scr_api_url');

let pending = 0;
async function api(path, opts = {}) {
  const u = new URL(path, 'http://local');
  const payload = {
    method: opts.method || 'GET',
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    body: opts.body,
    key: store.get('scr_key'),
  };
  document.body.classList.toggle('loading', ++pending > 0);
  try {
    // ส่งเป็น text/plain เพื่อไม่ให้เกิด CORS preflight ซึ่ง Apps Script ไม่รองรับ
    const res = await fetch(apiUrl(), { method: 'POST', body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({ status: 500, error: 'ติดต่อ Google Sheet ไม่ได้' }));
    if (out.status === 401 || out.status === 429) { showLogin(out.error); throw new Error(out.error); }
    if (out.status !== 200) throw new Error(out.error || 'เกิดข้อผิดพลาด');
    return out.data;
  } catch (err) {
    if (err instanceof TypeError) throw new Error('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือ URL ของ Apps Script');
    throw err;
  } finally {
    document.body.classList.toggle('loading', --pending > 0);
  }
}

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${type}`; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thDate(s) {
  if (!s) return '-';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

function ageText(birth) {
  if (!birth) return '-';
  const b = new Date(birth), n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  let m = n.getMonth() - b.getMonth();
  if (n.getDate() < b.getDate()) m--;
  if (m < 0) { y--; m += 12; }
  if (y <= 0 && m <= 0) {
    const days = Math.floor((n - b) / 86400000);
    return `${days} วัน`;
  }
  return y > 0 ? `${y} ปี ${m} เดือน` : `${m} เดือน`;
}

const STATUS_TH = { waiting: 'รอเรียก', serving: 'กำลังรับบริการ', done: 'เสร็จแล้ว', cancelled: 'ยกเลิก' };
const badge = (s) => `<span class="badge ${s}">${STATUS_TH[s]}</span>`;
const qno = (n) => String(n).padStart(3, '0');
const fullName = (c) => `${c.first_name} ${c.last_name}${c.nickname ? ` (${c.nickname})` : ''}`;

let CONFIG = { slots: [], services: [], capacity: 3, today: '' };

// ข้อผิดพลาดที่ไม่ได้ดักไว้ ให้แสดงเป็นข้อความแจ้งเตือน
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if ($('#login').hidden) toast((e.reason && e.reason.message) || 'เกิดข้อผิดพลาด', 'error');
});

// ---------- การสลับหน้า ----------
function show(view) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  location.hash = view;
  ({ dashboard: loadDashboard, children: loadChildren, booking: loadSlots, history: loadHistory })[view]?.();
}
$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.view) show(e.target.dataset.view); });
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) show(g.dataset.goto);
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

// ---------- คิววันนี้ ----------
async function loadStats() {
  const s = await api('/api/stats');
  $('#stats').innerHTML = [
    ['คิววันนี้', s.today], ['รอเรียก', s.waiting], ['เสร็จแล้ววันนี้', s.done],
    ['คิวล่วงหน้า', s.upcoming], ['เด็กในระบบ', s.children],
  ].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
}

function bookingActions(b) {
  const btn = (status, label, cls = '') => `<button class="btn sm ${cls}" data-status="${status}" data-id="${b.id}">${label}</button>`;
  const out = [];
  if (b.status === 'waiting') out.push(btn('serving', '📢 เรียกคิว', 'primary'));
  if (b.status === 'serving') out.push(btn('done', '✓ เสร็จสิ้น', 'green'), btn('waiting', 'ย้อนกลับ'));
  if (b.status === 'waiting') out.push(btn('cancelled', 'ยกเลิก', 'danger'));
  if (b.status === 'done' || b.status === 'cancelled') out.push(btn('waiting', 'คืนสถานะรอ'));
  return `<div class="btns">${out.join('')}</div>`;
}

function bookingRows(list, { showDate = false } = {}) {
  if (!list.length) return `<tr><td class="empty" colspan="8">ยังไม่มีคิว</td></tr>`;
  return list.map((b) => `
    <tr>
      <td class="qno">${qno(b.queue_no)}</td>
      ${showDate ? `<td>${thDate(b.date)}</td>` : ''}
      <td>${esc(b.slot)}</td>
      <td>
        <a class="name-link" data-child="${b.child_id}">${esc(fullName(b))}</a>
        <div class="sub">HN ${esc(b.hn)} · อายุ ${ageText(b.birth_date)}</div>
        ${b.allergies ? `<div class="allergy">⚠ แพ้: ${esc(b.allergies)}</div>` : ''}
      </td>
      <td>${esc(b.service)}${b.note ? `<div class="sub">${esc(b.note)}</div>` : ''}</td>
      <td>${esc(b.parent_name)}<div class="sub">${esc(b.parent_phone)}</div></td>
      <td>${badge(b.status)}</td>
      <td>${bookingActions(b)}</td>
    </tr>`).join('');
}

const BOOKING_HEAD = (showDate) => `<thead><tr><th>คิว</th>${showDate ? '<th>วันที่</th>' : ''}<th>เวลา</th><th>ชื่อเด็ก</th><th>บริการ</th><th>ผู้ปกครอง</th><th>สถานะ</th><th></th></tr></thead>`;

async function loadDashboard() {
  $('#today-label').textContent = thDate(CONFIG.today);
  const status = $('#dash-filter').value;
  const [list] = await Promise.all([
    api(`/api/bookings?date=${CONFIG.today}${status ? `&status=${status}` : ''}`),
    loadStats(),
  ]);
  $('#dash-table').innerHTML = BOOKING_HEAD(false) + `<tbody>${bookingRows(list)}</tbody>`;
}
$('#dash-filter').addEventListener('change', loadDashboard);

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  if (b.dataset.status === 'cancelled' && !(await confirmBox('ยืนยันการยกเลิกคิวนี้?'))) return;
  try {
    await api(`/api/bookings/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.status } });
    toast(`เปลี่ยนสถานะเป็น "${STATUS_TH[b.dataset.status]}" แล้ว`, 'ok');
    refreshCurrent();
  } catch (err) { toast(err.message, 'error'); }
});

function refreshCurrent() {
  const v = $('.view.active').id.replace('view-', '');
  ({ dashboard: loadDashboard, history: loadHistory })[v]?.();
  if ($('#detail-dialog').open) openDetail(currentDetailId);
}

// กล่องยืนยันแบบไม่ใช้ window.confirm
function confirmBox(msg) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.style.width = 'min(420px, 92vw)';
    d.innerHTML = `<p style="font-size:1.05rem;margin:4px 0 20px">${esc(msg)}</p>
      <div class="actions"><button class="btn" value="no">ไม่</button><button class="btn primary" value="yes">ยืนยัน</button></div>`;
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target.value) { d.close(); resolve(e.target.value === 'yes'); d.remove(); } });
    d.addEventListener('cancel', () => { resolve(false); d.remove(); });
    d.showModal();
  });
}

// ---------- ข้อมูลเด็ก ----------
let searchTimer;
async function loadChildren() {
  const q = $('#child-search').value.trim();
  const list = await api(`/api/children${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  $('#child-table').innerHTML = `
    <thead><tr><th>HN</th><th>ชื่อ-สกุล</th><th>เพศ</th><th>อายุ</th><th>ผู้ปกครอง</th><th>ข้อมูลสุขภาพ</th><th></th></tr></thead>
    <tbody>${list.length ? list.map((c) => `
      <tr>
        <td>${esc(c.hn)}</td>
        <td><a class="name-link" data-child="${c.id}">${esc(fullName(c))}</a><div class="sub">เกิด ${thDate(c.birth_date)}</div></td>
        <td>${esc(c.gender || '-')}</td>
        <td>${ageText(c.birth_date)}</td>
        <td>${esc(c.parent_name)}<div class="sub">${esc(c.parent_phone)}</div></td>
        <td>${c.allergies ? `<span class="allergy">⚠ แพ้ ${esc(c.allergies)}</span>` : '<span class="sub">ไม่มีประวัติแพ้</span>'}</td>
        <td><div class="btns">
          <button class="btn sm primary" data-book="${c.id}">จองคิว</button>
          <button class="btn sm" data-edit="${c.id}">แก้ไข</button>
        </div></td>
      </tr>`).join('') : `<tr><td class="empty" colspan="7">${q ? 'ไม่พบข้อมูลที่ค้นหา' : 'ยังไม่มีข้อมูลเด็ก กด "ลงทะเบียนเด็กใหม่" เพื่อเริ่มต้น'}</td></tr>`}</tbody>`;
}
$('#child-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadChildren, 250); });

const childDialog = $('#child-dialog');
const childForm = $('#child-form');
let editingId = null;
let afterSave = null;

function openChildForm(child = null, onSaved = null) {
  editingId = child?.id || null;
  afterSave = onSaved;
  childForm.reset();
  $('#child-dialog-title').textContent = child ? `แก้ไขข้อมูล ${child.first_name} ${child.last_name}` : 'ลงทะเบียนเด็กใหม่';
  if (child) for (const el of childForm.elements) if (el.name && child[el.name] != null) el.value = child[el.name];
  childForm.birth_date.max = CONFIG.today;
  childDialog.showModal();
}
$('#btn-new-child').addEventListener('click', () => openChildForm());

childForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(childForm));
  try {
    const saved = await api(editingId ? `/api/children/${editingId}` : '/api/children', { method: editingId ? 'PUT' : 'POST', body });
    childDialog.close();
    toast(editingId ? 'บันทึกการแก้ไขแล้ว' : `ลงทะเบียนสำเร็จ (HN ${saved.hn})`, 'ok');
    if (afterSave) afterSave(saved);
    loadChildren();
    if ($('#detail-dialog').open) openDetail(saved.id);
  } catch (err) { toast(err.message, 'error'); }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-child],[data-edit],[data-book],[data-del-child]');
  if (!t) return;
  if (t.dataset.child) return openDetail(Number(t.dataset.child));
  if (t.dataset.edit) return openChildForm(await api(`/api/children/${t.dataset.edit}`));
  if (t.dataset.book) {
    $('#detail-dialog').close();
    const c = await api(`/api/children/${t.dataset.book}`);
    show('booking'); pickChild(c);
  }
  if (t.dataset.delChild) {
    if (!(await confirmBox('ลบข้อมูลเด็กคนนี้และประวัติคิวทั้งหมด? การลบไม่สามารถย้อนกลับได้'))) return;
    try {
      await api(`/api/children/${t.dataset.delChild}`, { method: 'DELETE' });
      $('#detail-dialog').close(); toast('ลบข้อมูลแล้ว', 'ok'); loadChildren(); refreshCurrent();
    } catch (err) { toast(err.message, 'error'); }
  }
});

let currentDetailId = null;
async function openDetail(id) {
  currentDetailId = id;
  const c = await api(`/api/children/${id}`);
  const bmi = c.weight && c.height ? (c.weight / (c.height / 100) ** 2).toFixed(1) : null;
  const info = (k, v, cls = '') => `<div class="${cls}"><span class="k">${k}</span>${esc(v || '-')}</div>`;
  $('#detail-title').textContent = fullName(c);
  $('#detail-body').innerHTML = `
    ${c.allergies ? `<div class="alert">⚠ ประวัติแพ้: ${esc(c.allergies)}</div>` : ''}
    <div class="info-grid">
      ${info('HN', c.hn)}${info('เพศ', c.gender)}${info('วันเกิด / อายุ', `${thDate(c.birth_date)} (${ageText(c.birth_date)})`)}
      ${info('เลขบัตรประชาชน', c.citizen_id)}${info('กรุ๊ปเลือด', c.blood_type)}
      ${info('น้ำหนัก / ส่วนสูง', `${c.weight ?? '-'} กก. / ${c.height ?? '-'} ซม.${bmi ? ` (BMI ${bmi})` : ''}`)}
      ${info('โรคประจำตัว', c.conditions, 'full')}
      ${info('ผู้ปกครอง', `${c.parent_name}${c.parent_relation ? ` (${c.parent_relation})` : ''}`)}${info('เบอร์โทร', c.parent_phone)}${info('ลงทะเบียนเมื่อ', c.created_at)}
      ${info('ที่อยู่', c.address, 'full')}${info('หมายเหตุ', c.note, 'full')}
    </div>
    <div class="btns">
      <button class="btn primary" data-book="${c.id}">+ จองคิวให้เด็กคนนี้</button>
      <button class="btn" data-edit="${c.id}">แก้ไขข้อมูล</button>
      <button class="btn" onclick="window.print()">พิมพ์</button>
      <button class="btn danger" data-del-child="${c.id}">ลบ</button>
    </div>
    <h3>ประวัติการรับบริการ (${c.bookings.length})</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>วันที่</th><th>เวลา</th><th>คิว</th><th>บริการ</th><th>หมายเหตุ</th><th>สถานะ</th></tr></thead>
      <tbody>${c.bookings.length ? c.bookings.map((b) => `<tr><td>${thDate(b.date)}</td><td>${esc(b.slot)}</td><td>${qno(b.queue_no)}</td>
        <td>${esc(b.service)}</td><td>${esc(b.note || '-')}</td><td>${badge(b.status)}</td></tr>`).join('')
        : '<tr><td class="empty" colspan="6">ยังไม่มีประวัติ</td></tr>'}</tbody>
    </table></div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

// ---------- จองคิว ----------
const bk = { child: null, slot: null };

async function loadSlots() {
  const date = $('#bk-date').value;
  if (!date) return;
  const slots = await api(`/api/slots?date=${date}`);
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (bk.slot && !slots.find((s) => s.slot === bk.slot && s.used < s.capacity)) bk.slot = null;
  $('#bk-slots').innerHTML = slots.map((s) => {
    const full = s.used >= s.capacity;
    const past = date === CONFIG.today && s.slot < nowHM;
    if (past && bk.slot === s.slot) bk.slot = null;
    const left = s.capacity - s.used;
    return `<button type="button" class="slot ${bk.slot === s.slot ? 'selected' : ''}" data-slot="${s.slot}" ${full || past ? 'disabled' : ''}>
      <b>${s.slot}</b><span>${past ? 'เลยเวลาแล้ว' : full ? 'เต็ม' : `ว่าง ${left}/${s.capacity}`}</span></button>`;
  }).join('');
}
$('#bk-slots').addEventListener('click', (e) => {
  const s = e.target.closest('[data-slot]');
  if (!s || s.disabled) return;
  bk.slot = s.dataset.slot;
  $$('.slot').forEach((x) => x.classList.toggle('selected', x === s));
});
$('#bk-date').addEventListener('change', loadSlots);

function pickChild(c) {
  bk.child = c;
  $('#bk-child-list').hidden = true;
  $('#bk-child-search').value = '';
  $('#bk-child-search').hidden = true;
  const p = $('#bk-picked');
  p.hidden = false;
  p.innerHTML = `<div><b>${esc(fullName(c))}</b><div class="sub">HN ${esc(c.hn)} · อายุ ${ageText(c.birth_date)} · ผู้ปกครอง ${esc(c.parent_name)} ${esc(c.parent_phone)}</div>
    ${c.allergies ? `<div class="allergy">⚠ แพ้: ${esc(c.allergies)}</div>` : ''}</div>
    <button type="button" class="btn sm" id="bk-change">เปลี่ยน</button>`;
}
function unpickChild() {
  bk.child = null;
  $('#bk-picked').hidden = true;
  $('#bk-child-search').hidden = false;
  $('#bk-child-search').focus();
}
$('#bk-picked').addEventListener('click', (e) => { if (e.target.id === 'bk-change') unpickChild(); });

let pickTimer, pickResults = [];
$('#bk-child-search').addEventListener('input', (e) => {
  clearTimeout(pickTimer);
  const q = e.target.value.trim();
  if (!q) { $('#bk-child-list').hidden = true; return; }
  pickTimer = setTimeout(async () => {
    pickResults = await api(`/api/children?q=${encodeURIComponent(q)}`);
    const list = $('#bk-child-list');
    list.innerHTML = pickResults.length
      ? pickResults.slice(0, 20).map((c, i) => `<div class="picker-item" data-i="${i}"><b>${esc(fullName(c))}</b>
          <div class="sub">HN ${esc(c.hn)} · อายุ ${ageText(c.birth_date)} · ${esc(c.parent_name)} ${esc(c.parent_phone)}</div></div>`).join('')
      : '<div class="picker-item sub">ไม่พบข้อมูล</div>';
    list.hidden = false;
  }, 200);
});
$('#bk-child-list').addEventListener('click', (e) => {
  const it = e.target.closest('[data-i]');
  if (it) pickChild(pickResults[it.dataset.i]);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.picker')) $('#bk-child-list').hidden = true; });
$('#bk-new-child').addEventListener('click', (e) => { e.preventDefault(); openChildForm(null, pickChild); });

$('#booking-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!bk.child) return toast('กรุณาเลือกเด็กที่ต้องการจองคิว', 'error');
  if (!bk.slot) return toast('กรุณาเลือกช่วงเวลา', 'error');
  const f = e.target;
  try {
    const b = await api('/api/bookings', {
      method: 'POST',
      body: { child_id: bk.child.id, date: f.date.value, slot: bk.slot, service: f.service.value, note: f.note.value },
    });
    toast(`จองคิวสำเร็จ! คิวที่ ${qno(b.queue_no)} วันที่ ${thDate(b.date)} เวลา ${b.slot}`, 'ok');
    f.note.value = ''; bk.slot = null; unpickChild();
    loadSlots();
  } catch (err) { toast(err.message, 'error'); loadSlots(); }
});

// ---------- รายการคิวทั้งหมด ----------
async function loadHistory() {
  const date = $('#hist-date').value;
  const list = await api(`/api/bookings${date ? `?date=${date}` : ''}`);
  $('#hist-table').innerHTML = BOOKING_HEAD(true) + `<tbody>${bookingRows(list, { showDate: true })}</tbody>`;
}
$('#hist-date').addEventListener('change', loadHistory);
$('#hist-all').addEventListener('click', () => { $('#hist-date').value = ''; loadHistory(); });

// ---------- เข้าสู่ระบบ ----------
function showLogin(msg = '') {
  $('#login').hidden = false;
  $('#app').hidden = true;
  $('#login-url-row').hidden = Boolean(window.APP_CONFIG && window.APP_CONFIG.API_URL);
  $('#login-url').value = apiUrl();
  $('#login-msg').textContent = msg;
  $('#login-key').value = '';
  $('#login-key').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#login-url').value.trim();
  if (!$('#login-url-row').hidden) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
      $('#login-msg').textContent = 'URL ต้องเป็นของ Apps Script และลงท้ายด้วย /exec';
      return;
    }
    store.set('scr_api_url', url, true);
  }
  const remember = $('#login-remember').checked;
  store.clear('scr_key');
  store.set('scr_key', $('#login-key').value, remember);
  $('#login-msg').textContent = 'กำลังตรวจสอบ...';
  try { await start(); } catch (err) { if (!$('#login').hidden) $('#login-msg').textContent = err.message; }
});

$('#btn-logout').addEventListener('click', () => { store.clear('scr_key'); showLogin('ออกจากระบบแล้ว'); });

// ---------- เริ่มต้น ----------
let started = false;
async function start() {
  CONFIG = await api('/api/config');
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#bk-service').innerHTML = CONFIG.services.map((s) => `<option>${esc(s)}</option>`).join('');
  $('#bk-date').value = CONFIG.today;
  $('#bk-date').min = CONFIG.today;
  $('#hist-date').value = CONFIG.today;
  const v = location.hash.slice(1);
  show(['dashboard', 'children', 'booking', 'history'].includes(v) ? v : 'dashboard');
  if (!started) {
    started = true;
    setInterval(() => {
      if (!$('#app').hidden && $('#view-dashboard').classList.contains('active') && !document.querySelector('dialog[open]')) {
        loadDashboard().catch(() => {});
      }
    }, 20000);
  }
}

if (apiUrl() && store.get('scr_key')) start().catch((err) => showLogin(err.message));
else showLogin();
