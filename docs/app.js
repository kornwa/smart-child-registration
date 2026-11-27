// ---------- หน้าเจ้าหน้าที่: จองคิวเนอสเซอรี่ ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- เชื่อมต่อ Google Apps Script ----------
const store = {
  get: (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v, remember) => { try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch {} },
  clear: (k) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} },
};
const apiUrl = () => (window.APP_CONFIG && window.APP_CONFIG.API_URL) || store.get('scr_api_url');

let pending = 0;
async function api(path, opts = {}) {
  const u = new URL(path, 'http://local');
  const payload = {
    method: opts.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams),
    body: opts.body, key: store.get('scr_key'),
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
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if ($('#login').hidden) toast((e.reason && e.reason.message) || 'เกิดข้อผิดพลาด', 'error');
});

// ---------- ตัวช่วยแสดงผล ----------
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`; };
function ageText(birth, at = CONFIG.today) {
  if (!birth) return '-';
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = at.split('-').map(Number);
  let months = (ay - by) * 12 + (am - bm);
  if (ad < bd) months--;
  if (months < 1) return `${Math.floor((Date.parse(at) - Date.parse(birth)) / 6048e5)} สัปดาห์`;
  const y = Math.floor(months / 12), m = months % 12;
  return y ? `${y} ปี${m ? ` ${m} ด.` : ''}` : `${m} เดือน`;
}
const STATUS_TH = { waiting: 'รอคิว', enrolled: 'เข้าเรียนแล้ว', cancelled: 'ยกเลิก', left: 'ออกแล้ว' };
const STATUS_BADGE = { waiting: 'waiting', enrolled: 'done', cancelled: 'cancelled', left: 'cancelled' };
const badge = (s) => `<span class="badge ${STATUS_BADGE[s]}">${STATUS_TH[s]}</span>`;
const fullName = (c) => `${c.first_name} ${c.last_name}${c.nickname ? ` (${c.nickname})` : ''}`;
const gName = (id) => (CONFIG.groups.find((g) => g.id === id) || {}).name || `กลุ่ม ${id}`;

let CONFIG = { groups: [], today: '' };

// ---------- สลับหน้า ----------
function show(view) {
  $$('#tabs button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  location.hash = view;
  ({ queue: loadQueue, rooms: loadRooms, children: loadChildren, settings: loadSettings })[view]?.();
}
$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.view) show(e.target.dataset.view); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) e.target.closest('dialog').close(); });

function refreshCurrent() {
  const v = $('.view.active').id.replace('view-', '');
  ({ queue: loadQueue, rooms: loadRooms, children: loadChildren })[v]?.();
  if ($('#detail-dialog').open) openDetail(currentDetailId);
}

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

// ---------- คิวรอเข้าเรียน ----------
let qGroup = 0;
async function loadStats() {
  const s = await api('/api/stats');
  $('#stats').innerHTML = s.groups.map((g) => `
    <div class="stat">
      <div class="l"><b>${esc(g.name)}</b> · ${esc(g.label)}</div>
      <div class="v">${g.waiting} <small>รอคิว</small></div>
      <div class="l">เรียนอยู่ ${g.enrolled}/${g.capacity} ที่นั่ง · ว่าง ${Math.max(g.capacity - g.enrolled, 0)}</div>
    </div>`).join('') + `<div class="stat"><div class="l">เด็กในระบบ</div><div class="v">${s.children}</div></div>`;
}

function renderGroupSeg() {
  $('#q-group').innerHTML = [{ id: 0, name: 'ทุกกลุ่ม' }].concat(CONFIG.groups)
    .map((g) => `<button data-g="${g.id}" class="${qGroup === g.id ? 'active' : ''}">${esc(g.name)}</button>`).join('');
}
$('#q-group').addEventListener('click', (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  qGroup = Number(b.dataset.g); renderGroupSeg(); loadQueue();
});
$('#q-status').addEventListener('change', () => loadQueue());

function appActions(a) {
  const btn = (attr, label, cls = '') => `<button class="btn sm ${cls}" ${attr}>${label}</button>`;
  const out = [];
  if (a.status === 'waiting') out.push(btn(`data-enroll="${a.id}"`, '✓ รับเข้าเรียน', 'green'), btn(`data-status="cancelled" data-id="${a.id}"`, 'ยกเลิก', 'danger'));
  if (a.status === 'enrolled') out.push(btn(`data-enroll="${a.id}"`, 'ย้ายห้อง'), btn(`data-status="left" data-id="${a.id}"`, 'ออก/จบ', 'danger'));
  if (a.status === 'cancelled' || a.status === 'left') out.push(btn(`data-status="waiting" data-id="${a.id}"`, 'คืนเข้าคิว'));
  return `<div class="btns">${out.join('')}</div>`;
}

let lastApps = [];
async function loadQueue() {
  const status = $('#q-status').value;
  const [apps] = await Promise.all([
    api(`/api/applications?status=${status}${qGroup ? `&group=${qGroup}` : ''}`),
    loadStats(),
  ]);
  lastApps = apps;
  $('#q-table').innerHTML = `<thead><tr>
      <th>${status === 'waiting' ? 'ลำดับ' : ''}</th><th>เลขคิว</th><th>ชื่อเด็ก</th><th>กลุ่ม</th><th>เริ่มเรียน</th>
      <th>ผู้ปกครอง</th><th>สมัครเมื่อ</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${apps.length ? apps.map((a) => `
      <tr>
        <td class="qno">${a.position ?? ''}</td>
        <td><b>${esc(a.queue_label)}</b></td>
        <td><a class="name-link" data-child="${a.child_id}">${esc(fullName(a))}</a>
          <div class="sub">HN ${esc(a.hn)} · อายุวันนี้ ${ageText(a.birth_date)}</div>
          ${a.allergies ? `<div class="allergy">⚠ แพ้: ${esc(a.allergies)}</div>` : ''}
          ${a.note ? `<div class="sub">📝 ${esc(a.note)}</div>` : ''}</td>
        <td>${esc(gName(a.group))}${a.room ? `<div class="sub">ห้อง ${esc(a.room)}</div>` : ''}</td>
        <td>${thDate(a.start_date)}<div class="sub">อายุตอนนั้น ${ageText(a.birth_date, a.start_date)}</div></td>
        <td>${esc(a.parent_name)}<div class="sub">${esc(a.parent_phone)}</div></td>
        <td>${thDate(a.created_at)}<div class="sub">${a.source === 'parent' ? 'สมัครออนไลน์' : 'เจ้าหน้าที่'}</div></td>
        <td>${badge(a.status)}</td>
        <td>${appActions(a)}</td>
      </tr>`).join('') : '<tr><td class="empty" colspan="9">ไม่มีรายการ</td></tr>'}</tbody>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-status][data-id]');
  if (!b) return;
  const s = b.dataset.status;
  const msg = { cancelled: 'ยกเลิกคิวนี้?', left: 'บันทึกว่าเด็กออก/จบจากห้องนี้แล้ว? ที่นั่งจะว่างทันที', waiting: 'คืนเข้าคิวรอ (ได้ลำดับเดิมตามเลขคิว)?' }[s];
  if (!(await confirmBox(msg))) return;
  await api(`/api/applications/${b.dataset.id}/status`, { method: 'POST', body: { status: s } });
  toast('บันทึกแล้ว', 'ok');
  refreshCurrent();
});

