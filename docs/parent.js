// ---------- หน้าผู้ปกครอง ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qno = (n) => String(n).padStart(3, '0');
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const STATUS_TH = { waiting: 'รอเรียก', serving: 'ถึงคิวแล้ว', done: 'รับบริการแล้ว', cancelled: 'ยกเลิก' };

function thDate(s, withDay = false) {
  if (!s) return '-';
  const [y, m, d] = s.split('-').map(Number);
  const day = withDay ? `วัน${TH_DAYS[new Date(y, m - 1, d).getDay()]}ที่ ` : '';
  return `${day}${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}
function ageText(birth) {
  const b = new Date(birth), n = new Date();
  let y = n.getFullYear() - b.getFullYear(), m = n.getMonth() - b.getMonth();
  if (n.getDate() < b.getDate()) m--;
  if (m < 0) { y--; m += 12; }
  return y > 0 ? `${y} ปี ${m} เดือน` : `${Math.max(m, 0)} เดือน`;
}

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${type}`; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// จำข้อมูลเข้าใช้ไว้ในเครื่องผู้ปกครอง (กด "ออก" เพื่อลบ)
const AUTH_KEY = 'scr_parent_auth';
const getAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; } };
const setAuth = (a) => { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {} };
const clearAuth = () => { try { localStorage.removeItem(AUTH_KEY); } catch {} };

let pending = 0;
async function api(path, opts = {}, auth = getAuth()) {
  const u = new URL(path, 'http://local');
  const payload = { method: opts.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body: opts.body, auth };
  document.body.classList.toggle('loading', ++pending > 0);
  try {
    const res = await fetch(window.APP_CONFIG.API_URL, { method: 'POST', body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({ status: 500, error: 'ติดต่อระบบไม่ได้' }));
    if (out.status === 401 || out.status === 429) { clearAuth(); showLogin(out.error); throw new Error(out.error); }
    if (out.status !== 200) throw new Error(out.error || 'เกิดข้อผิดพลาด');
    return out.data;
  } catch (err) {
    if (err instanceof TypeError) throw new Error('เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
    throw err;
  } finally {
    document.body.classList.toggle('loading', --pending > 0);
  }
}

window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if ($('#login').hidden) toast((e.reason && e.reason.message) || 'เกิดข้อผิดพลาด', 'error');
});

// ---------- เข้าใช้งาน ----------
function showLogin(msg = '') {
  $('#login').hidden = false;
  $('#app').hidden = true;
  $('#login-msg').textContent = msg;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const auth = { ident: $('#login-ident').value.trim(), phone: $('#login-phone').value.trim() };
  $('#login-msg').textContent = 'กำลังตรวจสอบ...';
  try {
    const data = await api('/parent/me', {}, auth);
    setAuth(auth);
    render(data);
  } catch (err) {
    $('#login-msg').textContent = err.message;
  }
});

$('#btn-logout').addEventListener('click', () => {
  clearAuth();
  $('#login-form').reset();
  showLogin('ออกจากระบบแล้ว');
});

// ---------- แสดงผล ----------
let STATE = null;

function show(view) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'book') loadSlots();
  window.scrollTo(0, 0);
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });

function render(data) {
  STATE = data;
  const c = data.child, cfg = data.config;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#p-name').textContent = `น้อง${c.nickname || c.first_name}`;
  $('#p-sub').textContent = `${c.first_name} ${c.last_name} · HN ${c.hn} · ${ageText(c.birth_date)}`;

  // คิวที่ยังไม่ถึง / วันนี้
  const upcoming = data.bookings.filter((b) => b.date >= cfg.today && (b.status === 'waiting' || b.status === 'serving'))
    .sort((a, b) => (a.date + a.slot < b.date + b.slot ? -1 : 1));
  $('#queue-list').innerHTML = upcoming.length ? upcoming.map((b) => {
    const isToday = b.date === cfg.today;
    let live = '';
    if (isToday && b.status === 'serving') {
      live = `<div class="q-live go">📢 ถึงคิวของน้องแล้ว เชิญที่ห้องตรวจได้เลย</div>`;
    } else if (isToday) {
      live = `<div class="q-live">ตอนนี้เรียกถึงคิว <b>${b.now_serving ? qno(b.now_serving) : '-'}</b>
        · ${b.ahead > 0 ? `อีก <b>${b.ahead}</b> คิวจะถึงน้อง` : '<b>คิวถัดไปคือน้อง</b> เตรียมตัวได้เลย'}</div>`;
    }
    return `<div class="card q-card ${b.status}">
      <div class="q-top">
        <div><div class="q-label">เลขคิว</div><div class="q-no">${qno(b.queue_no)}</div></div>
        <span class="badge ${b.status}">${isToday ? 'วันนี้ · ' : ''}${STATUS_TH[b.status]}</span>
      </div>
      <div class="q-when">${thDate(b.date, true)} · เวลา ${esc(b.slot)} น.</div>
      <div class="sub">${esc(b.service)}${b.note ? ` · ${esc(b.note)}` : ''}</div>
      ${live}
      ${b.status === 'waiting' ? `<button class="btn sm danger q-cancel" data-cancel="${b.id}">ยกเลิกคิวนี้</button>` : ''}
    </div>`;
  }).join('') : `<div class="card empty-card">
      <div style="font-size:2.5rem">🎫</div>
      <p>ยังไม่มีคิวที่จองไว้</p>
      <button class="btn primary" data-goto="book">จองคิวเลย</button>
    </div>`;

  // ข้อมูลเด็ก
  const bmi = c.weight && c.height ? (c.weight / (c.height / 100) ** 2).toFixed(1) : null;
  $('#child-info').innerHTML = `
    <h2>ข้อมูลสุขภาพของน้อง</h2>
    ${c.allergies ? `<div class="alert">⚠ ประวัติแพ้: ${esc(c.allergies)}</div>` : ''}
    <div class="info-grid">
      <div><span class="k">วันเกิด</span>${thDate(c.birth_date)}</div>
      <div><span class="k">อายุ</span>${ageText(c.birth_date)}</div>
      <div><span class="k">กรุ๊ปเลือด</span>${esc(c.blood_type || 'ไม่ทราบ')}</div>
      <div><span class="k">น้ำหนัก</span>${c.weight ?? '-'} กก.</div>
      <div><span class="k">ส่วนสูง</span>${c.height ?? '-'} ซม.</div>
      <div><span class="k">BMI</span>${bmi || '-'}</div>
      <div class="full"><span class="k">โรคประจำตัว</span>${esc(c.conditions || 'ไม่มี')}</div>
    </div>
    <p class="hint">ข้อมูลไม่ถูกต้อง? แจ้งเจ้าหน้าที่เพื่อแก้ไขได้ครับ/ค่ะ</p>`;

  // ประวัติ
  const past = data.bookings.filter((b) => !(b.date >= cfg.today && (b.status === 'waiting' || b.status === 'serving')));
  $('#history-list').innerHTML = past.length ? past.map((b) => `
    <div class="h-row">
      <div><b>${thDate(b.date)}</b> <span class="sub">${esc(b.slot)} น. · คิว ${qno(b.queue_no)}</span>
        <div class="sub">${esc(b.service)}${b.note ? ` · ${esc(b.note)}` : ''}</div></div>
      <span class="badge ${b.status}">${STATUS_TH[b.status]}</span>
    </div>`).join('') : '<p class="sub">ยังไม่มีประวัติการรับบริการ</p>';

  // ตั้งค่าฟอร์มจองคิว
  if (!$('#bk-service').options.length) {
    $('#bk-service').innerHTML = cfg.services.map((s) => `<option>${esc(s)}</option>`).join('');
    const max = new Date(Date.parse(cfg.today) + cfg.book_ahead_days * 864e5).toISOString().slice(0, 10);
    Object.assign($('#bk-date'), { min: cfg.today, max, value: cfg.today });
  }
}

