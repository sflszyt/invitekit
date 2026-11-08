import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import worker from '../src/worker.mjs';

function fixture({beforeBatch}={}) {
  const sql = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sql.exec(readFileSync(new URL('../migrations/'+file, import.meta.url),'utf8'));
  let queue = Promise.resolve();
  const DB = { prepare(query) {
    let args = [];
    const statement = { query, bind(...values) { args=values; return statement; }, async first() { return sql.prepare(query).get(...args)||null; }, async all() { return {results:sql.prepare(query).all(...args)}; }, async run() { return {meta:sql.prepare(query).run(...args)}; } };
    return statement;
  }, async batch(statements) {
    if(beforeBatch)await beforeBatch(statements);
    const result=queue.then(async()=>{sql.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}});
    queue=result.catch(()=>{});return result;
  } };
  const env={DB,ENVIRONMENT:'production',PUBLIC_ORIGIN:'https://wedding.example',RSVP_ENABLED:'true',INVITATION_LINK_SECRET:'test-only-secret-with-at-least-32-characters',RATE_LIMITER:{async limit(){return {success:true};}},ASSETS:{async fetch(){return new Response('asset');}}};
  const send=(path,body,options={})=>{
    const local=options.admin||options.local;
    const origin=local?'http://127.0.0.1:8799':'https://wedding.example';
    return worker.fetch(new Request(origin+path,{method:options.method||(body===undefined?'GET':'POST'),headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':options.key||randomUUID(),...(options.token?{Authorization:'Bearer '+options.token}:{}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),local?{...env,ENVIRONMENT:'local',PUBLIC_ORIGIN:undefined}:env);
  };
  const admin=(path,body,options={})=>send(path,body,{...options,admin:true});
  const create=async(name='王叔叔一家',extra={})=>{
    const response=await admin('/api/admin/guests',{id:randomUUID(),name,note:'只供新人看的安排',locale:'zh-CN',...extra});
    assert.equal(response.status,201,await response.clone().text());
    return (await response.json()).guest;
  };
  return {sql,env,send,admin,create};
}
const tokenFor=guest=>new URLSearchParams(new URL(guest.privateUrl).hash.slice(1)).get('invite');

test('likely attendance is admin-only, exported and counted separately until the guest replies',async()=>{
  const f=fixture(),g=await f.create(),token=tokenFor(g);
  assert.equal((await f.send('/api/rsvp',{attendance:'likely',partySize:2,expectedVersion:0},{token})).status,400);
  assert.equal((await f.admin('/api/admin/guests/'+g.id,{...g,status:'likely',partySize:2,expectedVersion:0},{method:'PATCH'})).status,200);
  const list=await (await f.admin('/api/admin/guests')).json();
  assert.equal(list.guests[0].status,'likely');assert.equal(list.totals.likely,2);
  assert.equal(list.totals.pending,0);assert.equal(list.totals.attending,0);assert.equal(list.totals.guests,0);
  assert.match(await (await f.admin('/api/admin/guests/export')).text(),/大概率出席/);
  const context=await (await f.send('/api/context',{}, {token})).json();
  assert.equal(context.reply,null);assert.equal(context.version,1);
  assert.equal((await f.send('/api/rsvp',{attendance:'yes',partySize:3,expectedVersion:1},{token})).status,200);
  const updated=await (await f.admin('/api/admin/guests')).json();
  assert.equal(updated.guests[0].status,'yes');assert.equal(updated.totals.likely,0);assert.equal(updated.totals.attending,3);
});

test('summary counts people and retains their number when an invitation declines',async()=>{
  const f=fixture(),g=await f.create();await f.create('另一位宾客');
  await f.admin('/api/admin/guests/'+g.id,{...g,partySize:4,expectedVersion:0},{method:'PATCH'});
  let list=await (await f.admin('/api/admin/guests')).json();
  assert.equal(list.totals.invitations,5);assert.equal(list.totals.unsent,5);
  await f.send('/api/rsvp',{attendance:'yes',partySize:3,expectedVersion:1},{token:tokenFor(g)});
  list=await (await f.admin('/api/admin/guests')).json();
  assert.equal(list.totals.attending,3);assert.equal(list.totals.invitations,4);
  await f.send('/api/rsvp',{attendance:'no',partySize:0,expectedVersion:2},{token:tokenFor(g)});
  list=await (await f.admin('/api/admin/guests')).json();
  assert.equal(list.totals.declined,3);assert.equal(list.totals.invitations,4);assert.equal(list.totals.guests,0);
});

test('zero nights can be saved and negative nights are rejected',async()=>{
  const f=fixture(),g=await f.create();
  assert.deepEqual([g.rooms,g.nights,g.flightTickets],[0,0,0]);
  assert.equal((await f.admin('/api/admin/guests/'+g.id,{...g,nights:0,expectedVersion:0},{method:'PATCH'})).status,200);
  assert.equal((await f.admin('/api/admin/guests/'+g.id,{...g,nights:-1,expectedVersion:1},{method:'PATCH'})).status,400);
});

test('managed admin creates unsent invitations with stable encrypted private links and idempotent creation',async()=>{
  const f=fixture(),id=randomUUID();
  const guest=await f.create('陳伯伯一家',{id,locale:'zh-TW'});
  assert.equal(guest.status,'unsent');assert.equal(guest.partySize,1);assert.equal(guest.version,0);
  const token=tokenFor(guest);assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  const list=await (await f.admin('/api/admin/guests')).json();
  assert.equal(list.guests[0].privateUrl,guest.privateUrl);assert.equal(list.totals.unsent,1);
  assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM managed_guests').get()).includes(token),false);
  const retry=await f.admin('/api/admin/guests',{id,name:'陳伯伯一家',note:'只供新人看的安排',locale:'zh-TW'});
  assert.equal(retry.status,200);assert.equal((await retry.json()).guest.privateUrl,guest.privateUrl);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM invitations').get().n,1);
  assert.equal((await f.admin('/api/admin/guests',{id,name:'别人',locale:'zh-CN',note:''})).status,409);
});

test('managed private reply is name-bound and reveals no internal notes or other guests',async()=>{
  const f=fixture(),a=await f.create(),b=await f.create('李先生');
  const token=tokenFor(a),context=await (await f.send('/api/context',{}, {token})).json();
  assert.equal(context.managed,true);assert.equal(context.guest.name,'王叔叔一家');assert.equal(context.reply,null);
  assert.equal(JSON.stringify(context).includes('只供新人'),false);assert.equal(JSON.stringify(context).includes('李先生'),false);
  const response=await f.send('/api/rsvp',{attendance:'yes',partySize:3,expectedVersion:0,name:'冒名',note:'bad'},{token});
  assert.equal(response.status,200,await response.clone().text());
  const list=await (await f.admin('/api/admin/guests')).json();
  assert.equal(list.guests.find(g=>g.id===a.id).name,'王叔叔一家');
  assert.equal(list.guests.find(g=>g.id===a.id).partySize,3);assert.equal(list.guests.find(g=>g.id===a.id).updatedBy,'guest');
  assert.equal(list.guests.find(g=>g.id===b.id).status,'unsent');assert.equal(list.totals.guests,3);
});

test('admin edits and guest replies share revisions so stale saves cannot overwrite either editor',async()=>{
  const f=fixture(),g=await f.create(),token=tokenFor(g);
  const edit={name:'王叔叔与家人',note:'靠近入口',locale:'zh-TW',status:'yes',partySize:4,expectedVersion:0};
  assert.equal((await f.admin('/api/admin/guests/'+g.id,edit,{method:'PATCH'})).status,200);
  const context=await (await f.send('/api/context',{}, {token})).json();
  assert.equal(context.version,1);assert.equal(context.guest.name,'王叔叔与家人');assert.equal(context.reply.partySize,4);
  assert.equal((await f.send('/api/rsvp',{attendance:'no',partySize:0,expectedVersion:0},{token})).status,409);
  assert.equal((await f.send('/api/rsvp',{attendance:'no',partySize:0,expectedVersion:1},{token})).status,200);
  assert.equal((await f.admin('/api/admin/guests/'+g.id,edit,{method:'PATCH'})).status,409);
  const fresh=(await (await f.admin('/api/admin/guests')).json()).guests[0];
  assert.equal(fresh.status,'no');assert.equal(fresh.note,'靠近入口');assert.equal(fresh.version,2);
});

test('managed retries apply once and never undo newer changes, including simultaneous writes',async()=>{
  const f=fixture(),g=await f.create(),token=tokenFor(g),key=randomUUID();
  const body={attendance:'yes',partySize:2,expectedVersion:0};
  const pair=await Promise.all([f.send('/api/rsvp',body,{token,key}),f.send('/api/rsvp',body,{token,key})]);
  assert.deepEqual(pair.map(r=>r.status),[200,200]);
  assert.equal((await f.send('/api/rsvp',{attendance:'yes',partySize:3,expectedVersion:1},{token})).status,200);
  const replay=await f.send('/api/rsvp',body,{token,key});assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
  assert.equal((await f.send('/api/rsvp',{...body,partySize:4},{token,key})).status,409);
  const races=await Promise.all([2,4].map(partySize=>f.send('/api/rsvp',{attendance:'yes',partySize,expectedVersion:2},{token})));
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.sql.prepare('SELECT revision FROM managed_guests').get().revision,3);
});

test('managed endpoints validate totals, origins, tokens and protected production administration',async()=>{
  const f=fixture(),g=await f.create(),token=tokenFor(g);
  for(const body of [null,{}, {attendance:'yes',partySize:0,expectedVersion:0},{attendance:'yes',partySize:21,expectedVersion:0},{attendance:'yes',partySize:1.5,expectedVersion:0},{attendance:'no',partySize:1,expectedVersion:0},{attendance:'pending',partySize:0,expectedVersion:0}]) assert.equal((await f.send('/api/rsvp',body,{token})).status,400);
  assert.equal((await f.send('/api/context',{}, {token:'x'.repeat(43)})).status,401);
  assert.equal((await f.admin('/api/admin/guests',{id:randomUUID(),name:'a',locale:'zh-CN',note:''},{headers:{Origin:'https://evil.example'}})).status,403);
  for(const path of ['/guest-admin','/guest-admin/','/guest-admin.html','/api/admin/guests','/api/admin/guests/export','/api/admin/guests/'+g.id]) assert.equal((await f.send(path)).status,503,path);
  f.sql.prepare('UPDATE invitations SET revoked=1').run();
  assert.equal((await f.send('/api/context',{}, {token})).status,401);
});

test('local private links stay isolated instead of falling back to the shared preview invitation',async()=>{
  const f=fixture(),a=await f.create('甲'),b=await f.create('乙');
  for(const guest of [a,b]){
    const response=await f.send('/api/context',{}, {token:tokenFor(guest),local:true});
    assert.equal(response.status,200);assert.equal((await response.json()).guest.name,guest.name);
  }
});

test('managed export includes unsent rows and safely quotes notes and formula prefixes',async()=>{
  const f=fixture();await f.create('=1+1',{note:'a,"b"\nnext'});
  const response=await f.admin('/api/admin/guests/export');assert.equal(response.status,200);
  const csv=await response.text();assert.ok(csv.includes("'="));assert.ok(csv.includes('"a,""b""\nnext"'));assert.ok(csv.includes('未发出'));
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('new invitations start at one with category and automatic flight defaults, without counting pending as attending',async()=>{
  const f=fixture(),g=await f.create('同行者',{category:'新娘家人'});
  assert.equal(new URL(g.privateUrl).pathname,'/');
  assert.deepEqual([g.category,g.partySize,g.rooms,g.nights,g.flightTickets,g.flightTicketsAuto,g.address],['新娘家人',1,0,0,0,false,'']);
  assert.equal((await (await f.admin('/api/admin/guests')).json()).totals.guests,0);
  assert.equal((await f.admin('/api/admin/guests/'+g.id,{...g,status:'pending',partySize:2,expectedVersion:0},{method:'PATCH'})).status,200);
});

test('mailing fields persist separately and guests cannot overwrite admin logistics',async()=>{
  const f=fixture(),a=await f.create(),b=await f.create('其他宾客'),token=tokenFor(a);
  const edit={...a,rooms:2,nights:3,flightTickets:4,flightTicketsAuto:false,expectedVersion:0};
  assert.equal((await f.admin('/api/admin/guests/'+a.id,edit,{method:'PATCH'})).status,200);
  const mailing={recipient:'陈先生',phone:'+852 6123 4567',address:'香港九龍\n测试地址'};
  assert.equal((await f.send('/api/rsvp',{attendance:'yes',partySize:3,...mailing,rooms:9,nights:9,flightTickets:9,expectedVersion:1},{token})).status,200);
  let guest=(await (await f.admin('/api/admin/guests')).json()).guests.find(g=>g.id===a.id);
  assert.deepEqual([guest.recipient,guest.phone,guest.address,guest.rooms,guest.nights,guest.flightTickets],[mailing.recipient,mailing.phone,mailing.address,2,3,4]);
  const own=await (await f.send('/api/context',{}, {token})).json();assert.deepEqual(own.arrangements,mailing);
  const other=await (await f.send('/api/context',{}, {token:tokenFor(b)})).json();assert.equal(other.arrangements.phone,'');assert.equal(other.arrangements.recipient,'');
  assert.equal((await f.send('/api/rsvp',{attendance:'no',partySize:0,expectedVersion:2},{token})).status,200);
  guest=(await (await f.admin('/api/admin/guests')).json()).guests.find(g=>g.id===a.id);
  assert.deepEqual([guest.rooms,guest.nights,guest.flightTickets,guest.phone],[2,3,4,mailing.phone]);
  for(const extra of [{recipient:'字'.repeat(81)},{phone:'1'.repeat(61)},{phone:'123\n456'},{address:'字'.repeat(601)}])assert.equal((await f.send('/api/rsvp',{attendance:'yes',partySize:1,expectedVersion:3,...extra},{token})).status,400);
  const csv=await (await f.admin('/api/admin/guests/export')).text();assert.ok(csv.includes('收件人'));assert.ok(csv.includes('联络电话'));assert.ok(csv.includes(mailing.address));
});

test('deletion is revision guarded, excludes rows from exports and invalidates links until restored',async()=>{
  const f=fixture(),g=await f.create(),token=tokenFor(g),path='/api/admin/guests/'+g.id,key=randomUUID();
  assert.equal((await f.admin(path,{expectedVersion:1},{method:'DELETE'})).status,409);
  assert.equal((await f.admin(path,{expectedVersion:0},{method:'DELETE',key})).status,200);
  assert.equal((await f.admin(path,{expectedVersion:0},{method:'DELETE',key})).status,200);
  assert.equal((await (await f.admin('/api/admin/guests')).json()).guests.length,0);
  assert.equal((await (await f.admin('/api/admin/guests/export')).text()).includes(g.name),false);
  assert.equal((await f.send('/api/context',{}, {token})).status,401);
  assert.equal((await f.send('/api/rsvp',{attendance:'yes',partySize:1,expectedVersion:0},{token})).status,401);
  const trash=(await (await f.admin('/api/admin/guests?deleted=1')).json()).guests[0];assert.equal(trash.version,1);assert.ok(trash.deletedAt);
  assert.equal((await f.admin(path,{...g,status:'yes',partySize:1,expectedVersion:1},{method:'PATCH'})).status,409);
  assert.equal((await f.admin(path+'/restore',{expectedVersion:0})).status,409);
  assert.equal((await f.admin(path+'/restore',{expectedVersion:1})).status,200);
  assert.equal((await f.send('/api/context',{}, {token})).status,200);
  assert.equal((await (await f.admin('/api/admin/guests')).json()).guests[0].version,2);
});

test('migration preserves saved replies and private link material while pending people becomes one',()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).sort().filter(f=>f<'0006'))db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  for(const [id,status,count] of [['pending','pending',0],['yes','yes',4],['no','no',0]]){
    db.prepare('INSERT INTO invitations(token_hash,max_party_size,expires_at) VALUES (?,20,4102444800)').run(id);
    db.prepare("INSERT INTO managed_guests(id,invitation_hash,display_name,note,locale,attendance,party_size,revision,created_at,updated_at,link_cipher,create_hash) VALUES(?,?,?,'note','zh-TW',?,?,3,10,20,'cipher','createhash')").run(id,id,id,status,count);
  }
  db.exec(readFileSync(new URL('../migrations/0006_guest_logistics.sql',import.meta.url),'utf8'));
  assert.deepEqual(db.prepare('SELECT id,party_size FROM managed_guests ORDER BY id').all().map(r=>[r.id,r.party_size]),[['no',0],['pending',1],['yes',4]]);
  const row=db.prepare("SELECT * FROM managed_guests WHERE id='yes'").get();
  assert.deepEqual([row.revision,row.note,row.locale,row.link_cipher,row.create_hash,row.updated_at],[3,'note','zh-TW','cipher','createhash',20]);
});

