const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};
const LOCAL_TOKEN = 'local-preview-only-not-a-real-invitation';
const MAX_BYTES = 8192;
const PUBLIC_COOKIE = '__Host-wedding-rsvp';
const SESSION_SECONDS = 365 * 24 * 60 * 60;
function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}), ...extraHeaders } });
}
function error(code, status) { return json({ error: code }, status); }
async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function encode64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function publicSession(request, secret, allowNew) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']);
  const cookie = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(PUBLIC_COOKIE + '='))?.slice(PUBLIC_COOKIE.length + 1);
  const now = Math.floor(Date.now() / 1000);
  if (cookie && /^[A-Za-z0-9_-]{43}\.\d{10}\.[A-Za-z0-9_-]{43}$/.test(cookie)) {
    const [nonce, expiry, signature] = cookie.split('.');
    const expires = Number(expiry);
    if (expires > now && expires <= now + SESSION_SECONDS && await crypto.subtle.verify('HMAC', key, decode64(signature), new TextEncoder().encode(nonce + '.' + expiry))) return { token:'public:' + nonce, expires };
  }
  if (!allowNew) return null;
  const nonce = encode64(crypto.getRandomValues(new Uint8Array(32))), expires = now + SESSION_SECONDS;
  const payload = nonce + '.' + expires;
  const signature = encode64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return { token:'public:' + nonce, expires, cookie:`${PUBLIC_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}` };
}
async function readBody(request, maxBytes = MAX_BYTES) {
  if (Number(request.headers.get('content-length')) > maxBytes) return { failure: error('payload_too_large', 413) };
  const reader = request.body?.getReader();
  let count = 0;
  const chunks = [];
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('body_timeout')), 8000); });
  try {
  if (reader) {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      count += value.byteLength;
      if (count > maxBytes) { await reader.cancel(); return { failure: error('payload_too_large', 413) }; }
      chunks.push(value);
    }
  }
  } catch { reader?.cancel().catch(() => {}); return { failure: error('request_timeout', 408) }; }
  finally { clearTimeout(timer); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { failure: error('invalid_json', 400) }; }
}
async function api(request, env, url) {
  if (!['/api/context', '/api/rsvp'].includes(url.pathname)) return error('not_found', 404);
  if (request.method !== 'POST') return error('method_not_allowed', 405);
  const preview = env.ENVIRONMENT === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (env.ENVIRONMENT === 'local' && !preview) return error('local_only', 403);
  const origin = preview ? url.origin : env.PUBLIC_ORIGIN;
  if (!origin || request.headers.get('origin') !== origin || url.origin !== origin) return error('invalid_origin', 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('json_required', 415);
  if (env.RSVP_ENABLED !== 'true' || !env.DB || (!preview && !env.RATE_LIMITER)) return error('unavailable', 503);
  const authorization = request.headers.get('authorization') || '';
  const publicGuest = !preview && !authorization && env.PUBLIC_RSVP_ENABLED === 'true';
  let token = preview && !authorization ? LOCAL_TOKEN : authorization.replace(/^Bearer /, '');
  if (publicGuest) {
    if (typeof env.PUBLIC_RSVP_SECRET !== 'string' || env.PUBLIC_RSVP_SECRET.length < 32) return error('unavailable', 503);
    const address = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await env.RATE_LIMITER.limit({ key:`wedding-public-ip:${await digest(address)}` })).success) return error('rate_limited', 429);
  } else if (!(preview && !authorization) && (!authorization.startsWith('Bearer ') || !/^[A-Za-z0-9_-]{32,128}$/.test(token) || token === LOCAL_TOKEN)) return error('invalid_invitation', 401);
  const body = await readBody(request);
  if (body.failure) return body.failure;
  const now = Math.floor(Date.now() / 1000);
  let session;
  if (publicGuest) {
    session = await publicSession(request, env.PUBLIC_RSVP_SECRET, url.pathname === '/api/context');
    if (!session) return error('session_required', 401);
    token = session.token;
  }
  const tokenHash = await digest(token);
  if (!preview && !(await env.RATE_LIMITER.limit({ key: `wedding:${tokenHash}` })).success) return error('rate_limited', 429);
  if (preview && token === LOCAL_TOKEN) {
    await env.DB.prepare('INSERT OR IGNORE INTO invitations (token_hash, max_party_size, expires_at) VALUES (?, ?, ?)').bind(tokenHash, 6, 4102444800).run();
  }
  // Read authorization only after the bounded body read; use SQL time for its snapshot.
  let invitation = await env.DB.prepare('SELECT max_party_size FROM invitations WHERE token_hash = ? AND revoked = 0 AND expires_at > unixepoch()').bind(tokenHash).first();
  const newPublicGuest = !invitation && publicGuest;
  if (newPublicGuest) {
    if (await env.DB.prepare('SELECT token_hash FROM invitations WHERE token_hash = ?').bind(tokenHash).first()) return error('invalid_invitation', 401);
    const configuredMax = Number(env.PUBLIC_MAX_PARTY_SIZE || 10);
    invitation = { max_party_size:Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 20 ? configuredMax : 10 };
  }
  if (!invitation) return error('invalid_invitation', 401);
  const managed = await env.DB.prepare('SELECT * FROM managed_guests WHERE invitation_hash = ?').bind(tokenHash).first();
  if (managed) {
    if (managed.deleted_at !== null) return error('invalid_invitation',401);
    if (url.pathname === '/api/context') return json({ ready:true, managed:true, preview, maxPartySize:invitation.max_party_size, version:managed.revision,
      guest:{name:managed.display_name}, arrangements:{recipient:managed.recipient,phone:managed.phone,address:managed.address}, partySize:managed.party_size, reply:['unsent','pending','likely'].includes(managed.attendance) ? null : {attendance:managed.attendance,partySize:managed.party_size} });
    return updateManaged(request,env,managed,body.value,'guest',preview);
  }
  if (url.pathname === '/api/context') {
    // Signed browser sessions stay stateless until a valid reply is submitted.
    if (newPublicGuest) return json({ ready:true, preview:false, maxPartySize:invitation.max_party_size, version:0, reply:null }, 200, session.cookie ? { 'Set-Cookie':session.cookie } : {});
    const current = await env.DB.prepare(`SELECT i.max_party_size, r.guest_name AS name, r.attendance, r.adult_count AS adultCount,
      r.child_count AS childCount, r.revision AS version FROM invitations i LEFT JOIN rsvps r ON r.invitation_hash = i.token_hash
      WHERE i.token_hash = ? AND i.revoked = 0 AND i.expires_at > unixepoch()`).bind(tokenHash).first();
    if (!current) return error('invalid_invitation', 401);
    const { max_party_size: maxPartySize, ...reply } = current;
    return json({ ready: true, preview, maxPartySize, version: reply.version || 0, reply: reply.version ? reply : null });
  }
  const data = body.value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return error('invalid_fields', 400);
  const name = typeof data.name === 'string' ? data.name.trim().normalize('NFC') : '';
  if (!name || Array.from(name).length > 80 || /[<>\u0000-\u001f\u007f]/u.test(name) || !['yes', 'no'].includes(data.attendance) || !Number.isInteger(data.adultCount) || !Number.isInteger(data.childCount) || data.adultCount < 0 || data.childCount < 0 || data.website) return error('invalid_fields', 400);
  const partySize = data.adultCount + data.childCount;
  if ((data.attendance === 'yes' && (partySize < 1 || partySize > invitation.max_party_size)) || (data.attendance === 'no' && partySize !== 0)) return error('invalid_party_size', 400);
  const requestId = request.headers.get('Idempotency-Key') || '';
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) return error('invalid_request_id', 400);
  if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0) return error('invalid_version',400);
  if (newPublicGuest) {
    if (data.expectedVersion !== 0) return error('version_conflict', 409);
    await env.DB.prepare('INSERT OR IGNORE INTO invitations (token_hash, max_party_size, expires_at) VALUES (?, ?, ?)').bind(tokenHash, invitation.max_party_size, session.expires).run();
  }
  const nextVersion = data.expectedVersion + 1;
  const payloadHash = await digest(JSON.stringify([name, data.attendance, data.adultCount, data.childCount, data.expectedVersion]));
  const existing = await env.DB.prepare('SELECT payload_hash, applied, result_revision FROM rsvp_requests WHERE invitation_hash = ? AND request_id = ?').bind(tokenHash, requestId).first();
  if (existing) {
    if (existing.payload_hash !== payloadHash) return error('idempotency_conflict', 409);
    if (existing.applied) return json({ saved: true, preview, replayed: true, version: existing.result_revision });
  }
  const windowStart = now - (now % 60);
  const limited = await env.DB.prepare(`INSERT INTO submission_limits (invitation_hash, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(invitation_hash) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
      window_start = excluded.window_start
    WHERE window_start != excluded.window_start OR attempts < 8
    RETURNING attempts`).bind(tokenHash, windowStart).first();
  if (!limited) return error('rate_limited', 429);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO rsvp_requests (invitation_hash, request_id, payload_hash, saved_at) VALUES (?, ?, ?, ?)').bind(tokenHash, requestId, payloadHash, now),
    env.DB.prepare(`INSERT INTO rsvps (invitation_hash, guest_name, attendance, party_size, adult_count, child_count, updated_at, revision, last_request_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rsvp_requests WHERE invitation_hash = ? AND request_id = ? AND payload_hash = ? AND applied = 0)
      AND COALESCE((SELECT revision FROM rsvps WHERE invitation_hash = ?), 0) = ?
      AND EXISTS (SELECT 1 FROM invitations WHERE token_hash = ? AND revoked = 0 AND expires_at > unixepoch() AND max_party_size >= ?)
      ON CONFLICT(invitation_hash) DO UPDATE SET guest_name = excluded.guest_name, attendance = excluded.attendance,
      party_size = excluded.party_size, adult_count = excluded.adult_count, child_count = excluded.child_count, updated_at = excluded.updated_at,
      revision = excluded.revision, last_request_id = excluded.last_request_id
      WHERE rsvps.revision = ?`).bind(tokenHash, name, data.attendance, partySize, data.adultCount, data.childCount, now, nextVersion, requestId, tokenHash, requestId, payloadHash, tokenHash, data.expectedVersion, tokenHash, partySize, data.expectedVersion),
    env.DB.prepare(`UPDATE rsvp_requests SET applied = 1, result_revision = ? WHERE invitation_hash = ? AND request_id = ? AND payload_hash = ?
      AND EXISTS (SELECT 1 FROM rsvps WHERE invitation_hash = ? AND revision = ? AND last_request_id = ?)`).bind(nextVersion, tokenHash, requestId, payloadHash, tokenHash, nextVersion, requestId)
  ]);
  const confirmed = await env.DB.prepare('SELECT payload_hash, applied FROM rsvp_requests WHERE invitation_hash = ? AND request_id = ?').bind(tokenHash, requestId).first();
  if (confirmed?.payload_hash !== payloadHash) return error('idempotency_conflict', 409);
  if (!confirmed?.applied) {
    const current = await env.DB.prepare('SELECT max_party_size FROM invitations WHERE token_hash = ? AND revoked = 0 AND expires_at > unixepoch()').bind(tokenHash).first();
    if (!current) return error('invalid_invitation', 401);
    if (partySize > current.max_party_size) return error('invalid_party_size', 400);
    return error('version_conflict', 409);
  }
  return json({ saved: true, preview, version: nextVersion });
}

