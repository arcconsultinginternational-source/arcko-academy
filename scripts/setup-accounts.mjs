#!/usr/bin/env node
// Guided first-time setup. Run it from the project folder:   node scripts/setup-accounts.mjs
//
// It asks for your Supabase project details, then:
//   1. creates your first branch
//   2. creates four accounts (owner, manager, admin, teacher) with strong random passwords
//   3. writes config.js for you (project URL + public key)
//   4. checks that each role can sign in and that sign-ups are switched off
//
// The secret key you paste is used only while this script runs. It is never saved to a file.
// Safe to run again: existing branches and accounts are reused, passwords are not changed.

import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
let muted = false;
const origWrite = rl._writeToOutput;
rl._writeToOutput = function (s) { if (!muted) origWrite.call(rl, s) };

async function ask(q, { hidden = false, def = '' } = {}) {
  process.stdout.write(q + (def ? ` [${def}]` : '') + ': ');
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  if (done) { console.log('\nInput ended early. Run the script again.'); process.exit(1) }
  return (value || '').trim() || def;
}
const die = msg => { console.log('\n✗ ' + msg + '\n'); process.exit(1) };
const ok = msg => console.log('✓ ' + msg);

const jwtRole = k => { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role } catch { return null } };
const looksLikeKey = k => /^sb_(publishable|secret)_/.test(k) || k.startsWith('eyJ');

console.log('\nArcko Academy Studio · first-time setup\n');
console.log('You need three things from Supabase → Project Settings → API (or "API Keys"):');
console.log('  • Project URL      (looks like https://abcdefgh.supabase.co)');
console.log('  • Publishable key  (starts with sb_publishable_ ; older projects: the "anon" key)');
console.log('  • Secret key       (starts with sb_secret_ ; older projects: the "service_role" key)\n');

let URL_ = (await ask('Project URL')).replace(/\/+$/, '').replace(/\/(rest|auth)\/v1.*$/, '');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(URL_)) die('That does not look like a Supabase project URL. It should look like https://abcdefgh.supabase.co');
const ANON = await ask('Publishable (anon) key');
if (!looksLikeKey(ANON)) die('That does not look like a Supabase key.');
if (ANON.startsWith('sb_secret_') || jwtRole(ANON) === 'service_role') die('That is the SECRET key. Paste the PUBLISHABLE (anon) key here.');
const SERVICE = await ask('Secret (service_role) key (typing is hidden)', { hidden: true });
if (!looksLikeKey(SERVICE)) die('That does not look like a Supabase key.');
if (SERVICE.startsWith('sb_publishable_') || jwtRole(SERVICE) === 'anon') die('That is the PUBLISHABLE key. Paste the SECRET (service_role) key here.');
if (SERVICE === ANON) die('You pasted the same key twice.');

const branchName = await ask('Name of your first branch', { def: 'Sathorn' });
const who = {};
console.log('\nFour accounts. Emails need not be real inboxes; each can be, for example, you+manager@gmail.com.');
for (const [role, label, dname] of [['owner', 'Owner (you)', 'Anies'], ['manager', 'Manager (test)', 'Test Manager'], ['admin', 'Admin (test)', 'Test Admin'], ['teacher', 'Teacher (test)', 'Test Teacher']]) {
  const email = (await ask(`${label} email`)).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) die('That does not look like an email address.');
  const name = await ask(`${label} display name`, { def: dname });
  who[role] = { role, email, name };
}
if (new Set(Object.values(who).map(w => w.email)).size < 4) die('Each account needs its own email address.');
rl.close();

const headers = (key, extra = {}) => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json', ...extra });
async function api(method, path, key, body, extra) {
  let r;
  try { r = await fetch(URL_ + path, { method, headers: headers(key, extra), body: body ? JSON.stringify(body) : undefined }) }
  catch (e) { die('Could not reach ' + URL_ + ' (' + e.message + '). Check your internet connection and the project URL.') }
  const text = await r.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { ok: r.ok, status: r.status, json };
}
const errText = r => typeof r.json === 'string' ? r.json : (r.json?.msg || r.json?.message || r.json?.error_description || r.json?.error || JSON.stringify(r.json));

console.log('');
// 1. database must exist
let r = await api('GET', '/rest/v1/branches?select=id&limit=1', SERVICE);
if (r.status === 401 || r.status === 403) die('Supabase rejected the secret key. Copy it again from Project Settings → API.');
if (!r.ok) die('The database tables are not there yet (' + errText(r) + ').\nRun step 3 first (npx supabase db push), then run this script again.');
ok('Database tables found');

