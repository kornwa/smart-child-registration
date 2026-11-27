// ---------- หน้าผู้ปกครอง: สมัครเข้าคิว / เช็กคิวเนอสเซอรี่ ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const STATUS_TH = { waiting: 'รอคิว', enrolled: 'เข้าเรียนแล้ว', cancelled: 'ยกเลิก', left: 'ออกแล้ว' };
const STATUS_BADGE = { waiting: 'waiting', enrolled: 'done', cancelled: 'cancelled', left: 'cancelled' };

const thDate = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`; };

// อายุ ณ วันที่กำหนด (ใช้กติกาเดียวกับระบบหลังบ้าน)
function ageAt(birth, at) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = at.split('-').map(Number);
  let months = (ay - by) * 12 + (am - bm);
  if (ad < bd) months--;
  const days = Math.round((Date.parse(at) - Date.parse(birth)) / 864e5);
  return { months, days };
}
function ageText(birth, at) {
  const a = ageAt(birth, at);
  if (a.months < 1) return `${Math.floor(a.days / 7)} สัปดาห์`;
  const y = Math.floor(a.months / 12), m = a.months % 12;
  return y ? `${y} ปี${m ? ` ${m} เดือน` : ''}` : `${m} เดือน`;
}
function groupFor(birth, start) {
  const a = ageAt(birth, start);
  if (a.days < 42) return { error: 'ณ วันเริ่มเรียน น้องจะอายุยังไม่ถึง 6 สัปดาห์ กรุณาเลือกวันเริ่มเรียนให้ช้าลง' };
  if (a.months < 12) return { id: 1 };
  if (a.months < 24) return { id: 2 };
  if (a.months < 36) return { id: 3 };
  return { error: 'ณ วันเริ่มเรียน น้องจะอายุครบ 3 ขวบแล้ว ซึ่งเกินช่วงอายุที่รับ' };
}

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${type}`; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
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
    if ((out.status === 401 || out.status === 429) && auth) { clearAuth(); }
    if (out.status !== 200) throw Object.assign(new Error(out.error || 'เกิดข้อผิดพลาด'), { status: out.status });
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
  toast((e.reason && e.reason.message) || 'เกิดข้อผิดพลาด', 'error');
});

// ---------- สลับหน้าจอ ----------
function go(name) {
  $$('.screen').forEach((s) => (s.hidden = s.id !== `screen-${name}`));
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-screen]'); if (b) go(b.dataset.screen); });

let CONFIG = null;
async function loadConfig() {
  CONFIG = await api('/parent/config', {}, null);
  $('#group-table').innerHTML = CONFIG.groups.map((g) =>
    `<div class="h-row"><b>${esc(g.name)}</b><span>${esc(g.label)}</span></div>`).join('');
  const start = $('#ap-start');
  start.min = CONFIG.today;
  start.max = new Date(Date.parse(CONFIG.today) + CONFIG.start_ahead_days * 864e5).toISOString().slice(0, 10);
  $('#ap-birth').max = CONFIG.today;
}

// ---------- สมัคร ----------
function updateGroupPreview() {
  const birth = $('#ap-birth').value, start = $('#ap-start').value, box = $('#ap-group');
  if (!birth || !start || !CONFIG) { box.className = 'full group-preview'; return; }
  const g = groupFor(birth, start);
  if (g.error) {
    box.className = 'full group-preview bad';
    box.textContent = g.error;
  } else {
    const info = CONFIG.groups.find((x) => x.id === g.id);
    box.className = 'full group-preview ok';
    box.innerHTML = `ณ วันเริ่มเรียน น้องจะอายุ <b>${ageText(birth, start)}</b><br>จะอยู่ <b>${esc(info.name)}</b> (${esc(info.label)})`;
  }
}
$('#ap-birth').addEventListener('change', updateGroupPreview);
$('#ap-start').addEventListener('change', updateGroupPreview);

$('#apply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.consent = $('#ap-consent').checked;
  const g = groupFor(body.birth_date, body.start_date);
  if (g.error) return toast(g.error, 'error');
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const data = await api('/parent/apply', { method: 'POST', body }, null);
    setAuth({ ident: body.citizen_id, phone: body.parent_phone });
    e.target.reset();
    render(data, true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- เช็กคิว ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const auth = { ident: $('#login-ident').value.trim(), phone: $('#login-phone').value.trim() };
  $('#login-msg').textContent = 'กำลังตรวจสอบ...';
  try {
    const data = await api('/parent/me', {}, auth);
    setAuth(auth);
    $('#login-msg').textContent = '';
    render(data);
  } catch (err) {
    $('#login-msg').textContent = err.message;
  }
});

$('#btn-logout').addEventListener('click', () => { clearAuth(); $('#login-form').reset(); go('start'); });

async function refresh() {
  try {
    render(await api('/parent/me'));
  } catch (err) {
    if (err.status === 401 || err.status === 429) { go('login'); $('#login-msg').textContent = err.message; return; }
    throw err;
  }
}
$('#btn-refresh').addEventListener('click', () => refresh().then(() => toast('อัปเดตแล้ว', 'ok')));

