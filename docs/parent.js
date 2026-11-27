// ---------- หน้าผู้ปกครอง: บัญชีเบอร์มือถือ + PIN, สมัครคิวเนอสเซอรี่ให้ลูก ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const STATUS_TH = { waiting: 'รอคิว', enrolled: 'เข้าเรียนแล้ว', cancelled: 'ยกเลิก', left: 'ออกแล้ว' };
const STATUS_BADGE = { waiting: 'waiting', enrolled: 'done', cancelled: 'cancelled', left: 'cancelled' };
const thDate = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`; };
const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

// อายุ ณ วันที่กำหนด (กติกาเดียวกับระบบหลังบ้าน)
function ageAt(birth, at) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = at.split('-').map(Number);
  let months = (ay - by) * 12 + (am - bm);
  if (ad < bd) months--;
  return { months, days: Math.round((Date.parse(at) - Date.parse(birth)) / 864e5) };
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

// จำการเข้าสู่ระบบไว้ในมือถือของผู้ปกครอง (กด "ออก" เพื่อลบ)
const AUTH_KEY = 'scr_parent_login';
const getAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; } };
const setAuth = (a) => { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {} };
const clearAuth = () => { try { localStorage.removeItem(AUTH_KEY); localStorage.removeItem('scr_parent_auth'); } catch {} };

let pending = 0;
async function api(path, opts = {}, auth = getAuth()) {
  const payload = { method: opts.method || 'GET', path, body: opts.body, auth };
  document.body.classList.toggle('loading', ++pending > 0);
  try {
    const res = await fetch(window.APP_CONFIG.API_URL, { method: 'POST', body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({ status: 500, error: 'ติดต่อระบบไม่ได้' }));
    if (out.status !== 200) throw Object.assign(new Error(out.error || 'เกิดข้อผิดพลาด'), { status: out.status });
    return out.data;
  } catch (err) {
    if (err instanceof TypeError) throw new Error('เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
    throw err;
  } finally {
    document.body.classList.toggle('loading', --pending > 0);
  }
}
// เรียกแบบต้องเข้าสู่ระบบ: ถ้า PIN ใช้ไม่ได้แล้ว พากลับหน้าเข้าสู่ระบบ
async function authed(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    if (err.status === 401 || err.status === 429) { clearAuth(); go('login'); $('#login-msg').textContent = err.message; }
    throw err;
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
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-screen]');
  if (b) go(b.dataset.screen);
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

let CONFIG = null;
const gName = (id) => (CONFIG.groups.find((g) => g.id === id) || {}).name || `กลุ่ม ${id}`;
async function loadConfig() {
  CONFIG = await api('/parent/config', {}, null);
  $('#group-table').innerHTML = CONFIG.groups.map((g) => `<div class="h-row"><b>${esc(g.name)}</b><span>${esc(g.label)}</span></div>`).join('');
  $('#ap-start').min = CONFIG.today;
  $('#ap-start').max = new Date(Date.parse(CONFIG.today) + CONFIG.start_ahead_days * 864e5).toISOString().slice(0, 10);
  $('#ap-birth').max = CONFIG.today;
}

// ---------- เข้าสู่ระบบ ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const auth = { phone: onlyDigits($('#login-phone').value), pin: $('#login-pin').value };
  $('#login-msg').textContent = 'กำลังตรวจสอบ...';
  try {
    const data = await api('/parent/me', {}, auth);
    setAuth(auth);
    $('#login-msg').textContent = '';
    $('#login-pin').value = '';
    render(data);
  } catch (err) {
    $('#login-msg').textContent = err.message;
  }
});
$('#btn-logout').addEventListener('click', () => { clearAuth(); $('#login-form').reset(); go('login'); });

// ---------- ลงทะเบียน ----------
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value, phone: onlyDigits(f.phone.value), pin: f.pin.value, verify: f.verify.value, consent: f.consent.checked };
  const msg = $('#register-msg');
  if (f.pin.value !== f.pin2.value) { msg.textContent = 'PIN ทั้งสองช่องไม่ตรงกัน'; return; }
  msg.textContent = 'กำลังลงทะเบียน...';
  try {
    const data = await api('/parent/register', { method: 'POST', body }, null);
    setAuth({ phone: body.phone, pin: body.pin });
    f.reset(); $('#verify-row').hidden = true; msg.textContent = '';
    render(data);
    toast('ลงทะเบียนเรียบร้อย ✅', 'ok');
  } catch (err) {
    msg.textContent = err.message;
    if (err.status === 428) { $('#verify-row').hidden = false; f.verify.required = true; f.verify.focus(); }
  }
});

// ---------- เพิ่มลูก ----------
function updateGroupPreview() {
  const birth = $('#ap-birth').value, start = $('#ap-start').value, box = $('#ap-group');
  if (!birth || !start || !CONFIG) { box.className = 'full group-preview'; return; }
  const g = groupFor(birth, start);
  if (g.error) { box.className = 'full group-preview bad'; box.textContent = g.error; return; }
  const info = CONFIG.groups.find((x) => x.id === g.id);
  box.className = 'full group-preview ok';
  box.innerHTML = `ณ วันเริ่มเรียน น้องจะอายุ <b>${ageText(birth, start)}</b><br>จะอยู่ <b>${esc(info.name)}</b> (${esc(info.label)})`;
}
$('#ap-birth').addEventListener('change', updateGroupPreview);
$('#ap-start').addEventListener('change', updateGroupPreview);

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  body.consent = e.target.consent.checked;
  const g = groupFor(body.birth_date, body.start_date);
  if (g.error) return toast(g.error, 'error');
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const data = await authed('/parent/children', { method: 'POST', body });
    e.target.reset(); updateGroupPreview();
    render(data, `✅ สมัครเข้าคิวให้น้อง${esc(body.nickname || body.first_name)}เรียบร้อย`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- หน้าหลัก ----------
function childCard(c) {
  const today = CONFIG.today;
  const active = c.applications.find((a) => a.status === 'waiting' || a.status === 'enrolled');
  const head = `<div class="kid-head"><div><b>น้อง${esc(c.nickname || c.first_name)}</b>
      <div class="sub">${esc(c.first_name)} ${esc(c.last_name)} · HN ${esc(c.hn)} · อายุ ${ageText(c.birth_date, today)}</div></div></div>
    ${c.allergies ? `<div class="allergy" style="margin-top:6px">⚠ แพ้: ${esc(c.allergies)}</div>` : ''}`;
  let body;
  if (active && active.status === 'waiting') {
    body = `<div class="q-top" style="margin-top:12px">
        <div><div class="q-label">เลขคิว</div><div class="q-no">${esc(active.queue_label)}</div></div>
        <span class="badge waiting">รอคิว · ${esc(gName(active.group))}</span></div>
      <div class="q-live">ลำดับที่ <b>${active.position}</b> ของ${esc(gName(active.group))}
        ${active.position > 1 ? `· รออีก <b>${active.position - 1}</b> คน` : '· <b>คิวถัดไปคือน้อง</b>'}</div>
      <div class="sub" style="margin-top:8px">ต้องการเริ่มเรียน ${thDate(active.start_date)} · สมัครเมื่อ ${thDate(active.created_at)}</div>
      <button class="btn sm danger q-cancel" data-cancel="${active.id}">ยกเลิกคิว</button>`;
  } else if (active) {
    body = `<div class="q-top" style="margin-top:12px">
        <div><div class="q-label">ห้องเรียน</div><div class="q-no" style="color:var(--green)">${esc(active.room)}</div></div>
        <span class="badge done">เข้าเรียนแล้ว</span></div>
      <div class="q-live go">🎉 น้องได้เข้าเรียนห้อง ${esc(active.room)} แล้ว</div>`;
  } else {
    body = `<form class="reapply" data-child="${c.id}">
        <p class="sub">ตอนนี้น้องยังไม่มีคิว เลือกวันเริ่มเรียนเพื่อต่อคิวใหม่</p>
        <input type="date" name="start_date" min="${today}" required>
        <div class="group-preview" data-preview></div>
        <button class="btn primary full-w" type="submit">ต่อคิวใหม่</button>
      </form>`;
  }
  const past = c.applications.filter((a) => a !== active);
  const hist = past.length ? `<details class="kid-hist"><summary>ประวัติคิว (${past.length})</summary>${past.map((a) => `
      <div class="h-row"><div><b>${esc(a.queue_label)}</b> <span class="sub">${esc(gName(a.group))}${a.room ? ` · ห้อง ${esc(a.room)}` : ''} · สมัคร ${thDate(a.created_at)}</span></div>
      <span class="badge ${STATUS_BADGE[a.status]}">${STATUS_TH[a.status]}</span></div>`).join('')}</details>` : '';
  return `<div class="card q-card ${active ? (active.status === 'enrolled' ? 'serving' : '') : 'none'}">${head}${body}${hist}</div>`;
}

let STATE = null;
function render(data, notice = '') {
  STATE = data;
  CONFIG = data.config;
  go('home');
  $('#p-name').textContent = `สวัสดี คุณ${data.parent.name}`;
  $('#p-sub').textContent = `เบอร์ ${data.parent.phone} · ลูก ${data.children.length} คน`;
  $('#notice').innerHTML = notice ? `<div class="card success-card">${notice}</div>` : '';
  $('#children-list').innerHTML = data.children.length ? data.children.map(childCard).join('')
    : `<div class="card empty-card"><div style="font-size:2.5rem">👶</div><p>ยังไม่มีข้อมูลลูก<br>กดปุ่มด้านล่างเพื่อเพิ่มลูกและสมัครเข้าคิว</p></div>`;
}

$('#children-list').addEventListener('change', (e) => {
  const form = e.target.closest('.reapply');
  if (!form || e.target.name !== 'start_date') return;
  const c = STATE.children.find((x) => x.id === Number(form.dataset.child));
  const g = groupFor(c.birth_date, e.target.value), box = form.querySelector('[data-preview]');
  box.className = `group-preview ${g.error ? 'bad' : 'ok'}`;
  box.innerHTML = g.error ? esc(g.error) : `จะอยู่ <b>${esc(gName(g.id))}</b> · อายุ ณ วันเริ่ม ${ageText(c.birth_date, e.target.value)}`;
});
$('#children-list').addEventListener('submit', async (e) => {
  const form = e.target.closest('.reapply');
  if (!form) return;
  e.preventDefault();
  render(await authed(`/parent/children/${form.dataset.child}/applications`, { method: 'POST', body: { start_date: form.start_date.value } }), '✅ ต่อคิวเรียบร้อย');
});

async function refresh() { render(await authed('/parent/me')); }
$('#btn-refresh').addEventListener('click', () => refresh().then(() => toast('อัปเดตแล้ว', 'ok')));

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  if (!(await confirmBox('ต้องการยกเลิกคิวนี้ใช่ไหม? ถ้าสมัครใหม่จะได้คิวต่อท้าย'))) return;
  render(await authed(`/parent/applications/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }), 'ยกเลิกคิวแล้ว');
});

// เปลี่ยน PIN
$('#btn-pin').addEventListener('click', () => { $('#pin-form').reset(); $('#pin-dialog').showModal(); });
$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('#new-pin').value, p2 = $('#new-pin2').value;
  if (p1 !== p2) return toast('PIN ทั้งสองช่องไม่ตรงกัน', 'error');
  await authed('/parent/pin', { method: 'POST', body: { new_pin: p1 } });
  setAuth(Object.assign(getAuth(), { pin: p1 }));
  $('#pin-dialog').close();
  toast('เปลี่ยน PIN แล้ว', 'ok');
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
  go('login');
  await loadConfig();
  if (getAuth()) refresh().catch(() => {});
})();