// เลือกห้องเพื่อรับเข้าเรียน / ย้ายห้อง
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-enroll]');
  if (!b) return;
  const id = Number(b.dataset.enroll);
  const [rooms, app] = [await api('/api/rooms'), lastAppById(id)];
  $('#room-title').textContent = app ? `${app.status === 'enrolled' ? 'ย้ายห้อง' : 'รับเข้าเรียน'}: ${fullName(app)}` : 'เลือกห้อง';
  const appGroup = app ? app.group : 0;
  const sorted = rooms.slice().sort((x, y) => (x.group === appGroup ? -1 : 0) - (y.group === appGroup ? -1 : 0) || x.room.localeCompare(y.room));
  $('#room-pick').innerHTML = sorted.map((r) => {
    const full = r.used >= r.capacity && !(app && app.room === r.room);
    const current = app && app.room === r.room;
    return `<button class="room-btn ${r.group === appGroup ? 'same' : ''}" data-room="${esc(r.room)}" data-app="${id}" ${full || current ? 'disabled' : ''}>
      <b>ห้อง ${esc(r.room)}</b><span>${esc(gName(r.group))}</span>
      <span>${current ? 'ห้องปัจจุบัน' : full ? 'เต็ม' : `ว่าง ${r.capacity - r.used} จาก ${r.capacity}`}</span></button>`;
  }).join('');
  $('#room-dialog').showModal();
});
function lastAppById(id) {
  return lastApps.find((a) => a.id === id) || lastRooms.flatMap((r) => r.children).find((a) => a.id === id) || detailApps.find((a) => a.id === id);
}
$('#room-pick').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-room]');
  if (!b || b.disabled) return;
  await api(`/api/applications/${b.dataset.app}/enroll`, { method: 'POST', body: { room: b.dataset.room } });
  $('#room-dialog').close();
  toast(`บันทึกเข้าห้อง ${b.dataset.room} แล้ว`, 'ok');
  refreshCurrent();
});