const keyCache = new Map();
function decode64(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
export async function verifyAccessJwt(token, config, keys) {
  try {
    if (typeof token !== 'string' || token.length > 8192) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(decode64(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode64(parts[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode64(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return valid && claims.iss === config.issuer && audience.includes(config.audience) && typeof claims.exp === 'number' && claims.exp > now && (!claims.nbf || claims.nbf <= now) && typeof claims.email === 'string' && config.emails.includes(claims.email.toLowerCase());
  } catch { return false; }
}
async function authorizeAdmin(request, env, url) {
  if (env.ENVIRONMENT === 'local') return ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? null : error('local_only',403);
  if (env.ENVIRONMENT !== 'production' || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || !env.ADMIN_EMAILS || !/^[a-zA-Z0-9-]+\.cloudflareaccess\.com$/.test(env.CF_ACCESS_TEAM_DOMAIN)) return error('admin_unconfigured',503);
  if (url.origin !== env.PUBLIC_ORIGIN) return error('invalid_origin',403);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return error('unauthorized',401);
  const issuer = 'https://' + env.CF_ACCESS_TEAM_DOMAIN;
  let cached = keyCache.get(issuer);
  if (!cached || cached.expires < Date.now()) {
    const response = await fetch(issuer + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return error('unavailable',503);
    const result = await response.json();
    if (!Array.isArray(result.keys)) return error('unavailable',503);
    cached = { keys: result.keys, expires: Date.now() + 300000 };
    keyCache.set(issuer,cached);
  }
  const valid = await verifyAccessJwt(token, { issuer, audience:env.CF_ACCESS_AUD, emails:env.ADMIN_EMAILS.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean) }, cached.keys);
  return valid ? null : error('unauthorized',401);
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g,'""') + '"';
}
async function admin(request, env, url) {
  const denied = await authorizeAdmin(request, env, url);
  if (denied) return denied;
  if (url.pathname === '/api/admin/guests' || url.pathname.startsWith('/api/admin/guests/')) return managedAdmin(request,env,url);
  if (request.method !== 'GET') return error('method_not_allowed',405);
  if (['/admin','/admin/','/admin.html','/guest-admin','/guest-admin/','/guest-admin.html'].includes(url.pathname)) {
    const asset = await env.ASSETS.fetch(new Request(new URL('/guest-admin',url.origin), request));
    return new Response(asset.body, { status:asset.status, headers:{...Object.fromEntries(asset.headers),...SECURITY_HEADERS,'Cache-Control':'no-store'} });
  }
  if (!['/api/admin/rsvps','/api/admin/export'].includes(url.pathname)) return error('not_found',404);
  if (!env.DB) return error('unavailable',503);
  const { results: replies } = await env.DB.prepare('SELECT guest_name AS name, attendance, adult_count AS adultCount, child_count AS childCount, party_size AS partySize, updated_at AS updatedAt FROM rsvps ORDER BY updated_at DESC').all();
  const totals = { replies: replies.length, attendingParties:0, declinedParties:0, adults:0, children:0, guests:0 };
  for (const reply of replies) {
    if (reply.attendance === 'yes') { totals.attendingParties++; totals.adults += reply.adultCount; totals.children += reply.childCount; totals.guests += reply.partySize; }
    else totals.declinedParties++;
  }
  if (url.pathname === '/api/admin/export') {
    const rows = [['姓名','是否出席','成人','儿童','总人数（含本人）','最后更新（UTC+8）'], ...replies.map(r=>[r.name,r.attendance==='yes'?'出席':'缺席',r.adultCount,r.childCount,r.partySize,new Date(r.updatedAt*1000).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})])];
    return new Response('\uFEFF' + rows.map(row=>row.map(csvCell).join(',')).join('\r\n'), { headers:{...SECURITY_HEADERS,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="wedding-rsvp.csv"','Cache-Control':'no-store'} });
  }
  return json({ preview:env.ENVIRONMENT==='local',totals,replies });
}

function validGuestText(value, max, required = false) {
  return typeof value === 'string' && (!required || value.trim().length > 0) && Array.from(value).length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}
const CATEGORIES=['','新郎朋友','新娘朋友','新郎家人','新娘家人','新郎父母朋友','新娘父母朋友'];
function guestDetails(data,row={}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const locale=data.locale??row.locale??'zh-CN',category=data.category??row.category??'',note=data.note??row.note??'';
  if (!validGuestText(data.name,80,true) || /[\r\n\t]/u.test(data.name) || !validGuestText(note,500) || !['zh-CN','zh-TW'].includes(locale) || !CATEGORIES.includes(category)) return null;
  return {name:data.name.trim().normalize('NFC'),note:note.normalize('NFC'),locale,category};
}
function arrangements(row) {
  return {recipient:row.recipient,phone:row.phone,address:row.address,rooms:row.rooms,nights:row.nights,flightTickets:row.flight_tickets??row.party_size,flightTicketsAuto:row.flight_tickets===null};
}
function logistics(data,row) {
  const address=data.address??row.address,rooms=data.rooms??row.rooms,nights=data.nights??row.nights;
  const recipient=data.recipient??row.recipient,phone=data.phone??row.phone;
  if(!validGuestText(recipient,80)||!validGuestText(phone,60)||/[\r\n\t]/u.test(recipient+phone))return null;
  const flights=data.flightTicketsAuto===true?null:Object.hasOwn(data,'flightTickets')?data.flightTickets:row.flight_tickets;
  if(!validGuestText(address,600)||!Number.isInteger(rooms)||rooms<0||rooms>20||!Number.isInteger(nights)||nights<0||nights>30||(flights!==null&&(!Number.isInteger(flights)||flights<0||flights>20)))return null;
  return {recipient:recipient.trim().normalize('NFC'),phone:phone.trim(),address:address.trim().normalize('NFC'),rooms,nights,flights};
}
async function invitationKey(env) {
  const secret = env.INVITATION_LINK_SECRET || (env.ENVIRONMENT === 'local' ? 'local-only-managed-invitation-secret-do-not-use-in-production' : '');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('link_secret_unconfigured');
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptInvitation(token,id,key) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)},key,new TextEncoder().encode(token));
  return encode64(iv)+'.'+encode64(cipher);
}
async function presentGuest(row,key,origin) {
  const [iv,cipher]=row.link_cipher.split('.');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(iv),additionalData:new TextEncoder().encode(row.id)},key,decode64(cipher));
  return {id:row.id,name:row.display_name,note:row.note,category:row.category,...arrangements(row),status:row.attendance,partySize:row.party_size,invitedSize:row.invited_size,version:row.revision,deletedAt:row.deleted_at,
    updatedBy:row.updated_by,updatedAt:row.updated_at,privateUrl:origin+'/#invite='+new TextDecoder().decode(raw)};
}
async function updateManaged(request,env,row,data,actor,preview) {
  const adminEdit=actor==='admin';
  if (!data || typeof data !== 'object' || Array.isArray(data)) return error('invalid_fields',400);
  if(row.deleted_at!==null)return error('version_conflict',409);
  const details=adminEdit ? guestDetails(data,row) : null,extra=logistics(adminEdit?data:{recipient:data.recipient,phone:data.phone,address:data.address},row);
  const attendance=adminEdit ? data.status : data.attendance;
  if (!extra || (adminEdit && !details) || !(adminEdit ? ['unsent','pending','likely','yes','no'] : ['yes','no']).includes(attendance) || !Number.isInteger(data.partySize) || data.partySize < 0 || data.partySize > 20 || (attendance!=='no' ? data.partySize < 1 : data.partySize !== 0) || data.website) return error('invalid_fields',400);
  if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0) return error('invalid_version',400);
  const requestId=request.headers.get('Idempotency-Key') || '';
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) return error('invalid_request_id',400);
  // Hash the submitted patch, not mutable row defaults, so retries remain stable after a newer edit.
  const payloadHash=await digest(JSON.stringify([actor,data]));
  const prior=await env.DB.prepare('SELECT payload_hash, applied, result_revision FROM rsvp_requests WHERE invitation_hash = ? AND request_id = ?').bind(row.invitation_hash,requestId).first();
  if (prior) {
    if (prior.payload_hash !== payloadHash) return error('idempotency_conflict',409);
    if (prior.applied) return json({saved:true,preview,replayed:true,version:prior.result_revision});
  }
  const now=Math.floor(Date.now()/1000),next=data.expectedVersion+1;
  if (!adminEdit) {
    const window=now-now%60;
    const limit=await env.DB.prepare(`INSERT INTO submission_limits (invitation_hash,window_start,attempts) VALUES (?,?,1)
      ON CONFLICT(invitation_hash) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start
      WHERE window_start!=excluded.window_start OR attempts<8 RETURNING attempts`).bind(row.invitation_hash,window).first();
    if (!limit) return error('rate_limited',429);
  }
  // Metadata stays untouched by guest writes. All editors use the same SQL revision guard.
  const metadata=adminEdit ? 'display_name=?,note=?,locale=?,category=?,' : '';
  const parameters=adminEdit ? [details.name,details.note,details.locale,details.category] : [];
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO rsvp_requests (invitation_hash,request_id,payload_hash,saved_at) VALUES (?,?,?,?)').bind(row.invitation_hash,requestId,payloadHash,now),
    env.DB.prepare(`UPDATE managed_guests SET ${metadata} recipient=?,phone=?,address=?,rooms=?,nights=?,flight_tickets=?,attendance=?,party_size=?,invited_size=?,revision=?,last_request_id=?,updated_by=?,updated_at=?
      WHERE id=? AND revision=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM rsvp_requests WHERE invitation_hash=? AND request_id=? AND payload_hash=? AND applied=0)
      AND EXISTS (SELECT 1 FROM invitations WHERE token_hash=? AND revoked=0 AND expires_at>unixepoch() AND max_party_size>=?)`)
      .bind(...parameters,extra.recipient,extra.phone,extra.address,extra.rooms,extra.nights,extra.flights,attendance,data.partySize,attendance==='no'?row.invited_size:data.partySize,next,requestId,actor,now,row.id,data.expectedVersion,row.invitation_hash,requestId,payloadHash,row.invitation_hash,data.partySize),
    env.DB.prepare(`UPDATE rsvp_requests SET applied=1,result_revision=? WHERE invitation_hash=? AND request_id=? AND payload_hash=?
      AND EXISTS (SELECT 1 FROM managed_guests WHERE id=? AND revision=? AND last_request_id=?)`).bind(next,row.invitation_hash,requestId,payloadHash,row.id,next,requestId)
  ]);
  const result=await env.DB.prepare('SELECT payload_hash,applied FROM rsvp_requests WHERE invitation_hash=? AND request_id=?').bind(row.invitation_hash,requestId).first();
  if (result?.payload_hash!==payloadHash) return error('idempotency_conflict',409);
  if (!result.applied) return error('version_conflict',409);
  return json({saved:true,preview,version:next});
}
async function deleteOrRestore(request,env,row,data,restore) {
  if(!data||!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<0)return error('invalid_version',400);
  const requestId=request.headers.get('Idempotency-Key')||'';
  if(!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId))return error('invalid_request_id',400);
  const hash=await digest(JSON.stringify([restore?'restore':'delete',data.expectedVersion]));
  const prior=await env.DB.prepare('SELECT payload_hash,applied,result_revision FROM rsvp_requests WHERE invitation_hash=? AND request_id=?').bind(row.invitation_hash,requestId).first();
  if(prior){if(prior.payload_hash!==hash)return error('idempotency_conflict',409);if(prior.applied)return json({saved:true,replayed:true,version:prior.result_revision});}
  const now=Math.floor(Date.now()/1000),next=data.expectedVersion+1;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO rsvp_requests (invitation_hash,request_id,payload_hash,saved_at) VALUES (?,?,?,?)').bind(row.invitation_hash,requestId,hash,now),
    env.DB.prepare(`UPDATE managed_guests SET deleted_at=?,revision=?,last_request_id=?,updated_at=?,updated_by='admin' WHERE id=? AND revision=? AND deleted_at IS ${restore?'NOT ':''}NULL
      AND EXISTS (SELECT 1 FROM rsvp_requests WHERE invitation_hash=? AND request_id=? AND payload_hash=? AND applied=0)`).bind(restore?null:now,next,requestId,now,row.id,data.expectedVersion,row.invitation_hash,requestId,hash),
    env.DB.prepare(`UPDATE invitations SET revoked=? WHERE token_hash=?
      AND EXISTS (SELECT 1 FROM managed_guests WHERE id=? AND revision=? AND last_request_id=? AND deleted_at IS ${restore?'':'NOT '}NULL)
      AND EXISTS (SELECT 1 FROM rsvp_requests WHERE invitation_hash=? AND request_id=? AND payload_hash=? AND applied=0)`)
      .bind(restore?0:1,row.invitation_hash,row.id,next,requestId,row.invitation_hash,requestId,hash),
    env.DB.prepare('UPDATE rsvp_requests SET applied=1,result_revision=? WHERE invitation_hash=? AND request_id=? AND payload_hash=? AND EXISTS (SELECT 1 FROM managed_guests WHERE id=? AND revision=? AND last_request_id=?)').bind(next,row.invitation_hash,requestId,hash,row.id,next,requestId)
  ]);
  const result=await env.DB.prepare('SELECT payload_hash,applied FROM rsvp_requests WHERE invitation_hash=? AND request_id=?').bind(row.invitation_hash,requestId).first();
  if(result?.payload_hash!==hash)return error('idempotency_conflict',409);
  return result.applied?json({saved:true,version:next}):error('version_conflict',409);
}
async function managedAdmin(request,env,url) {
  if (!env.DB) return error('unavailable',503);
  const preview=env.ENVIRONMENT==='local',origin=preview ? url.origin : env.PUBLIC_ORIGIN;
  const path=url.pathname,collection=path==='/api/admin/guests',exporting=path==='/api/admin/guests/export';
  const restore=path.endsWith('/restore'),id=path.slice('/api/admin/guests/'.length).replace(/\/restore$/,'');
  if (!collection && !exporting && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return error('not_found',404);
  if (request.method==='GET' && (collection || exporting)) {
    const key=await invitationKey(env);
    const deleted=!exporting&&url.searchParams.get('deleted')==='1';
    const {results:rows}=await env.DB.prepare(`SELECT * FROM managed_guests WHERE deleted_at IS ${deleted?'NOT ':''}NULL ORDER BY created_at,id`).all();
    const guests=await Promise.all(rows.map(row=>presentGuest(row,key,origin)));
    const totals={invitations:0,unsent:0,pending:0,likely:0,attending:0,declined:0,guests:0};
    for(const guest of guests){totals.invitations+=guest.invitedSize;if(guest.status==='yes'){totals.attending+=guest.partySize;totals.guests+=guest.partySize;}else if(guest.status==='no')totals.declined+=guest.invitedSize;else if(guest.status==='likely')totals.likely+=guest.partySize;else if(guest.status==='unsent')totals.unsent+=guest.partySize;else totals.pending+=guest.partySize;}
    if(exporting){
      const labels={unsent:'未发出',pending:'待回复',likely:'大概率出席',yes:'出席',no:'不出席'};
      const csv=[['宾客 / 家庭','宾客分类','出席状态','出席人数（含本人）','住宿间数','住宿夜数','机票数量','收件人','联络电话','纸质请帖收件地址','内部备注','最后修改者','更新时间（UTC+8）','私人链接'],...guests.map(g=>[g.name,g.category,labels[g.status],g.partySize,g.rooms,g.nights,g.flightTickets,g.recipient,g.phone,g.address,g.note,g.updatedBy==='guest'?'宾客':'管理员',new Date(g.updatedAt*1000).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}),g.privateUrl])];
      return new Response('\uFEFF'+csv.map(r=>r.map(csvCell).join(',')).join('\r\n'),{headers:{...SECURITY_HEADERS,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="wedding-guests.csv"','Cache-Control':'no-store'}});
    }
    return json({preview,guests,totals});
  }
  if (!(collection && request.method==='POST') && !(!collection && !exporting && (restore?request.method==='POST':['PATCH','DELETE'].includes(request.method)))) return error('method_not_allowed',405);
  if (!origin || url.origin!==origin || request.headers.get('origin')!==origin) return error('invalid_origin',403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('json_required',415);
  const body=await readBody(request,8192);if(body.failure)return body.failure;
  const data=body.value;
  if (!collection){
    const row=await env.DB.prepare('SELECT * FROM managed_guests WHERE id=?').bind(id).first();
    if(!row)return error('not_found',404);
    if(restore||request.method==='DELETE')return deleteOrRestore(request,env,row,data,restore);
    return updateManaged(request,env,row,data,'admin',preview);
  }
  const details=guestDetails(data);
  if(!details || typeof data.id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.id))return error('invalid_fields',400);
  const key=await invitationKey(env),createHash=await digest(JSON.stringify(details));
  async function existing(){
    const row=await env.DB.prepare('SELECT * FROM managed_guests WHERE id=?').bind(data.id).first();
    return row ? row.create_hash===createHash ? json({guest:await presentGuest(row,key,origin),replayed:true},200) : error('idempotency_conflict',409) : null;
  }
  const prior=await existing();if(prior)return prior;
  const token=encode64(crypto.getRandomValues(new Uint8Array(32))),hash=await digest(token),now=Math.floor(Date.now()/1000);
  const cipher=await encryptInvitation(token,data.id,key);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO invitations (token_hash,max_party_size,expires_at) VALUES (?,20,?)').bind(hash,now+SESSION_SECONDS),
      env.DB.prepare(`INSERT INTO managed_guests (id,invitation_hash,display_name,note,locale,category,created_at,updated_at,link_cipher,create_hash) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(data.id,hash,details.name,details.note,details.locale,details.category,now,now,cipher,createHash)
    ]);
  } catch(error) { const retry=await existing();if(retry)return retry;throw error; }
  const row=await env.DB.prepare('SELECT * FROM managed_guests WHERE id=?').bind(data.id).first();
  return json({guest:await presentGuest(row,key,origin)},201);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      url.pathname = decodeURIComponent(url.pathname);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname === '/admin.html' || url.pathname === '/guest-admin' || url.pathname.startsWith('/guest-admin/') || url.pathname === '/guest-admin.html' || url.pathname.startsWith('/api/admin/')) return await admin(request, env, url);
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key, value);
      return response;
    } catch {
      // Do not log request bodies, names, bearer tokens or database errors.
      return error('unavailable', 503);
    }
  }
};