test('simultaneous deletion and guest save cannot both apply or leave an active deleted link',async()=>{
  const f=fixture(),g=await f.create(),token=tokenFor(g);
  const outcomes=await Promise.all([f.admin('/api/admin/guests/'+g.id,{expectedVersion:0},{method:'DELETE'}),f.send('/api/rsvp',{attendance:'yes',partySize:2,expectedVersion:0},{token})]);
  assert.equal(outcomes.filter(r=>r.status===200).length,1);
  const row=f.sql.prepare('SELECT * FROM managed_guests').get();assert.equal(row.revision,1);
  if(row.deleted_at!==null){assert.equal(f.sql.prepare('SELECT revoked FROM invitations').get().revoked,1);assert.equal((await f.send('/api/context',{}, {token})).status,401);}
});

test('a conflicting deletion cannot revoke an edit that won using the same request key',{timeout:5000},async()=>{
  let reachedDeletion,releaseDeletion;
  const deletionReady=new Promise(resolve=>{reachedDeletion=resolve;});
  const continueDeletion=new Promise(resolve=>{releaseDeletion=resolve;});
  const f=fixture({async beforeBatch(statements){
    if(statements.some(({query})=>/UPDATE\s+invitations\s+SET\s+revoked\s*=/.test(query))){
      // DELETE has already read an empty idempotency record. Let PATCH commit first.
      reachedDeletion();await continueDeletion;
    }
  }}),g=await f.create(),key=randomUUID(),path='/api/admin/guests/'+g.id;
  const deletion=f.admin(path,{expectedVersion:0},{method:'DELETE',key});
  await deletionReady;
  let edited;
  try{edited=await f.admin(path,{...g,status:'yes',partySize:2,expectedVersion:0},{method:'PATCH',key});}
  finally{releaseDeletion();}
  const deleted=await deletion;
  assert.equal(edited.status,200);
  assert.equal(deleted.status,409);
  assert.equal((await deleted.json()).error,'idempotency_conflict');
  const row=f.sql.prepare('SELECT deleted_at,attendance,party_size,revision FROM managed_guests').get();
  assert.deepEqual([row.deleted_at,row.attendance,row.party_size,row.revision],[null,'yes',2,1]);
  assert.equal(f.sql.prepare('SELECT revoked FROM invitations').get().revoked,0,'the rejected deletion must not revoke the winning edit');
  assert.equal((await f.send('/api/context',{}, {token:tokenFor(g)})).status,200);
});
