// Vercel serverless function: creates a team login (teacher, admin or manager).
//
// Why a server function: creating a login needs Supabase's SECRET key, which must never
// be placed in the website's browser code. The key lives only in Vercel's environment
// settings (SUPABASE_URL and SUPABASE_SECRET_KEY).
//
// Who may do what (checked here, on the server, from the caller's verified login):
//   owner   -> may create manager, admin or teacher in any existing branch
//   manager -> may create admin or teacher, in their own branch only
//   anyone else -> refused
const crypto = require('crypto');

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const headers = (key, extra = {}) => ({
  apikey: key,
  ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}),   // legacy keys are JWTs; new sb_secret_ keys go in apikey only
  'Content-Type': 'application/json',
  ...extra
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['teacher', 'admin', 'manager'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });

  const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SECRET = process.env.SUPABASE_SECRET_KEY || '';
  if (!URL_ || !SECRET) {
    return send(res, 500, { error: 'Adding team members is not switched on yet. The owner needs to add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel (Project → Settings → Environment Variables), then redeploy.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = null } }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid request' });

  // 1. Who is calling? Ask Supabase to verify their login token.
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const publicKey = String(req.headers['x-apikey'] || '');
  if (!token || !publicKey) return send(res, 401, { error: 'Please sign in again.' });
  let uid;
  try {
    const r = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: publicKey, Authorization: 'Bearer ' + token } });
    if (!r.ok) return send(res, 401, { error: 'Please sign in again.' });
    uid = (await r.json()).id;
  } catch { return send(res, 502, { error: 'Could not reach Supabase.' }) }
  if (!UUID.test(String(uid))) return send(res, 401, { error: 'Please sign in again.' });

  try {
    // 2. What is their role? (read with the secret key, so the answer cannot be faked by the browser)
    let r = await fetch(`${URL_}/rest/v1/profiles?select=role,branch_id&id=eq.${uid}`, { headers: headers(SECRET) });
    const caller = r.ok ? (await r.json())[0] : null;
    if (!caller || !['owner', 'manager'].includes(caller.role)) return send(res, 403, { error: 'Only the owner or a branch manager can add team members.' });

    // 3. Validate what they asked for.
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const role = String(body.role || '');
    if (!name || name.length > 80) return send(res, 400, { error: 'Enter the person’s full name.' });
    if (!EMAIL.test(email) || email.length > 254) return send(res, 400, { error: 'Enter a valid email address.' });
    if (!ROLES.includes(role)) return send(res, 400, { error: 'Choose a role.' });
    if (caller.role === 'manager' && role === 'manager') return send(res, 403, { error: 'Managers can add teachers and admins only.' });

    let branchId;
    if (caller.role === 'manager') branchId = caller.branch_id;           // a manager can only ever add to their own branch
    else {
      branchId = Number(body.branch_id);
      if (!Number.isInteger(branchId) || branchId < 1) return send(res, 400, { error: 'Choose a branch.' });
      r = await fetch(`${URL_}/rest/v1/branches?select=id&id=eq.${branchId}`, { headers: headers(SECRET) });
      if (!r.ok || !(await r.json()).length) return send(res, 400, { error: 'That branch does not exist.' });
    }

    // 4. Create the login with a random password.
    const password = crypto.randomBytes(12).toString('base64url');
    r = await fetch(URL_ + '/auth/v1/admin/users', {
      method: 'POST', headers: headers(SECRET),
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
    });
    const created = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(created.msg || created.message || created.error_description || '');
      if (r.status === 422 || /already|registered|exists/i.test(msg)) return send(res, 409, { error: 'That email already has an account.' });
      return send(res, 400, { error: 'Could not create the login. ' + msg });
    }

    // 5. Give them their role. If this fails, remove the login so nothing is left half-made.
    r = await fetch(URL_ + '/rest/v1/profiles', {
      method: 'POST', headers: headers(SECRET, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ id: created.id, full_name: name, role, branch_id: branchId })
    });
    if (!r.ok) {
      await fetch(`${URL_}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: headers(SECRET) }).catch(() => { });
      return send(res, 500, { error: 'Could not save the role. Nothing was created. Please try again.' });
    }

    return send(res, 200, { ok: true, name, email, role, password });
  } catch (e) {
    console.error('create-staff failed:', e && e.message);
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
};