// 2. branch
r = await api('GET', `/rest/v1/branches?name=eq.${encodeURIComponent(branchName)}&select=id`, SERVICE);
let branchId = r.ok && r.json[0]?.id;
if (branchId) ok(`Branch "${branchName}" already exists (reused)`);
else {
  r = await api('POST', '/rest/v1/branches', SERVICE, { name: branchName }, { Prefer: 'return=representation' });
  if (!r.ok) die('Could not create the branch: ' + errText(r));
  branchId = r.json[0].id; ok(`Branch "${branchName}" created`);
}

// 3. accounts
r = await api('GET', '/auth/v1/admin/users?page=1&per_page=1000', SERVICE);
if (!r.ok) die('Could not read existing accounts: ' + errText(r));
const existing = new Map((r.json.users || []).map(u => [String(u.email).toLowerCase(), u.id]));
const fresh = [];
for (const w of Object.values(who)) {
  if (existing.has(w.email)) { w.id = existing.get(w.email); ok(`${w.role}: ${w.email} already exists (reused, password unchanged)`); continue }
  w.password = randomBytes(12).toString('base64url');
  r = await api('POST', '/auth/v1/admin/users', SERVICE, { email: w.email, password: w.password, email_confirm: true, user_metadata: { full_name: w.name } });
  if (!r.ok) die(`Could not create ${w.email}: ${errText(r)}`);
  w.id = r.json.id; fresh.push(w); ok(`${w.role}: ${w.email} created`);
}

// 4. roles
const rows = Object.values(who).map(w => ({ id: w.id, full_name: w.name, role: w.role, branch_id: w.role === 'owner' ? null : branchId }));
r = await api('POST', '/rest/v1/profiles?on_conflict=id', SERVICE, rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });
if (!r.ok) die('Could not save the roles: ' + errText(r));
ok('Roles saved (owner, manager, admin, teacher)');

// 5. config.js
writeFileSync(new URL('../config.js', import.meta.url), `// Written by scripts/setup-accounts.mjs. The publishable key is designed to be public.
// NEVER paste the secret / service_role key here.
window.ARCKO_CONFIG = {
  SUPABASE_URL: '${URL_}',
  SUPABASE_ANON_KEY: '${ANON}'
};
`);
ok('config.js written');

// 6. checks
console.log('\nChecking each role…');
let bad = 0;
const check = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) bad++ };
for (const w of fresh) {
  r = await api('POST', '/auth/v1/token?grant_type=password', ANON, { email: w.email, password: w.password });
  if (!r.ok) { check(false, `${w.role} cannot sign in: ${errText(r)}`); continue }
  const tok = r.json.access_token;
  const asUser = (path) => fetch(URL_ + path, { headers: { apikey: ANON, Authorization: 'Bearer ' + tok } }).then(async x => ({ ok: x.ok, json: await x.json().catch(() => null) }));
  const p = await asUser(`/rest/v1/profiles?select=role&id=eq.${w.id}`);
  check(p.ok && p.json?.[0]?.role === w.role, `${w.role} can sign in and is recognised as ${w.role}`);
  if (w.role === 'teacher') {
    const inv = await asUser('/rest/v1/invoices?select=id'), con = await asUser('/rest/v1/student_contacts?select=student_id'), leads = await asUser('/rest/v1/leads?select=id');
    check([inv, con, leads].every(x => x.ok && Array.isArray(x.json) && x.json.length === 0), 'teacher sees no invoices, parent contacts or leads');
  }
}
const probe = `probe-${randomBytes(4).toString('hex')}@example.com`;
r = await api('POST', '/auth/v1/signup', ANON, { email: probe, password: randomBytes(12).toString('base64url') });
if (r.ok && r.json?.id || r.ok && r.json?.user?.id) {
  const pid = r.json.id || r.json.user.id; await api('DELETE', `/auth/v1/admin/users/${pid}`, SERVICE);
  check(false, 'Public sign-ups are still ON. Turn them off: Supabase → Authentication → Sign In / Providers → "Allow new users to sign up" OFF');
} else check(true, 'Public sign-ups are off (strangers cannot create accounts)');

if (fresh.length) {
  console.log('\n──────────────── SAVE THESE NOW (shown only once) ────────────────');
  for (const w of fresh) console.log(`${w.role.padEnd(8)} ${w.email}   password: ${w.password}`);
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('Put them in a password manager, then clear this terminal window.');
}
console.log(bad ? `\n${bad} check(s) need attention (see ✗ above).\n` : '\nAll checks passed. Next: open the app and sign in (see README, step 4).\n');
process.exit(bad ? 1 : 0);
