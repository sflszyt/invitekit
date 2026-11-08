const $=selector=>document.querySelector(selector);
const states=new Map(),status=$('#admin-status');
let loadSequence=0,creating=false,creationQueue=null;
const messages={invalid_fields:'请检查姓名、分类及人数。未发出、待回复、大概率出席或出席为 1–20 人，不出席为 0；住宿 0–20 间、0–30 夜，机票 0–20 张。',invalid_version:'请载入最新记录后重试。',version_conflict:'这行已有新回复。你的修改已保留，请载入最新记录后再调整。',idempotency_conflict:'这次操作的内容已变化，请载入最新记录。',rate_limited:'操作较频繁，请稍后重试。',invalid_origin:'请从原后台地址重新打开。',unavailable:'连接中断或后台未配置，请重试。',payload_too_large:'输入内容过长，请缩短备注。'};
async function api(path,{method='GET',body,key}={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(path,{method,cache:'no-store',credentials:'same-origin',signal:controller.signal,headers:body?{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})}:{},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(response.status===401||response.status===403?'管理会话已失效，请重新登录后台。':messages[data.error]||'后台暂不可用，请重试。');error.code=data.error;throw error;}return data;
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw new Error('连接中断，未能确认是否保存。重试不会重复添加或重复计数。');throw error;}finally{clearTimeout(timeout);}
}
function feedback(state,text,conflict=false){state.row.querySelector('[data-feedback]').textContent=text;state.row.classList.toggle('has-conflict',conflict);}
function values(state){const data={};for(const input of state.row.querySelectorAll('[data-field]'))data[input.dataset.field]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;data.flightTicketsAuto=state.flightAuto;return data;}
function render(guest,existing){
  const row=existing?.row||$('#guest-row-template').content.firstElementChild.cloneNode(true),state=existing||{row};
  clearTimeout(state.autosaveTimer);
  Object.assign(state,{base:guest,latest:guest,flightAuto:guest.flightTicketsAuto,dirty:false,saving:false,pending:null});row.dataset.id=guest.id;row.classList.remove('is-dirty','has-conflict');
  for(const input of row.querySelectorAll('[data-field]')){if(input.type==='checkbox')input.checked=guest[input.dataset.field];else input.value=String(guest[input.dataset.field]);if(input.dataset.field==='name')input.defaultValue=guest.name;input.disabled=false;}
  row.querySelector('[data-field=partySize]').disabled=guest.status==='no';row.querySelector('[data-field=status]').dataset.status=guest.status;
  row.querySelector('[data-action=open]').href=guest.privateUrl;
  row.querySelector('[data-updated]').textContent=(guest.status==='unsent'?'邀请未发出':guest.version===0?'等待宾客回复':guest.updatedBy==='guest'?'宾客回复':'后台修改')+'\n'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(guest.updatedAt*1000));
  const deleted=!!guest.deletedAt;row.querySelector('[data-action=retry]').hidden=true;row.querySelector('[data-action=delete]').hidden=deleted;row.querySelector('[data-action=restore]').hidden=!deleted;row.querySelector('[data-action=copy]').hidden=deleted;row.querySelector('[data-action=open]').hidden=deleted;for(const input of row.querySelectorAll('[data-field]'))if(deleted)input.disabled=true;
  row.querySelector('[data-action=retry]').disabled=true;row.querySelector('[data-action=reset]').hidden=true;feedback(state,'');
  if(!existing){
    row.addEventListener('input',event=>{if(event.target.dataset.field==='flightTickets')state.flightAuto=false;syncFlights(state);markDirty(state);});
    row.addEventListener('change',event=>{if(event.target.dataset.field==='status'){const count=row.querySelector('[data-field=partySize]');count.disabled=event.target.value==='no';if(count.disabled)count.value='0';else if(Number(count.value)<1)count.value='1';event.target.dataset.status=event.target.value;}syncFlights(state);markDirty(state);});
    row.querySelector('[data-action=delete]').addEventListener('click',()=>{deletingState=state;$('#delete-name').textContent=state.base.name;$('#delete-feedback').textContent='';$('#delete-dialog').showModal();});
    row.querySelector('[data-action=restore]').addEventListener('click',()=>restore(state));
    row.querySelector('[data-action=retry]').addEventListener('click',()=>save(state));
    row.querySelector('[data-action=reset]').addEventListener('click',async()=>{if(row.querySelector('[data-action=reset]').textContent==='载入最新'&&!await load())return;render(state.latest,state);applyFilter();});
    row.querySelector('[data-action=copy]').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.latest.privateUrl);markCopied(state);const button=row.querySelector('[data-action=copy]');button.textContent='已复制';setTimeout(()=>button.textContent='复制链接',1800);}catch{const input=row.querySelector('[data-link-fallback]');input.hidden=false;input.value=state.latest.privateUrl;input.focus();input.select();feedback(state,'请复制已选中的链接。');}});
    row.querySelector('[data-link-fallback]').addEventListener('copy',event=>{if(event.isTrusted)setTimeout(()=>markCopied(state),0);});
    states.set(guest.id,state);$('#guest-rows').append(row);
  }return state;
}
function markCopied(state){
  if(state.saving){state.copiedWhileSaving=true;return;}
  const input=state.row.querySelector('[data-field=status]');
  if(input.value!=='unsent')return;
  if(state.latest.version!==state.base.version){feedback(state,'链接已复制；记录已有更新，请载入最新后确认发出状态。',true);return;}
  input.value='pending';input.dataset.status='pending';markDirty(state);save(state);
}
function markDirty(state){state.dirty=true;state.row.classList.add('is-dirty');clearTimeout(state.autosaveTimer);state.row.querySelector('[data-action=retry]').hidden=true;const reset=state.row.querySelector('[data-action=reset]');reset.hidden=false;reset.textContent=state.latest.version!==state.base.version?'载入最新':'撤销';feedback(state,state.latest.version!==state.base.version?'收到新回复；你的修改仍保留。':'等待自动保存…',state.latest.version!==state.base.version);if(state.latest.version===state.base.version)state.autosaveTimer=setTimeout(()=>save(state),800);}
async function save(state){
  clearTimeout(state.autosaveTimer);if(state.saving||!state.dirty||!state.row.isConnected)return;
  const data={...values(state),expectedVersion:state.base.version};
  if([...state.row.querySelectorAll('[data-field]')].some(input=>!input.checkValidity()||(input.type==='number'&&input.value===''))){feedback(state,'未自动保存：请检查输入值。',true);return;}
  if(!data.name.trim()||!Number.isInteger(data.partySize)||data.partySize<0||data.partySize>20||(data.status==='no'?data.partySize!==0:data.partySize<1)){feedback(state,messages.invalid_fields,true);return;}
  const signature=JSON.stringify(data);if(!state.pending||state.pending.signature!==signature)state.pending={signature,key:crypto.randomUUID()};
  state.saving=true;for(const input of state.row.querySelectorAll('[data-field],[data-action=retry],[data-action=reset],[data-action=copy]'))input.disabled=true;feedback(state,'自动保存中…');
  try{
    const result=await api('/api/admin/guests/'+state.base.id,{method:'PATCH',body:data,key:state.pending.key});render({...state.base,...data,version:result.version,updatedBy:'admin',updatedAt:Math.floor(Date.now()/1000)},state);
    feedback(state,'已自动保存');load();
  }catch(error){state.saving=false;state.row.querySelector('[data-action=retry]').hidden=false;feedback(state,'自动保存失败：'+error.message,true);if(['version_conflict','idempotency_conflict'].includes(error.code)){state.pending=null;state.row.querySelector('[data-action=retry]').hidden=true;await load();const reset=state.row.querySelector('[data-action=reset]');reset.hidden=false;reset.textContent='载入最新';}}
  finally{state.saving=false;for(const input of state.row.querySelectorAll('[data-field],[data-action=reset],[data-action=copy]'))input.disabled=false;state.row.querySelector('[data-field=partySize]').disabled=state.row.querySelector('[data-field=status]').value==='no';state.row.querySelector('[data-action=retry]').disabled=!state.dirty;if(state.copiedWhileSaving){state.copiedWhileSaving=false;markCopied(state);}}
}
function applyFilter(){
  const query=$('#guest-search').value.trim().toLocaleLowerCase(),filter=$('#status-filter').value;let count=0;
  for(const state of states.values()){const data=values(state),category=$('#category-filter').value,match=(category==='all'||data.category===category)&&(!query||(data.name+' '+data.note).toLocaleLowerCase().includes(query))&&(filter==='all'||data.status===filter);const visible=(category==='all'||data.category===category)&&(match||state.dirty||state.saving);state.row.hidden=!visible;if(visible)count++;}
  $('#visible-count').textContent=`显示 ${count} / ${states.size} 份邀请`;$('#empty-state').hidden=states.size>0;$('#no-matches').hidden=states.size===0||count>0;
  const totals={invitations:0,unsent:0,pending:0,likely:0,attending:0,declined:0,guests:0,rooms:0,flights:0},category=$('#category-filter').value;
  for(const state of states.values()){
    const g=state.latest;
    if(g.deletedAt||(category!=='all'&&g.category!==category)||(filter!=='all'&&g.status!==filter)||(query&&!(g.name+' '+g.note).toLocaleLowerCase().includes(query)))continue;
    totals.invitations+=g.invitedSize;
    if(g.status==='unsent')totals.unsent+=g.partySize;
    else if(g.status==='pending')totals.pending+=g.partySize;
    else if(g.status==='likely')totals.likely+=g.partySize;
    else if(g.status==='no')totals.declined+=g.invitedSize;
    else if(g.status==='yes'){totals.attending+=g.partySize;totals.guests+=g.partySize;totals.rooms+=g.rooms;totals.flights+=g.flightTickets;}
  }
  for(const [key,value] of Object.entries(totals))$('#total-'+key).textContent=String(value);
}
async function load(){
  const sequence=++loadSequence;$('#refresh').disabled=true;
  try{
    const data=await api('/api/admin/guests'+($('#view-filter').value==='deleted'?'?deleted=1':''));if(sequence!==loadSequence)return false;
    const ids=new Set(data.guests.map(g=>g.id));for(const [id,state] of states){if(!ids.has(id)){state.row.remove();states.delete(id);}}
    $('.desk-metrics').hidden=$('#view-filter').value==='deleted';
    for(const guest of data.guests){const state=states.get(guest.id);if(!state)render(guest);else{state.latest=guest;
      const editing=state.row.contains(document.activeElement)&&document.activeElement.matches('[data-field]');
      if(state.dirty||state.saving||editing){if(state.dirty&&guest.version!==state.base.version){state.row.querySelector('[data-action=reset]').textContent='载入最新';feedback(state,'这行已有新回复，你的修改已保留。',true);}}
      else if(guest.version!==state.base.version)render(guest,state);
    }}
    status.textContent=data.preview?'本机预览 · 这里生成的链接仅此电脑可用。正式上线后即可私聊发送给宾客。':'私人后台 · 名单与备注仅管理员可见。';status.classList.remove('error');$('#sync-time').textContent='已同步 '+new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
    $('#admin-data').hidden=false;$('#add-guest').disabled=false;applyFilter();return true;
  }catch(error){if(sequence===loadSequence){status.textContent=error.message;status.classList.add('error');}return false;}
  finally{if(sequence===loadSequence)$('#refresh').disabled=false;}
}
async function loadLegacy(){try{const data=await api('/api/admin/rsvps');if(!data.replies.length)return;$('#legacy-section').hidden=false;for(const key of ['adults','children','guests'])$('#'+key+'-total').textContent=String(data.totals[key]);for(const reply of data.replies){const row=document.createElement('tr');for(const value of [reply.name,reply.attendance==='yes'?'出席':'不出席',reply.adultCount,reply.childCount,reply.partySize]){const td=document.createElement('td');td.textContent=String(value);row.append(td);}$('#replies-body').append(row);}}catch{/* Current guest desk errors are displayed by load(). */}}
$('#guest-search').addEventListener('input',applyFilter);$('#status-filter').addEventListener('change',applyFilter);$('#category-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(!button)return;$('#category-filter').value=button.dataset.category;for(const tab of $('#category-tabs').querySelectorAll('button'))tab.setAttribute('aria-pressed',String(tab===button));applyFilter();});$('#view-filter').addEventListener('change',load);$('#refresh').addEventListener('click',load);
const finishAdd=document.createElement('button');finishAdd.type='button';finishAdd.className='desk-button';finishAdd.textContent='结束本次添加';finishAdd.hidden=true;$('#close-add').before(finishAdd);
finishAdd.addEventListener('click',()=>{if(creating)return;creationQueue=null;$('#new-names').value='';$('#new-names').readOnly=false;$('#new-category').disabled=false;$('#create-guests').textContent='添加到名单';$('#close-add').textContent='取消';$('#add-feedback').textContent='';finishAdd.hidden=true;$('#add-dialog').close();load();});
$('#add-guest').addEventListener('click',()=>{$('#add-dialog').showModal();$('#new-names').focus();});$('#close-add').addEventListener('click',()=>{if(!creating)$('#add-dialog').close();});$('#add-dialog').addEventListener('cancel',event=>{if(creating)event.preventDefault();});
$('#add-form').addEventListener('submit',async event=>{
  event.preventDefault();if(creating)return;
  if(!creationQueue){const names=$('#new-names').value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean);if(!names.length||names.length>100||names.some(name=>Array.from(name).length>80||/[\u0000-\u001f\u007f]/u.test(name))){$('#add-feedback').textContent='请只粘贴姓名这一列，一次 1–100 行，每行最多 80 个字符。';return;}creationQueue=names.map(name=>({id:crypto.randomUUID(),name,note:'',category:$('#new-category').value}));}
  creating=true;$('#create-guests').disabled=true;$('#close-add').disabled=true;$('#new-names').readOnly=true;$('#new-category').disabled=true;
  try{while(creationQueue.length){$('#add-feedback').textContent=`正在添加，还剩 ${creationQueue.length} 行…`;await api('/api/admin/guests',{method:'POST',body:creationQueue[0]});creationQueue.shift();}creationQueue=null;$('#new-names').value='';$('#new-names').readOnly=false;$('#new-category').disabled=false;$('#add-feedback').textContent='';$('#add-dialog').close();await load();}
  catch(error){$('#add-feedback').textContent=error.message+` 还剩 ${creationQueue.length} 行。已添加的记录会保留，请先核对名单。`;if(['invalid_fields','invalid_json','payload_too_large'].includes(error.code)){$('#new-names').value=creationQueue.map(item=>item.name).join('\n');creationQueue=null;$('#new-names').readOnly=false;$('#new-category').disabled=false;}else{$('#create-guests').textContent='继续添加';$('#close-add').textContent='稍后继续';finishAdd.hidden=false;}await load();}
  finally{creating=false;$('#create-guests').disabled=false;$('#close-add').disabled=false;if(!creationQueue){$('#create-guests').textContent='添加到名单';$('#close-add').textContent='取消';finishAdd.hidden=true;}}
});
window.addEventListener('beforeunload',event=>{if(creating||creationQueue||[...states.values()].some(state=>state.dirty)){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});setInterval(()=>{if(!document.hidden&&!creating)load();},15000);
setupColumnResize();load();loadLegacy();

function setupColumnResize(){
  const table=$('.guest-table'),headers=[...table.querySelectorAll('th')],key='wedding-admin-column-widths-v1';
  let widths=null;
  const apply=()=>{table.classList.add('custom-widths');table.style.width=widths.reduce((a,b)=>a+b,0)+'px';headers.forEach((th,i)=>th.style.width=widths[i]+'px');};
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(widths));}catch{}};
  try{const saved=JSON.parse(localStorage.getItem(key));if(Array.isArray(saved)&&saved.length===headers.length&&saved.every(n=>Number.isFinite(n)&&n>=36&&n<=800)){widths=saved;apply();}}catch{}
  const initialize=()=>{if(!widths)widths=headers.map(th=>Math.max(36,th.getBoundingClientRect().width));};
  for(const [i,th] of headers.entries()){
    const handle=document.createElement('button');handle.type='button';handle.className='column-resizer';handle.setAttribute('aria-label','调整'+th.textContent+'列宽');handle.title='拖动调整列宽；方向键微调';th.append(handle);
    handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();initialize();apply();const start=event.clientX,original=widths[i];handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing-columns');
      const move=e=>{widths[i]=Math.min(800,Math.max(36,original+e.clientX-start));apply();};
      const finish=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);document.body.classList.remove('resizing-columns');persist();};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
    });
    handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();initialize();widths[i]=Math.min(800,Math.max(36,widths[i]+(event.key==='ArrowRight'?10:-10)));apply();persist();});
  }
  const reset=document.createElement('button');reset.type='button';reset.className='reset-columns';reset.textContent='重置列宽';reset.addEventListener('click',()=>{widths=null;table.classList.remove('custom-widths');table.style.width='';headers.forEach(th=>th.style.width='');try{localStorage.removeItem(key);}catch{}});$('.table-note').firstElementChild.append(' · 拖动表头右边缘调整列宽 ',reset);
}