// ---------- แสดงสถานะ ----------
let STATE = null;
function render(data, justApplied = false) {
  STATE = data;
  const c = data.child, cfg = data.config;
  const gName = (id) => (cfg.groups.find((g) => g.id === id) || {}).name || `กลุ่ม ${id}`;
  go('status');
  $('#p-name').textContent = `น้อง${c.nickname || c.first_name}`;
  $('#p-sub').textContent = `${c.first_name} ${c.last_name} · HN ${c.hn} · อายุ ${ageText(c.birth_date, cfg.today)}`;

  const active = data.applications.find((a) => a.status === 'waiting' || a.status === 'enrolled');
  let html = '';
  if (justApplied) {
    html += `<div class="card success-card">✅ สมัครเรียบร้อย! จดเลขคิวและ <b>HN ${esc(c.hn)}</b> ไว้ได้
      <div class="sub">เช็กคิวครั้งต่อไป ใช้เลขบัตรประชาชนลูก (หรือ HN) กับเบอร์โทรที่ใช้สมัคร</div></div>`;
  }
  if (active && active.status === 'waiting') {
    html += `<div class="card q-card">
      <div class="q-top">
        <div><div class="q-label">เลขคิว</div><div class="q-no">${esc(active.queue_label)}</div></div>
        <span class="badge waiting">รอคิว · ${esc(gName(active.group))}</span>
      </div>
      <div class="q-live">ตอนนี้น้องอยู่<b>ลำดับที่ ${active.position}</b> ของ${esc(gName(active.group))}
        ${active.position > 1 ? `· รออีก <b>${active.position - 1}</b> คน` : '· <b>คิวถัดไปคือน้อง</b>'}</div>
      <div class="sub" style="margin-top:10px">ต้องการเริ่มเรียน ${thDate(active.start_date)} · สมัครเมื่อ ${thDate(active.created_at)}</div>
      <div class="sub">เมื่อมีที่ว่าง เจ้าหน้าที่จะติดต่อกลับทางเบอร์โทรที่ให้ไว้</div>
      <button class="btn sm danger q-cancel" data-cancel="${active.id}">ยกเลิกคิว</button>
    </div>`;
  } else if (active) {
    html += `<div class="card q-card serving">
      <div class="q-top">
        <div><div class="q-label">ห้องเรียน</div><div class="q-no">${esc(active.room)}</div></div>
        <span class="badge done">เข้าเรียนแล้ว</span>
      </div>
      <div class="q-live go">🎉 น้องได้เข้าเรียนห้อง ${esc(active.room)} แล้ว</div>
      <div class="sub" style="margin-top:10px">เลขคิวเดิม ${esc(active.queue_label)} · รับเข้าเมื่อ ${thDate(active.enrolled_at)}</div>
    </div>`;
  } else {
    html += `<form class="card form" id="reapply-form">
      <h2>สมัครเข้าคิวอีกครั้ง</h2>
      <p class="sub full">ตอนนี้น้องยังไม่มีคิว เลือกวันที่ต้องการให้เริ่มเรียนเพื่อต่อคิวใหม่</p>
      <label class="full">วันที่ต้องการให้เริ่มเรียน<input type="date" id="re-start" required min="${cfg.today}"></label>
      <div class="full group-preview" id="re-group"></div>
      <button class="btn primary full" type="submit">ต่อคิวใหม่</button>
    </form>`;
  }
  $('#status-card').innerHTML = html;

  const re = $('#reapply-form');
  if (re) {
    $('#re-start').addEventListener('change', (e) => {
      const g = groupFor(c.birth_date, e.target.value), box = $('#re-group');
      box.className = `full group-preview ${g.error ? 'bad' : 'ok'}`;
      box.innerHTML = g.error ? esc(g.error) : `จะอยู่ <b>${esc(gName(g.id))}</b> · อายุ ณ วันเริ่ม ${ageText(c.birth_date, e.target.value)}`;
    });
    re.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = await api('/parent/applications', { method: 'POST', body: { start_date: $('#re-start').value } });
      toast('ต่อคิวเรียบร้อย', 'ok');
      render(d);
    });
  }

  $('#child-info').innerHTML = `
    <h2>ข้อมูลของน้อง</h2>
    ${c.allergies ? `<div class="alert">⚠ ประวัติแพ้: ${esc(c.allergies)}</div>` : ''}
    <div class="info-grid">
      <div><span class="k">วันเกิด</span>${thDate(c.birth_date)}</div>
      <div><span class="k">อายุวันนี้</span>${ageText(c.birth_date, cfg.today)}</div>
      <div><span class="k">เพศ</span>${esc(c.gender || '-')}</div>
      <div><span class="k">ผู้ปกครอง</span>${esc(c.parent_name)}</div>
      <div class="full"><span class="k">โรคประจำตัว</span>${esc(c.conditions || 'ไม่มี')}</div>
    </div>
    <p class="hint">ข้อมูลไม่ถูกต้อง? แจ้งเจ้าหน้าที่เพื่อแก้ไขได้</p>`;

  $('#history-list').innerHTML = data.applications.length ? data.applications.map((a) => `
    <div class="h-row">
      <div><b>คิว ${esc(a.queue_label)}</b> <span class="sub">${esc(gName(a.group))}${a.room ? ` · ห้อง ${esc(a.room)}` : ''}</span>
        <div class="sub">สมัคร ${thDate(a.created_at)} · เริ่มเรียน ${thDate(a.start_date)}</div></div>
      <span class="badge ${STATUS_BADGE[a.status]}">${STATUS_TH[a.status]}</span>
    </div>`).join('') : '<p class="sub">ยังไม่มีประวัติ</p>';
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  if (!(await confirmBox('ต้องการยกเลิกคิวนี้ใช่ไหม? ถ้าสมัครใหม่จะได้คิวต่อท้าย'))) return;
  render(await api(`/parent/applications/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }));
  toast('ยกเลิกคิวแล้ว', 'ok');
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

// ---------- เริ่มต้น ----------
(async () => {
  go('start');
  await loadConfig();
  if (getAuth()) refresh().catch(() => go('start'));
})();
