/* Arcko Academy Studio · data layer (Supabase)
   Loaded after app.js. app.js keeps the screens; this file handles login, roles,
   loading data, saving changes and CSV export. Security is NOT enforced here: the
   database refuses anything a role is not allowed to do (see supabase/schema.sql).
   The checks below only decide which buttons and pages to show. */

const CFG = window.ARCKO_CONFIG || {};
const PAY_RATE = 600;                       // THB per lesson, used on the Teacher payroll page
let sb = null, me = null, activeBranch = null, branches = [], loaded = false;
let snap = null, pending = 0, syncChain = Promise.resolve(), syncFailed = false;

/* ---------- small helpers used by app.js ---------- */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
const datePlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) };
const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const firstName = () => (me?.name || '').split(' ')[0] || 'there';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const teacherOptions = () => [{ id: '', name: 'Unassigned' }, ...db.teachers.map(t => ({ id: t.id, name: t.name }))];
const teacherName = id => id ? (db.teachers.find(t => t.id === id)?.name || 'Teacher') : 'Unassigned';
const branchName = () => db.branchInfo?.name || '';
const branchForWrite = () => me.role === 'owner' ? activeBranch : me.branch_id;

/* ---------- roles: which pages each role can open ---------- */
const FINANCE_PAGES = ['Invoices & payments', 'Recurring invoices', 'Teacher payroll'];
const ADMIN_BLOCKED = [...FINANCE_PAGES, 'Personnel', 'Settings'];
function allowed(p) {
  if (!me) return false;
  if (me.role === 'owner' || me.role === 'manager') return true;
  if (me.role === 'admin') return !ADMIN_BLOCKED.includes(p);
  return false;                              // teachers only use the classroom view
}
function visibleNav() {
  return navGroups.map(([g, items]) => [g, items.filter(([n]) => allowed(n))]).filter(([, items]) => items.length);
}
function branchSwitcher() {
  if (me.role !== 'owner' || branches.length < 2) return 'Academy management';
  return `<select aria-label="Switch branch" onchange="switchBranch(this.value)">${branches.map(b => `<option value="${b.id}" ${b.id == activeBranch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`;
}
async function switchBranch(id) {
  activeBranch = +id;
  localStorage.setItem('arcko-branch', String(id));
  try { await loadAll() } catch (e) { toast('Could not load that branch'); return }
  page = 'Dashboard'; render();
}
function updateChip() {
  const w = $('#whoami'); if (w && me) w.textContent = cap(me.role) + (me.role === 'owner' ? '' : ' · ' + branchName());
  const a = $('#me-avatar'); if (a && me) a.textContent = (me.name || '?')[0].toUpperCase();
  document.body.classList.toggle('teacher', me?.role === 'teacher');
}

/* ---------- login ---------- */
function loginCard(inner) {
  const el = $('#login'); el.hidden = false;
  el.innerHTML = `<div class="box">${brandMark('word')}<p class="sub" style="text-align:center;margin:0 0 22px">Academy Studio</p>${inner}</div>`;
}
function showLogin(msg = '') {
  loginCard(`<form id="loginform"><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field" style="margin-top:14px">Password<input name="password" type="password" autocomplete="current-password" required></label><p class="login-error" role="alert">${esc(msg)}</p><button class="primary" type="submit" style="width:100%">Sign in</button></form><p class="sub" style="text-align:center;margin:16px 0 0">Forgot your password? Ask the academy owner to reset it.</p>`);
  $('#loginform').onsubmit = doLogin;
}
function showBlocked(msg, withSignOut = true) {
  loginCard(`<p style="line-height:1.6">${esc(msg)}</p>${withSignOut ? '<button onclick="signOut()" style="width:100%;margin-top:14px">Sign out</button>' : ''}`);
}
async function doLogin(e) {
  e.preventDefault();
  const f = new FormData(e.target), b = e.target.querySelector('button');
  b.disabled = true; b.textContent = 'Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) });
  if (error) { showLogin('Incorrect email or password.'); return }
  await startApp(data.user);
}
async function signOut() { try { await sb.auth.signOut() } catch { } location.reload() }
function openAccount() {
  if (!me) return;
  $('#modal').innerHTML = `<button class="close" onclick="closeModal()" aria-label="Close">×</button><h2>${esc(me.name)}</h2><p class="sub">${esc(cap(me.role))}${me.role === 'owner' ? '' : ' · ' + esc(branchName())}</p><div class="formfoot"><button onclick="closeModal()">Close</button><button class="danger" onclick="signOut()">Sign out</button></div>`;
  $('#modal').showModal();
}

/* ---------- start-up ---------- */
async function startApp(user) {
  $('#login').hidden = true;
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error || !p) { showBlocked(error ? 'Could not load your account: ' + error.message : 'Your account has no role yet. Ask the academy owner to finish setting it up.'); return }
  me = { id: p.id, name: p.full_name, role: p.role, branch_id: p.branch_id };
  role = me.role === 'teacher' ? 'Teacher view' : 'Admin view';
  const { data: bs, error: be } = await sb.from('branches').select('*').order('id');
  if (be || !bs?.length) { showBlocked('No branch is available for your account yet. Ask the academy owner.'); return }
  branches = bs;
  const saved = +localStorage.getItem('arcko-branch');
  activeBranch = me.role === 'owner' ? (bs.some(b => b.id === saved) ? saved : bs[0].id) : me.branch_id;
  page = 'Dashboard'; portalTab = 'Home';
  try { await loadAll() } catch (e) { showBlocked('Could not load data: ' + (e.message || e)); return }
  render();
}
async function boot() {
  if (!window.supabase) { showBlocked('The Supabase library could not be loaded. Check your internet connection and reload.', false); return }
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || /YOUR/i.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY)) {
    showBlocked('Supabase is not connected yet. Open config.js and paste your project URL and anon key.', false); return
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && loaded) location.reload() });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showLogin(); return }
  await startApp(session.user);
}