function syncFlights(state){if(state.flightAuto)state.row.querySelector('[data-field=flightTickets]').value=state.row.querySelector('[data-field=partySize]').value;}
let deletingState=null,deleting=false;
$('#cancel-delete').addEventListener('click',()=>{if(!deleting)$('#delete-dialog').close();});
$('#delete-dialog').addEventListener('cancel',event=>{if(deleting)event.preventDefault();});
$('#confirm-delete').addEventListener('click',async()=>{if(!deletingState||deleting)return;deleting=true;$('#confirm-delete').disabled=true;$('#cancel-delete').disabled=true;try{const state=deletingState;if(state.deleteVersion!==state.base.version){state.deleteVersion=state.base.version;state.deleteKey=crypto.randomUUID();}await api('/api/admin/guests/'+state.base.id,{method:'DELETE',body:{expectedVersion:state.base.version},key:state.deleteKey});state.dirty=false;$('#delete-dialog').close();await load();}catch(error){$('#delete-feedback').textContent=error.message;}finally{deleting=false;$('#confirm-delete').disabled=false;$('#cancel-delete').disabled=false;}});
async function restore(state){if(state.saving)return;state.saving=true;const button=state.row.querySelector('[data-action=restore]');button.disabled=true;try{if(state.restoreVersion!==state.base.version){state.restoreVersion=state.base.version;state.restoreKey=crypto.randomUUID();}await api('/api/admin/guests/'+state.base.id+'/restore',{method:'POST',body:{expectedVersion:state.base.version},key:state.restoreKey});await load();}catch(error){feedback(state,error.message,true);}finally{state.saving=false;button.disabled=false;}}