// ---------- ห้องเรียน ----------
let lastRooms = [];
async function loadRooms() {
  lastRooms = await api('/api/rooms');
  $('#rooms').innerHTML = CONFIG.groups.map((g) => `
    <h2 class="group-title">${esc(g.name)} <span class="muted">${esc(g.label)}</span></h2>
    <div class="room-grid">${lastRooms.filter((r) => r.group === g.id).map((r) => `
      <div class="card room-card">
        <div class="card-head"><h2>ห้อง ${esc(r.room)}</h2>
          <span class="badge ${r.used >= r.capacity ? 'cancelled' : 'done'}">${r.used}/${r.capacity} ที่นั่ง</span></div>
        <div class="meter"><span style="width:${r.capacity ? Math.min(100, (r.used / r.capacity) * 100) : 100}%"></span></div>
        ${r.children.length ? r.children.map((a) => `
          <div class="h-row">
            <div><a class="name-link" data-child="${a.child_id}">${esc(fullName(a))}</a>
              <div class="sub">อายุ ${ageText(a.birth_date)} · ${esc(a.parent_phone)}</div>
              ${a.allergies ? `<div class="allergy">⚠ ${esc(a.allergies)}</div>` : ''}</div>
            <div class="btns"><button class="btn sm" data-enroll="${a.id}">ย้าย</button>
              <button class="btn sm danger" data-status="left" data-id="${a.id}">ออก</button></div>
          </div>`).join('') : '<p class="sub">ยังไม่มีเด็กในห้องนี้</p>'}
      </div>`).join('')}</div>`).join('');
}

// ---------- ตั้งค่าห้อง ----------
async function loadSettings() {
  const rooms = await api('/api/rooms');
  $('#rooms-settings').innerHTML = `<thead><tr><th>ห้อง</th><th>กลุ่ม</th><th>เรียนอยู่</th><th>จำนวนที่นั่ง</th></tr></thead>
    <tbody>${rooms.map((r) => `<tr><td><b>${esc(r.room)}</b></td><td>${esc(gName(r.group))}</td><td>${r.used}</td>
      <td><input type="number" min="${r.used}" max="200" step="1" data-cap="${esc(r.room)}" value="${r.capacity}" style="max-width:110px"></td></tr>`).join('')}</tbody>`;
}
$('#rooms-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rooms = $$('[data-cap]').map((i) => ({ room: i.dataset.cap, capacity: Number(i.value) }));
  await api('/api/rooms', { method: 'PUT', body: { rooms } });
  toast('บันทึกจำนวนที่นั่งแล้ว', 'ok');
  loadSettings();
});