/* ---------- loading ---------- */
const ORDER = ['students', 'student_contacts', 'leads', 'lessons', 'lesson_students', 'attendance', 'invoices', 'progress', 'requests', 'announcements', 'extras'];
const ORD = { students: ['id'], student_contacts: ['student_id'], leads: ['id'], lessons: ['id'], lesson_students: ['lesson_id', 'student_id'], attendance: ['lesson_id', 'student_id'], invoices: ['id'], progress: ['id'], requests: ['id'], announcements: ['id'], extras: ['id'], profiles: ['created_at', 'id'] };
const PK = { branches: ['id'], students: ['id'], student_contacts: ['student_id'], leads: ['id'], lessons: ['id'], lesson_students: ['lesson_id', 'student_id'], attendance: ['lesson_id', 'student_id'], invoices: ['id'], progress: ['id'], requests: ['id'], announcements: ['id'], extras: ['id'] };
// Tables each role can read at all (skips pointless requests; the database enforces the real rule).
const READ = {
  admin: ['students', 'student_contacts', 'leads', 'lessons', 'lesson_students', 'attendance', 'progress', 'requests', 'announcements', 'extras'],
  teacher: ['students', 'lessons', 'lesson_students', 'attendance', 'progress', 'announcements']
};

async function fetchAll(t, filter) {             // Supabase returns at most 1000 rows per request
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(t).select('*');
    if (filter) q = filter(q);
    ORD[t].forEach(c => { q = q.order(c) });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function loadAll() {
  const tables = READ[me.role] || ORDER;
  const ownerOnly = me.role === 'owner' ? (q => q.eq('branch_id', activeBranch)) : null;
  const get = t => tables.includes(t) ? fetchAll(t, ownerOnly) : Promise.resolve([]);
  const [stu, con, lea, les, ls, att, inv, pro, req, ann, ext] = await Promise.all(ORDER.map(get));
  const prof = await fetchAll('profiles', ownerOnly);
  const { data: bs, error: be } = await sb.from('branches').select('*').order('id');
  if (be) throw be;
  branches = bs;

  const d = { students: [], leads: [], lessons: [], invoices: [], progress: [], requests: [], announcements: [], attendance: {}, extras: {}, branchInfo: null, teachers: [], staff: [] };
  d.branchInfo = bs.find(b => b.id == activeBranch) || null;
  d.teachers = prof.filter(p => p.role === 'teacher').map(p => ({ id: p.id, name: p.full_name }));
  const staff = new Map();
  if (me.role === 'owner') staff.set(me.id, { id: me.id, name: me.name, role: 'owner' });
  prof.filter(p => p.role !== 'teacher').forEach(p => staff.set(p.id, { id: p.id, name: p.full_name, role: p.role }));
  d.staff = [...staff.values()];

  const contacts = new Map(con.map(c => [c.student_id, c]));
  d.students = stu.map(s => { const c = contacts.get(s.id) || {}; return { id: s.id, name: s.name, age: s.age ?? '', dob: s.dob || '', school: s.school || '', subject: s.subject, level: s.level, total: s.total, sessions: s.total - s.sessions_used, coins: s.coins, status: s.status, note: s.note || '', parent: c.parent || '', phone: c.phone || '', email: c.email || '' } });
  d.leads = lea.map(l => ({ id: l.id, name: l.name, child: l.child || '', age: l.age ?? '', subject: l.subject || '', phone: l.phone || '', status: l.status }));
  const roster = {}; ls.forEach(r => (roster[r.lesson_id] ??= []).push(r.student_id));
  d.lessons = les.map(l => ({ id: l.id, subject: l.subject, title: l.title, date: l.date, time: l.time, teacher_id: l.teacher_id, teacher: l.teacher_id ? (d.teachers.find(t => t.id === l.teacher_id)?.name || 'Teacher') : 'Unassigned', room: l.room || '', ids: roster[l.id] || [] }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  att.forEach(a => { d.attendance[a.lesson_id + '-' + a.student_id] = a.status });
  d.invoices = inv.map(i => ({ id: i.id, student: i.student_id, subject: i.subject, amount: Number(i.amount), status: i.status, date: i.date, due: i.due, method: i.method || '' }));
  d.progress = pro.map(p => ({ id: p.id, student: p.student_id, subject: p.subject || '', date: p.date, title: p.title, text: p.body, author: p.author || '' }))
    .sort((a, b) => (b.date + String(b.id).padStart(16, '0')).localeCompare(a.date + String(a.id).padStart(16, '0')));
  d.requests = req.map(r => ({ id: r.id, student: r.student_id, date: r.date, time: r.time, reason: r.reason || '', status: r.status }));
  d.announcements = ann.map(a => ({ id: a.id, title: a.title, text: a.body || '', date: a.date })).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  ext.forEach(x => (d.extras[x.type] ??= []).push({ id: x.id, name: x.name, details: x.details || '' }));

  db = d; snap = rowsOf(db); loaded = true;
}

/* ---------- saving ----------
   app.js changes `db` directly and calls save(). We compare `db` with the last copy
   we saved, then send only the differences to Supabase, in order. If anything is
   refused, the screen reloads from the database so it never shows unsaved data. */
const num = v => v === '' || v == null ? null : Number(v);
function rowsOf(d) {
  const R = { branches: {} }; ORDER.forEach(t => R[t] = {});
  if (d.branchInfo) R.branches[d.branchInfo.id] = { id: d.branchInfo.id, name: d.branchInfo.name, email: d.branchInfo.email || null };
  d.students.forEach(s => {
    R.students[s.id] = { id: s.id, name: s.name, age: num(s.age), dob: s.dob || null, school: s.school || null, subject: s.subject, level: s.level, total: +s.total || 0, coins: +s.coins || 0, status: s.status, note: s.note || null };
    R.student_contacts[s.id] = { student_id: s.id, parent: s.parent || null, phone: s.phone || null, email: s.email || null };
  });
  d.leads.forEach(l => R.leads[l.id] = { id: l.id, name: l.name, child: l.child || null, age: num(l.age), subject: l.subject || null, phone: l.phone || null, status: l.status });
  d.lessons.forEach(l => {
    R.lessons[l.id] = { id: l.id, subject: l.subject, title: l.title, date: l.date, time: l.time, teacher_id: l.teacher_id || null, room: l.room || null };
    (l.ids || []).forEach(sid => R.lesson_students[l.id + '-' + sid] = { lesson_id: l.id, student_id: sid });
  });
  Object.entries(d.attendance).forEach(([k, st]) => {
    if (!['Present', 'Absent', 'Excused'].includes(st) || !R.lesson_students[k]) return;   // "Not marked" = no row
    const [lid, sid] = k.split('-'); R.attendance[k] = { lesson_id: +lid, student_id: +sid, status: st };
  });
  d.invoices.forEach(i => R.invoices[i.id] = { id: i.id, student_id: i.student, subject: i.subject, amount: +i.amount, status: i.status, date: i.date, due: i.due, method: i.method || null });
  d.progress.forEach(p => R.progress[p.id] = { id: p.id, student_id: p.student, subject: p.subject || null, date: p.date, title: p.title, body: p.text, author: p.author || null });
  d.requests.forEach(r => R.requests[r.id] = { id: r.id, student_id: r.student, date: r.date, time: r.time, reason: r.reason || null, status: r.status });
  d.announcements.forEach(a => R.announcements[a.id] = { id: a.id, title: a.title, body: a.text || null, date: a.date });
  Object.entries(d.extras).forEach(([type, arr]) => arr.forEach(x => R.extras[x.id] = { id: x.id, type, name: x.name, details: x.details || null }));
  return R;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diffRows(prev, cur) {
  const ops = [];
  for (const t of ['branches', ...ORDER]) {
    const p = prev[t] || {}, c = cur[t] || {};
    for (const k in c) {
      if (!(k in p)) { if (t !== 'branches') ops.push({ t, op: 'insert', row: c[k] }); continue }
      const patch = {};
      for (const f in c[k]) if (!same(c[k][f], p[k][f])) patch[f] = c[k][f];
      if (Object.keys(patch).length) ops.push({ t, op: 'update', row: c[k], patch });
    }
    if (t !== 'branches') for (const k in p) if (!(k in c)) ops.push({ t, op: 'delete', row: p[k] });
  }
  return ops;
}

async function applyOps(ops) {
  const bid = branchForWrite();
  for (const t of ORDER) {                                     // 1. inserts, parents before children
    const rows = ops.filter(o => o.t === t && o.op === 'insert').map(o => {
      const r = { ...o.row, branch_id: bid };
      if (t === 'invoices') delete r.id;                       // invoice numbers come from the database
      return r;
    });
    if (rows.length) { const { error } = await sb.from(t).insert(rows); if (error) throw error }
  }
  for (const o of ops.filter(o => o.op === 'update')) {        // 2. updates (changed fields only)
    if (o.t === 'student_contacts') {
      const { error } = await sb.from(o.t).upsert({ ...o.row, branch_id: bid }, { onConflict: 'student_id' });
      if (error) throw error; continue;
    }
    let q = sb.from(o.t).update(o.patch);
    PK[o.t].forEach(k => { q = q.eq(k, o.row[k]) });
    const { data, error } = await q.select(PK[o.t][0]);
    if (error) throw error;
    if (!data.length) throw new Error('NOT_PERMITTED');        // blocked rows update silently, so check
  }
  for (const t of [...ORDER].reverse()) {                      // 3. deletes, children before parents
    for (const o of ops.filter(o => o.t === t && o.op === 'delete')) {
      let q = sb.from(t).delete();
      PK[t].forEach(k => { q = q.eq(k, o.row[k]) });
      const { data, error } = await q.select(PK[t][0]);
      if (error) throw error;
      if (!data.length) throw new Error('NOT_PERMITTED');
    }
  }
}

function friendly(e) {
  const m = String(e && e.message || e);
  if (m.includes('No sessions remaining')) return 'No sessions remaining. Add a package first.';
  if (m === 'NOT_PERMITTED' || /row-level security|permission denied/i.test(m)) return 'You do not have permission to make that change.';
  if (/foreign key/i.test(m)) return 'That change conflicts with other records.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Your change was not saved.';
  return 'Could not save: ' + m;
}

async function runJob() {
  try { if (!syncFailed) { const cur = rowsOf(db); await applyOps(diffRows(snap, cur)); snap = cur } }
  catch (e) { syncFailed = true; console.error(e); toast(friendly(e)) }
  pending--;
  if (pending === 0) {
    syncFailed = false;
    try { await loadAll() } catch (e) { console.error(e); toast('Could not refresh data'); return }
    render();
  }
}
function queueSync() { if (!loaded) return; pending++; syncChain = syncChain.then(runJob) }

// Pick up other people's changes when the tab comes back into view.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !loaded || pending || $('#modal').open) return;
  loadAll().then(render).catch(() => { });
});

/* ---------- CSV export (built from what this user is allowed to see) ---------- */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Stop spreadsheet formula injection, but keep phone numbers and amounts intact.
  const numeric = /^[+\-]?[\d\s().\-]+$/.test(s);
  if (/^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && !numeric)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));   // BOM keeps Thai text intact in Excel
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const EXPORTS = {
  students: { label: 'Students', info: 'Name, age, school, programme, sessions, coins, status, parent contact, notes', rows: () => [['Name', 'Age', 'Date of birth', 'School', 'Programme', 'Level', 'Sessions purchased', 'Sessions remaining', 'Arcko coins', 'Status', 'Parent / client', 'Phone', 'Email', 'Notes'], ...db.students.map(s => [s.name, s.age, s.dob, s.school, s.subject, s.level, s.total, s.sessions, s.coins, s.status, s.parent, s.phone, s.email, s.note])] },
  leads: { label: 'Leads', info: 'Parent, child, interest, phone, status', rows: () => [['Parent', 'Child', 'Child age', 'Interested programme', 'Phone', 'Status'], ...db.leads.map(l => [l.name, l.child, l.age, l.subject, l.phone, l.status])] },
  lessons: { label: 'Lessons', info: 'Date, time, programme, teacher, venue, students', rows: () => [['Date', 'Time', 'Programme', 'Title', 'Teacher', 'Venue', 'Students'], ...db.lessons.map(l => [l.date, l.time, l.subject, l.title, l.teacher, l.room, l.ids.map(i => student(i).name).join('; ')])] },
  attendance: { label: 'Attendance', info: 'One row per student per lesson, with status', rows: () => [['Date', 'Time', 'Programme', 'Lesson', 'Teacher', 'Student', 'Status'], ...db.lessons.flatMap(l => l.ids.map(i => [l.date, l.time, l.subject, l.title, l.teacher, student(i).name, db.attendance[l.id + '-' + i] || 'Not marked']))] },
  progress: { label: 'Progress notes', info: 'Date, student, programme, title, note, teacher', rows: () => [['Date', 'Student', 'Programme', 'Title', 'Note', 'Teacher'], ...db.progress.map(p => [p.date, student(p.student).name, p.subject, p.title, p.text, p.author])] },
  requests: { label: 'Make-up requests', info: 'Student, requested time, reason, status', rows: () => [['Student', 'Requested date', 'Requested time', 'Reason', 'Status'], ...db.requests.map(r => [student(r.student).name, r.date, r.time, r.reason, r.status])] },
  announcements: { label: 'Announcements', info: 'Date, title, message', rows: () => [['Date', 'Title', 'Message'], ...db.announcements.map(a => [a.date, a.title, a.text])] },
  invoices: { label: 'Invoices & payments', fin: true, info: 'Invoice, student, parent, programme, amount, status, dates, method', rows: () => [['Invoice', 'Student', 'Parent / client', 'Programme', 'Amount (THB)', 'Status', 'Issued', 'Due', 'Payment method'], ...db.invoices.map(i => ['INV-' + i.id, student(i.student).name, student(i.student).parent, i.subject, i.amount, i.status, i.date, i.due, i.method])] },
  payroll: { label: 'Teacher payroll', fin: true, info: 'Lessons per teacher per month and the calculated fee', rows: () => { const m = {}; db.lessons.forEach(l => { if (!l.teacher_id) return; const k = l.teacher + '|' + l.date.slice(0, 7); m[k] = (m[k] || 0) + 1 }); return [['Teacher', 'Month', 'Lessons', 'Rate per lesson (THB)', 'Total (THB)'], ...Object.entries(m).sort().map(([k, n]) => { const [t, mo] = k.split('|'); return [t, mo, n, PAY_RATE, n * PAY_RATE] })] } }
};
async function exportData(kind) {
  const x = EXPORTS[kind];
  if (!x || !allowed('Export data') || (x.fin && !allowed('Invoices & payments'))) { toast('You do not have access to that export'); return }
  if (!pending) { try { await loadAll() } catch { } }          // export fresh data
  const slug = (branchName() || 'branch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadCsv(`arcko-${slug}-${kind}-${todayStr()}.csv`, x.rows());
  toast(x.label + ' CSV downloaded');
}
function exportPage() {
  const items = Object.entries(EXPORTS).filter(([, x]) => !x.fin || allowed('Invoices & payments'));
  return head('Export data', 'Download your records as CSV files. They open in Excel and Google Sheets.')
    + (me.role === 'owner' && branches.length > 1 ? `<div class="note" style="margin-bottom:16px">Exporting data for <b>${esc(branchName())}</b>. Switch branch in the sidebar to export another branch.</div>` : '')
    + table(['DATA', 'WHAT IS INCLUDED', ''], items.map(([k, x]) => [`<b>${x.label}</b>`, x.info, btn('Download CSV', `exportData('${k}')`, 'small')]));
}

boot();
