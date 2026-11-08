// Disposable loopback workerd + real D1 + actual Workers Static Assets routing.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
const root=resolve('.'), id=randomUUID(), dir=resolve('.test-state',id);
const temp=resolve(dir,'tmp');mkdirSync(temp,{recursive:true});
const server=new Miniflare(convertV4MiniflareOptions({
  name:'wedding-isolated-browser-test',rootPath:dir,script:readFileSync('src/worker.mjs','utf8'),modules:true,
  compatibilityDate:'2026-10-08',host:'127.0.0.1',port:0,inspectorHost:'127.0.0.1',cf:false,
  telemetry:{enabled:false},unsafeRegisterWorker:false,unsafeDevRegistryPath:resolve(dir,'registry'),
  resourcePersistencePath:resolve(dir,'persistence'),isolatedResourcePersistencePath:resolve(dir,'persistence'),resourceTmpPath:temp,
  cacheAPI:false,bindings:{ENVIRONMENT:'local',RSVP_ENABLED:'true'},d1Databases:{DB:'test-'+id},
  assets:{directory:resolve('public'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
  outboundService:()=>{throw new Error('No outbound traffic in browser tests');},log:new Log(LogLevel.ERROR),logRequests:false
}));
try{
  const url=(await server.ready).origin;
  const assetProbe=await fetch(url+'/');
  if(assetProbe.status!==200)throw new Error('Actual assets probe: '+assetProbe.status+' '+await assetProbe.text());
  const db=await server.getD1Database('DB');
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()){
    const statements=readFileSync(resolve('migrations',file),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
    await db.batch(statements.map(s=>db.prepare(s)));
  }
  writeFileSync(resolve(dir,'test-run.json'),JSON.stringify({id,url,purpose:'disposable isolated browser test'}));
  console.log('Isolated browser test server: '+url);
  const verifier=process.argv.includes('--guest-desk')?'scripts/verify-guest-desk.mjs':'scripts/verify-browser.mjs';
  await new Promise((ok,no)=>{const p=spawn(process.execPath,[resolve(verifier)],{cwd:root,env:{...process.env,QA_BASE_URL:url,QA_STATE_DIR:dir,QA_RUN_ID:id},stdio:'inherit',windowsHide:true});p.once('error',no);p.once('exit',c=>c===0?ok():no(new Error(`Browser verification exited ${c}`)));});
}finally{await server.dispose();}