// ---------- ข้อมูลเด็ก ----------
let searchTimer;
async function loadChildren() {
  const q = $('#child-search').value.trim();
  const list = await api(`/api/children${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  $('#child-table').innerHTML = `
    <thead><tr><th>HN</th><th>ชื่อ-สกุล</th><th>อายุ</th><th>ผู้ปกครอง</th><th>สุขภาพ</th><th></th></tr></thead>
    <tbody>${list.length ? list.map((c) => `
      <tr>
        <td>${esc(c.hn)}</td>
        <td><a class="name-link" data-child="${c.id}">${esc(fullName(c))}</a><div class="sub">เกิด ${thDate(c.birth_date)}</div></td>
        <td>${ageText(c.birth_date)}</td>
        <td>${esc(c.parent_name)}<div class="sub">${esc(c.parent_phone)}</div></td>
        <td>${c.allergies ? `<span class="allergy">⚠ แพ้ ${esc(c.allergies)}</span>` : '<span class="sub">-</span>'}</td>
        <td><div class="btns">
          <button class="btn sm primary" data-queue="${c.id}">เพิ่มเข้าคิว</button>
          <button class="btn sm" data-edit="${c.id}">แก้ไข</button>
        </div></td>
      </tr>`).join('') : `<tr><td class="empty" colspan="6">${q ? 'ไม่พบข้อมูลที่ค้นหา' : 'ยังไม่มีข้อมูลเด็ก'}</td></tr>`}</tbody>`;
}
$('#child-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadChildren, 300); });

const childDialog = $('#child-dialog');
const childForm = $('#child-form');
let editingId = null;
function openChildForm(child = null) {
  editingId = child?.id || null;
  childForm.reset();
  $('#child-dialog-title').textContent = child ? `แก้ไขข้อมูล ${child.first_name} ${child.last_name}` : 'เพิ่มเด็ก';
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
    toast(editingId ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มเด็กแล้ว (HN ${saved.hn})`, 'ok');
    loadChildren();
    if ($('#detail-dialog').open) openDetail(saved.id);
  } catch (err) { toast(err.message, 'error'); }
});

// เพิ่มเข้าคิว (โดยเจ้าหน้าที่)
let queueChildId = null;
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-child],[data-edit],[data-queue],[data-del-child]');
  if (!t) return;
  if (t.dataset.child) return openDetail(Number(t.dataset.child));
  if (t.dataset.edit) return openChildForm(await api(`/api/children/${t.dataset.edit}`));
  if (t.dataset.queue) {
    queueChildId = Number(t.dataset.queue);
    $('#queue-form').reset();
    $('#qd-start').min = CONFIG.today;
    $('#qd-start').value = CONFIG.today;
    $('#queue-dialog').showModal();
  }
  if (t.dataset.delChild) {
    if (!(await confirmBox('ลบข้อมูลเด็กคนนี้และประวัติคิวทั้งหมด? การลบไม่สามารถย้อนกลับได้'))) return;
    await api(`/api/children/${t.dataset.delChild}`, { method: 'DELETE' });
    $('#detail-dialog').close(); toast('ลบข้อมูลแล้ว', 'ok'); refreshCurrent();
  }
});
$('#queue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const a = await api('/api/applications', { method: 'POST', body: { child_id: queueChildId, start_date: $('#qd-start').value, note: $('#qd-note').value } });
    $('#queue-dialog').close();
    toast(`เพิ่มเข้าคิวแล้ว: ${gName(a.group)} เลขคิว ${a.group}-${String(a.queue_no).padStart(3, '0')}`, 'ok');
    refreshCurrent();
  } catch (err) { toast(err.message, 'error'); }
});

