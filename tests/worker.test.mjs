import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { verifyAccessJwt } from '../src/worker.mjs';

const token = 'test-only-abcdefghijklmnopqrstuvwxyz-123456';
const hash = createHash('sha256').update(token).digest('hex');
function fixture(overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sqlite.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  sqlite.prepare('INSERT INTO invitations VALUES (?, ?, ?, 0)').run(hash, 4, Math.floor(Date.now() / 1000) + 86400);
  let transactionQueue = Promise.resolve();
  const DB = { batch(statements) { const run = transactionQueue.then(async () => { sqlite.exec('BEGIN'); try { const r=[]; for(const stmt of statements) r.push(await stmt.run()); sqlite.exec('COMMIT'); return r; } catch(e) { sqlite.exec('ROLLBACK'); throw e; } }); transactionQueue = run.catch(() => {}); return run; }, prepare(sql) {
    let params = [];
    const statement = {
      bind(...args) { params = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      async run() { return { meta: sqlite.prepare(sql).run(...params) }; }
    };
    return statement;
  } };
  const env = { DB, ENVIRONMENT: 'production', RSVP_ENABLED: 'true', PUBLIC_ORIGIN: 'https://wedding.example', RATE_LIMITER: { async limit() { return { success: true }; } }, ASSETS: { async fetch() { return new Response('static'); } }, ...overrides };
  let requestNumber = 0;
  function request(path = '/api/rsvp', body = { name: '测试宾客', attendance: 'yes', adultCount: 2, childCount: 0 }, options = {}) {
    if (body && typeof body === 'object' && !Array.isArray(body) && body.expectedVersion === undefined) body = { ...body, expectedVersion: sqlite.prepare('SELECT revision FROM rsvps WHERE invitation_hash = ?').get(hash)?.revision || 0 };
    return worker.fetch(new Request(`https://wedding.example${path}`, { method: 'POST', headers: { Origin: 'https://wedding.example', 'Content-Type': 'application/json', 'Idempotency-Key': `test-request-${String(++requestNumber).padStart(24,'0')}`, Authorization: `Bearer ${token}`, ...options.headers }, body: JSON.stringify(body) }), env);
  }
  return { sqlite, env, request };
}

test('saves RSVP to SQL and updates one invitation instead of duplicating it', async () => {
  const f = fixture();
  assert.equal((await f.request()).status, 200);
  assert.equal(f.sqlite.prepare('SELECT * FROM rsvps').get().party_size, 2);
  assert.equal((await f.request('/api/rsvp', { name: '测试宾客', attendance: 'no', adultCount: 0, childCount: 0 })).status, 200);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM rsvps').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT * FROM rsvps').get().party_size, 0);
});
test('rejects absent, invalid, expired and revoked tokens', async () => {
  const f = fixture();
  assert.equal((await f.request(undefined, undefined, { headers: { Authorization: '' } })).status, 401);
  assert.equal((await f.request(undefined, undefined, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  f.sqlite.prepare('UPDATE invitations SET expires_at = 1').run();
  assert.equal((await f.request()).status, 401);
  f.sqlite.prepare('UPDATE invitations SET expires_at = ?, revoked = 1').run(Math.floor(Date.now() / 1000) + 86400);
  assert.equal((await f.request()).status, 401);
});
test('validates name, attendance and the invitation party-size limit', async () => {
  const f = fixture();
  for (const body of [null, {}, { name: '', attendance: 'yes', adultCount: 1, childCount: 0 }, { name: 'a', attendance: 'yes', adultCount: 5, childCount: 0 }, { name: 'a', attendance: 'yes', adultCount: 1.5, childCount: 0 }, { name: 'a', attendance: 'maybe', adultCount: 1, childCount: 0 }, { name: 'a', attendance: 'no', adultCount: 2, childCount: 0 }, { name: '<script>', attendance: 'yes', adultCount: 1, childCount: 0 }, { name: 'a', attendance: 'yes', adultCount: 1, childCount: 0, website: 'bot' }]) assert.equal((await f.request('/api/rsvp', body)).status, 400);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM rsvps').get().n, 0);
});
test('treats SQL-looking names as literal data', async () => {
  const f = fixture();
  const name = "O'Connor'); DROP TABLE rsvps; --";
  assert.equal((await f.request('/api/rsvp', { name, attendance: 'yes', adultCount: 1, childCount: 0 })).status, 200);
  assert.equal(f.sqlite.prepare('SELECT guest_name FROM rsvps').get().guest_name, name);
});
test('rejects cross-origin requests and never exposes a public guest list', async () => {
  const f = fixture();
  assert.equal((await f.request(undefined, undefined, { headers: { Origin: 'https://evil.example' } })).status, 403);
  for (const path of ['/api/rsvps', '/api/admin', '/api/rsvp']) {
    const result = await worker.fetch(new Request(`https://wedding.example${path}`), f.env);
    assert.ok([404, 405].includes(result.status));
    assert.ok(!(await result.text()).includes('测试宾客'));
  }
});
test('fails closed when collection, required binding or database is unavailable', async () => {
  for (const overrides of [{ RSVP_ENABLED: 'false' }, { DB: undefined }, { RATE_LIMITER: undefined }, { DB: { prepare() { throw new Error('database unavailable'); } } }]) {
    assert.equal((await fixture(overrides).request()).status, 503);
  }
});
test('rate limits repeated valid writes and network abuse', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 429);
  assert.equal((await fixture({ RATE_LIMITER: { async limit() { return { success: false }; } } }).request()).status, 429);
});
test('returns only invitation limits in context, with private response headers', async () => {
  const f = fixture();
  const response = await f.request('/api/context', {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true, preview: false, maxPartySize: 4, version: 0, reply: null });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('limits request bytes and enforces JSON', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/rsvp', { name: 'a'.repeat(9000) })).status, 413);
  assert.equal((await f.request(undefined, undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
});
test('counts adults and children separately and rejects fractions, negatives and excessive totals', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/rsvp', { name:'测试家庭', attendance:'yes', adultCount:2, childCount:2 })).status, 200);
  assert.deepEqual({...f.sqlite.prepare('SELECT adult_count, child_count, party_size FROM rsvps').get()}, { adult_count:2, child_count:2, party_size:4 });
  for (const [adultCount,childCount] of [[-1,2],[1,0.5],[3,2],[0,0],[1,-1]]) assert.equal((await f.request('/api/rsvp', { name:'测试家庭', attendance:'yes',adultCount,childCount })).status, 400);
});
test('idempotent retry never overwrites a newer edit, and conflicting reuse is rejected', async () => {
  const f=fixture();
  const key='test-idempotency-key-123456789012345678';
  const original={name:'测试家庭',attendance:'yes',adultCount:2,childCount:1,expectedVersion:0};
  assert.equal((await f.request('/api/rsvp',original,{headers:{'Idempotency-Key':key}})).status,200);
  assert.equal((await f.request('/api/rsvp',{...original,adultCount:1,childCount:0,expectedVersion:1})).status,200);
  assert.equal((await f.request('/api/rsvp',original,{headers:{'Idempotency-Key':key}})).status,200);
  assert.equal(f.sqlite.prepare('SELECT party_size FROM rsvps').get().party_size,1);
  assert.equal((await f.request('/api/rsvp',{...original,adultCount:3},{headers:{'Idempotency-Key':key}})).status,409);
});
test('late first application and simultaneous tab edits cannot overwrite a confirmed newer revision', async () => {
  const f=fixture();
  const older={name:'Older attempt',attendance:'yes',adultCount:2,childCount:0,expectedVersion:0};
  const newer={name:'Confirmed edit',attendance:'yes',adultCount:4,childCount:0,expectedVersion:0};
  assert.equal((await f.request('/api/rsvp',newer)).status,200);
  assert.equal((await f.request('/api/rsvp',older)).status,409);
  assert.equal(f.sqlite.prepare('SELECT guest_name FROM rsvps').get().guest_name,'Confirmed edit');
  assert.equal((await f.request('/api/rsvp',{...newer,adultCount:3,expectedVersion:1})).status,200);
  assert.equal((await f.request('/api/rsvp',{...newer,adultCount:1,expectedVersion:1})).status,409);
  assert.equal(f.sqlite.prepare('SELECT party_size FROM rsvps').get().party_size,3);
});
test('ordinary English names are accepted and actual control characters are rejected', async () => {
  const f=fixture();
  for (const name of ['Alice','Bob','Charlie Chen']) assert.equal((await f.request('/api/rsvp',{name,attendance:'yes',adultCount:1,childCount:0})).status,200);
  for (const code of [0,1,9,10,31,127]) assert.equal((await f.request('/api/rsvp',{name:'Jo'+String.fromCharCode(code)+'hn',attendance:'yes',adultCount:1,childCount:0})).status,400);
});
test('admin page, replies and export fail closed in production and ignore forged identity headers', async () => {
  const f=fixture();
  for(const path of ['/admin','/admin.html','/api/admin/rsvps','/api/admin/export']) {
    const res=await worker.fetch(new Request('https://wedding.example'+path,{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test'}}),f.env);
    assert.equal(res.status,503);
  }
  f.env.CF_ACCESS_TEAM_DOMAIN='test-team.cloudflareaccess.com'; f.env.CF_ACCESS_AUD='test-audience'; f.env.ADMIN_EMAILS='owner@example.test';
  const res=await worker.fetch(new Request('https://wedding.example/api/admin/rsvps',{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test'}}),f.env);
  assert.equal(res.status,401);
});
test('local admin aggregates adults and children and escapes CSV formula payloads', async () => {
  const f=fixture();
  await f.request('/api/rsvp',{name:'=1+1',attendance:'yes',adultCount:2,childCount:1});
  f.env.ENVIRONMENT='local';
  const r=await worker.fetch(new Request('http://127.0.0.1/api/admin/rsvps'),f.env);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.deepEqual(data.totals,{replies:1,attendingParties:1,declinedParties:0,adults:2,children:1,guests:3});
  assert.equal(JSON.stringify(data).includes(hash),false);
  const csv=await worker.fetch(new Request('http://127.0.0.1/api/admin/export'),f.env);
  assert.match(await csv.text(),/"'=1\+1"/);
  assert.equal(csv.headers.get('Cache-Control'),'no-store');
});

test('a first batch delayed behind a confirmed newer edit is rejected atomically', async () => {
  const f=fixture(); const original=f.env.DB.batch.bind(f.env.DB);
  let release, reached; const paused=new Promise(r=>reached=r); const gate=new Promise(r=>release=r); let first=true;
  f.env.DB.batch=async statements=>{if(first){first=false;reached();await gate;}return original(statements);};
  const a=f.request('/api/rsvp',{name:'Older request',attendance:'yes',adultCount:2,childCount:0,expectedVersion:0});
  await paused;
  const b=await f.request('/api/rsvp',{name:'Confirmed newer edit',attendance:'yes',adultCount:4,childCount:0,expectedVersion:0});
  assert.equal(b.status,200);release();
  assert.equal((await a).status,409);
  assert.equal(f.sqlite.prepare('SELECT party_size FROM rsvps').get().party_size,4);
});

test('concurrent same-key retries apply once and mismatched payloads cannot both succeed', async () => {
  for(const mismatch of [false,true]){
    const f=fixture(); const body={name:'Retry',attendance:'yes',adultCount:2,childCount:0,expectedVersion:0};
    const options={headers:{'Idempotency-Key':'same-key-concurrent-123456789'}};
    const results=await Promise.all([f.request('/api/rsvp',body,options),f.request('/api/rsvp',{...body,adultCount:mismatch?3:2},options)]);
    assert.deepEqual(results.map(r=>r.status).sort(),mismatch?[200,409]:[200,200]);
    assert.equal(f.sqlite.prepare('SELECT revision FROM rsvps').get().revision,1);
  }
});

test('delayed request bodies cannot retain revoked, expired or reduced invitation privileges', async () => {
  for(const path of ['/api/context','/api/rsvp']) for(const mutation of ['revoked = 1','expires_at = 1','max_party_size = 1']){
    const f=fixture();await f.request();
    let controller, started;const waiting=new Promise(r=>started=r);
    const stream=new ReadableStream({start(c){controller=c;},pull(){started();}},{highWaterMark:0});
    const pending=worker.fetch(new Request('https://wedding.example'+path,{method:'POST',duplex:'half',headers:{Origin:'https://wedding.example','Content-Type':'application/json',Authorization:'Bearer '+token,'Idempotency-Key':'delayed-body-test-key-123456'},body:stream}),f.env);
    await waiting;f.sqlite.prepare('UPDATE invitations SET '+mutation).run();
    controller.enqueue(new TextEncoder().encode(JSON.stringify({name:'Delayed',attendance:'yes',adultCount:4,childCount:0,expectedVersion:1})));controller.close();
    const response=await pending;
    if(mutation==='max_party_size = 1' && path==='/api/context'){assert.equal(response.status,200);assert.equal((await response.json()).maxPartySize,1);}
    else assert.equal(response.status,mutation==='max_party_size = 1'?400:401);
    assert.equal(f.sqlite.prepare('SELECT party_size FROM rsvps').get().party_size,2);
  }
});

test('the final SQL write also checks invitation validity and the current cap', async () => {
  for(const mutation of ['revoked = 1','expires_at = 1','max_party_size = 1']){
    const f=fixture();const original=f.env.DB.batch.bind(f.env.DB);
    f.env.DB.batch=statements=>{f.sqlite.prepare('UPDATE invitations SET '+mutation).run();return original(statements);};
    const response=await f.request('/api/rsvp',{name:'Pending',attendance:'yes',adultCount:4,childCount:0,expectedVersion:0});
    assert.equal(response.status,mutation==='max_party_size = 1'?400:401);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM rsvps').get().n,0);
  }
});

test('Access JWT requires a valid ephemeral signature and matching current claims', async () => {
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test-key'};
  const config={issuer:'https://test.cloudflareaccess.com',audience:'test-aud',emails:['owner@example.test']};
  const claims={iss:config.issuer,aud:[config.audience],email:config.emails[0],exp:Math.floor(Date.now()/1000)+600};
  async function sign(changes={},header={alg:'RS256',kid:'test-key'}){const body=[header,{...claims,...changes}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(body));return body+'.'+Buffer.from(signature).toString('base64url');}
  assert.equal(await verifyAccessJwt(await sign(),config,[jwk]),true);
  for(const changes of [{exp:1},{iss:'https://evil.example'},{aud:'other'},{email:'other@example.test'},{nbf:claims.exp+600}])assert.equal(await verifyAccessJwt(await sign(changes),config,[jwk]),false);
  assert.equal(await verifyAccessJwt(await sign({}, {alg:'none',kid:'test-key'}),config,[jwk]),false);
  const valid=await sign();assert.equal(await verifyAccessJwt(valid.slice(0,valid.lastIndexOf('.')+1)+'Zm9yZ2Vk',config,[jwk]),false);
});

const publicConfig={PUBLIC_RSVP_ENABLED:'true',PUBLIC_RSVP_SECRET:'unit-test-secret-not-for-production-0123456789'};
async function publicSession(f){
  const response=await f.request('/api/context',{}, {headers:{Authorization:''}});
  assert.equal(response.status,200);
  return {cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json(),headers:response.headers};
}
function publicRequest(f,cookie,body,headers={}){
  return f.request('/api/rsvp',{name:'Public guest',attendance:'yes',adultCount:2,childCount:1,expectedVersion:0,...body},{headers:{Authorization:'',Cookie:cookie,...headers}});
}
test('public home page gets a private stateless session, then saves and updates one real reply',async()=>{
  const f=fixture(publicConfig), session=await publicSession(f);
  assert.deepEqual(session.data,{ready:true,preview:false,maxPartySize:10,version:0,reply:null});
  assert.match(session.headers.get('set-cookie'),/^__Host-wedding-rsvp=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000$/);
  assert.equal(session.headers.get('cache-control'),'no-store');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM invitations').get().n,1,'context must not create a DB row');
  assert.equal((await publicRequest(f,session.cookie)).status,200);
  const saved=f.sqlite.prepare('SELECT * FROM rsvps').get();assert.equal(saved.guest_name,'Public guest');assert.equal(saved.party_size,3);
  const context=await f.request('/api/context',{}, {headers:{Authorization:'',Cookie:session.cookie}});
  const current=await context.json();assert.equal(current.version,1);assert.equal(current.reply.name,'Public guest');assert.equal(context.headers.get('set-cookie'),null);
  assert.equal((await publicRequest(f,session.cookie,{attendance:'no',adultCount:0,childCount:0,expectedVersion:1})).status,200);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM rsvps').get().n,1);assert.equal(f.sqlite.prepare('SELECT revision FROM rsvps').get().revision,2);
});
test('public visitors cannot read each other, forge sessions, or bypass the invitation channel',async()=>{
  const f=fixture(publicConfig),a=await publicSession(f),b=await publicSession(f);
  assert.notEqual(a.cookie,b.cookie);assert.equal((await publicRequest(f,a.cookie)).status,200);
  const response=await f.request('/api/context',{}, {headers:{Authorization:'',Cookie:b.cookie}});assert.equal((await response.json()).reply,null);
  for(const cookie of ['',a.cookie.slice(0,-5)+'aaaaa',a.cookie.replace(/\.\d+\./,'.1.')])assert.equal((await publicRequest(f,cookie)).status,401);
  assert.equal((await f.request('/api/context',{}, {headers:{Authorization:'Bearer invalid',Cookie:a.cookie}})).status,401);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM rsvps').get().n,1);
});
test('public initialization is rate limited, gated, origin checked, and does not create rows for invalid input',async()=>{
  for(const overrides of [{PUBLIC_RSVP_SECRET:undefined},{PUBLIC_RSVP_SECRET:'short'}])assert.equal((await fixture({...publicConfig,...overrides}).request('/api/context',{}, {headers:{Authorization:''}})).status,503);
  const limited=fixture({...publicConfig,RATE_LIMITER:{async limit(){return {success:false};}}});
  assert.equal((await limited.request('/api/context',{}, {headers:{Authorization:''}})).status,429);
  const f=fixture(publicConfig),session=await publicSession(f);
  assert.equal((await f.request('/api/context',{}, {headers:{Authorization:'',Origin:'https://evil.example'}})).status,403);
  for(const changes of [{adultCount:11},{website:'bot'},{name:'<bad>'},{expectedVersion:2}])assert.ok([400,409].includes((await publicRequest(f,session.cookie,changes)).status));
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM invitations').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM rsvps').get().n,0);
});
test('public replies keep idempotency, revision conflicts and server-side revocation',async()=>{
  const f=fixture(publicConfig),session=await publicSession(f),headers={'Idempotency-Key':'public-retry-key-123456789012'};
  assert.equal((await publicRequest(f,session.cookie,{},headers)).status,200);
  const retry=await publicRequest(f,session.cookie,{},headers);assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);
  assert.equal((await publicRequest(f,session.cookie,{adultCount:4})).status,409);
  f.sqlite.prepare('UPDATE invitations SET revoked=1 WHERE token_hash != ?').run(hash);
  assert.equal((await publicRequest(f,session.cookie,{expectedVersion:1})).status,401);
  assert.equal((await f.request('/api/context',{}, {headers:{Authorization:'',Cookie:session.cookie}})).status,401);
});