async function refresh() { render(await api('/parent/me')); }
$('#btn-refresh').addEventListener('click', () => refresh().then(() => toast('อัปเดตแล้ว', 'ok')));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  if (!(await confirmBox('ต้องการยกเลิกคิวนี้ใช่ไหม?'))) return;
  await api(`/parent/bookings/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} });
  toast('ยกเลิกคิวแล้ว', 'ok');
  refresh();
});

function confirmBox(msg) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.style.width = 'min(380px, 92vw)';
    d.innerHTML = `<p style="font-size:1.05rem;margin:4px 0 20px">${esc(msg)}</p>
      <div class="actions"><button class="btn" value="no">ไม่</button><button class="btn primary" value="yes">ใช่</button></div>`;
    document.body.append(d);
    d.addEventListener('click', (e) => { if (e.target.value) { d.close(); resolve(e.target.value === 'yes'); d.remove(); } });
    d.addEventListener('cancel', () => { resolve(false); d.remove(); });
    d.showModal();
  });
}

// ---------- จองคิว ----------
let pickedSlot = null;
async function loadSlots() {
  const date = $('#bk-date').value;
  if (!date || !STATE) return;
  $('#bk-slots').innerHTML = '<span class="sub">กำลังโหลดเวลาว่าง...</span>';
  const slots = await api(`/parent/slots?date=${date}`);
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('#bk-slots').innerHTML = slots.map((s) => {
    const full = s.used >= s.capacity;
    const past = date === STATE.config.today && s.slot < nowHM;
    if ((full || past) && pickedSlot === s.slot) pickedSlot = null;
    return `<button type="button" class="slot ${pickedSlot === s.slot ? 'selected' : ''}" data-slot="${s.slot}" ${full || past ? 'disabled' : ''}>
      <b>${s.slot}</b><span>${past ? 'เลยเวลา' : full ? 'เต็ม' : `ว่าง ${s.capacity - s.used}`}</span></button>`;
  }).join('');
}
$('#bk-date').addEventListener('change', () => { pickedSlot = null; loadSlots(); });
$('#bk-slots').addEventListener('click', (e) => {
  const s = e.target.closest('[data-slot]');
  if (!s || s.disabled) return;
  pickedSlot = s.dataset.slot;
  $$('.slot').forEach((x) => x.classList.toggle('selected', x === s));
});

$('#book-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pickedSlot) return toast('กรุณาเลือกเวลา', 'error');
  try {
    const b = await api('/parent/bookings', {
      method: 'POST',
      body: { date: $('#bk-date').value, slot: pickedSlot, service: $('#bk-service').value, note: $('#bk-note').value },
    });
    toast(`จองสำเร็จ! คิวที่ ${qno(b.queue_no)} ${thDate(b.date)} เวลา ${b.slot} น.`, 'ok');
    $('#bk-note').value = ''; pickedSlot = null;
    await refresh();
    show('queue');
  } catch (err) {
    toast(err.message, 'error');
    loadSlots();
  }
});

// ---------- เริ่มต้น ----------
if (getAuth()) refresh().catch(() => {});
else showLogin();

// อัปเดตสถานะคิววันนี้อัตโนมัติทุก 30 วินาที เมื่ออยู่หน้า "คิวของฉัน"
setInterval(() => {
  if (!$('#app').hidden && $('#view-queue').classList.contains('active') && !document.hidden) refresh().catch(() => {});
}, 30000);