let currentDetailId = null, detailApps = [];
async function openDetail(id) {
  currentDetailId = id;
  const c = await api(`/api/children/${id}`);
  detailApps = c.applications.map((a) => Object.assign({}, a, c, { id: a.id, child_id: c.id, note: a.note }));
  const info = (k, v, cls = '') => `<div class="${cls}"><span class="k">${k}</span>${esc(v || '-')}</div>`;
  $('#detail-title').textContent = fullName(c);
  $('#detail-body').innerHTML = `
    ${c.allergies ? `<div class="alert">⚠ ประวัติแพ้: ${esc(c.allergies)}</div>` : ''}
    <div class="info-grid">
      ${info('HN', c.hn)}${info('เพศ', c.gender)}${info('วันเกิด / อายุ', `${thDate(c.birth_date)} (${ageText(c.birth_date)})`)}
      ${info('เลขบัตรประชาชน', c.citizen_id)}${info('กรุ๊ปเลือด', c.blood_type)}${info('น้ำหนัก / ส่วนสูง', `${c.weight ?? '-'} กก. / ${c.height ?? '-'} ซม.`)}
      ${info('โรคประจำตัว', c.conditions, 'full')}
      ${info('ผู้ปกครอง', `${c.parent_name}${c.parent_relation ? ` (${c.parent_relation})` : ''}`)}${info('เบอร์โทร', c.parent_phone)}${info('ลงทะเบียนเมื่อ', thDate(c.created_at))}
      ${info('ที่อยู่', c.address, 'full')}${info('หมายเหตุ', c.note, 'full')}
    </div>
    <div class="btns">
      <button class="btn primary" data-queue="${c.id}">+ เพิ่มเข้าคิว</button>
      <button class="btn" data-edit="${c.id}">แก้ไขข้อมูล</button>
      <button class="btn" onclick="window.print()">พิมพ์</button>
      <button class="btn" data-reset-pin="${esc(c.parent_phone)}">รีเซ็ต PIN ผู้ปกครอง</button>
      <button class="btn danger" data-del-child="${c.id}">ลบ</button>
    </div>
    <h3>ประวัติคิว / การเข้าเรียน (${c.applications.length})</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>เลขคิว</th><th>กลุ่ม/ห้อง</th><th>เริ่มเรียน</th><th>สมัครเมื่อ</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${c.applications.length ? c.applications.map((a) => `<tr><td><b>${esc(a.queue_label)}</b>${a.position ? `<div class="sub">ลำดับ ${a.position}</div>` : ''}</td>
        <td>${esc(gName(a.group))}${a.room ? ` · ห้อง ${esc(a.room)}` : ''}</td><td>${thDate(a.start_date)}</td><td>${thDate(a.created_at)}</td>
        <td>${badge(a.status)}</td><td>${appActions(a)}</td></tr>`).join('')
        : '<tr><td class="empty" colspan="6">ยังไม่มีประวัติ</td></tr>'}</tbody>
    </table></div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

// รีเซ็ตบัญชีผู้ปกครอง (ลืม PIN): ผู้ปกครองลงทะเบียนใหม่ด้วยเบอร์เดิม โดยยืนยันด้วยเลขบัตรลูก
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-reset-pin]');
  if (!b) return;
  const phone = b.dataset.resetPin;
  const acc = await api(`/api/parent-account?phone=${encodeURIComponent(phone)}`);
  if (!acc) return toast(`เบอร์ ${phone} ยังไม่ได้ลงทะเบียนบัญชีผู้ปกครอง`, 'error');
  if (!(await confirmBox(`รีเซ็ตบัญชีของ ${acc.name} (${acc.phone})? ผู้ปกครองต้องลงทะเบียนใหม่ด้วยเบอร์เดิม และกรอกเลขบัตรประชาชนลูกเพื่อยืนยัน`))) return;
  await api('/api/parent-account/reset', { method: 'POST', body: { phone } });
  toast('รีเซ็ตแล้ว แจ้งผู้ปกครองให้ลงทะเบียนใหม่ได้เลย', 'ok');
});

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
  store.clear('scr_key');
  store.set('scr_key', $('#login-key').value, $('#login-remember').checked);
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
  renderGroupSeg();
  const v = location.hash.slice(1);
  show(['queue', 'rooms', 'children', 'settings'].includes(v) ? v : 'queue');
  if (!started) {
    started = true;
    setInterval(() => {
      if (!$('#app').hidden && $('#view-queue').classList.contains('active') && !document.querySelector('dialog[open]')) loadQueue().catch(() => {});
    }, 60000);
  }
}

if (apiUrl() && store.get('scr_key')) start().catch((err) => showLogin(err.message));
else showLogin();
