export async function initManagedRsvp(token) {
  const panel=document.querySelector('#rsvp .rsvp-panel');
  const messages={invalid_invitation:'这份邀请已失效。请使用新人发送的私人链接，或联系新人。',version_conflict:'新人或另一页面已更新安排，请先载入最新回复。',idempotency_conflict:'请载入最新回复，再确认你的安排。',invalid_fields:'请检查人数、收件人、联络电话和地址。',rate_limited:'回复较频繁，请一分钟后再试。'};
  async function request(path,body,key){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(messages[data.error]||'连接暂不可用，请稍后重试。'),{code:data.error});return data;
  }
  let initial,initialError;
  try{initial=await request('/api/context',{});if(!initial.managed)return false;}catch(error){initialError=error;}
  panel.classList.add('managed-panel');
  panel.innerHTML=`<h3 id="greeting" class="managed-greeting">诚邀你赴约</h3><p id="reply-status" class="connection-status" role="status">正在读取邀请…</p>
  <form id="reply-form" novalidate><fieldset id="reply-fields" disabled><legend class="field-label">你会来参加吗？</legend>
  <div class="attendance-options"><label><input type="radio" name="attendance" value="yes"><span>出席</span></label><label><input type="radio" name="attendance" value="no"><span>不出席</span></label></div>
  <div id="reply-count-wrap" hidden><label class="field-label" for="reply-count">出席人数</label><div class="party-control"><button type="button" id="count-down" aria-label="减少人数">−</button><input id="reply-count" type="number" min="1" max="20" value="1" inputmode="numeric"><button type="button" id="count-up" aria-label="增加人数">+</button></div><p class="field-hint">请包含你本人</p>
  </div>
  <details class="mailing-details"><summary>想收到一份纸质请帖？（选填）</summary><p class="field-hint">愿把这份喜悦寄到你手中。请留下收件人、联络电话、详细地址及邮编，供我们寄出精致的纸质请帖。</p><label class="field-label" for="reply-recipient">收件人</label><input id="reply-recipient" type="text" maxlength="80" autocomplete="shipping name" placeholder="收件人姓名"><label class="field-label" for="reply-phone">联络电话</label><input id="reply-phone" type="tel" maxlength="60" autocomplete="shipping tel" placeholder="请包含国家或地区区号"><label class="field-label" for="reply-address">纸质请帖收件地址（选填）</label><textarea id="reply-address" rows="3" maxlength="600" autocomplete="street-address" placeholder="国家或地区、详细地址及邮编"></textarea></details>
  <p class="privacy-note">回复与收件信息仅供新人安排本次婚礼和寄送请帖。再次打开这条私人链接，即可查看和修改你的回复。</p><button id="reply-submit" class="primary-button" type="submit">确认回复</button></fieldset></form>
  <div id="reply-feedback" class="form-feedback" role="status" tabindex="-1" hidden></div><button id="reply-reload" class="text-button" type="button" hidden>载入最新回复</button><button id="reply-retry" class="text-button" type="button" hidden>重新连接</button>`;
  const $=s=>panel.querySelector(s),form=$('#reply-form'),fields=$('#reply-fields');
  let ready=false,busy=false,version=0,max=20,pending=null,hasReply=false;
  const counts=()=>{const yes=form.querySelector('input[name=attendance]:checked')?.value==='yes';$('#reply-count-wrap').hidden=!yes;$('#count-down').disabled=Number($('#reply-count').value)<=1;$('#count-up').disabled=Number($('#reply-count').value)>=max;};
  function apply(data){
    if(!data.managed||!Number.isInteger(data.version))throw new Error(messages.invalid_invitation);
    $('#greeting').textContent=data.guest.name+'，期待与你相见';version=data.version;max=data.maxPartySize;hasReply=!!data.reply;pending=null;
    for(const radio of form.querySelectorAll('input[name=attendance]'))radio.checked=data.reply?.attendance===radio.value;
    $('#reply-count').value=String(data.partySize||1);$('#reply-count').max=String(max);
    for(const key of ['recipient','phone','address'])$('#reply-'+key).value=data.arrangements[key]||'';
    if(Object.values(data.arrangements).some(Boolean))panel.querySelector('.mailing-details').open=true;
    $('#reply-status').textContent=data.preview?'本机预览 · 测试回复仅保存在此电脑。':hasReply?'已载入你的回复，可在下方调整。':'这是你的专属邀请，请告诉我们你的赴约安排。';
    $('#reply-submit').textContent=hasReply?'更新回复':'确认回复';ready=true;fields.disabled=false;counts();
  }
  async function connect(){ready=false;fields.disabled=true;$('#reply-retry').hidden=true;$('#reply-reload').hidden=true;try{apply(await request('/api/context',{}));return true;}catch(error){$('#reply-status').textContent=error.message;$('#reply-retry').hidden=false;return false;}}
  function feedback(text,error=false){$('#reply-feedback').textContent=text;$('#reply-feedback').hidden=false;$('#reply-feedback').classList.toggle('error',error);$('#reply-feedback').dataset.saved=String(!error);$('#reply-feedback').focus({preventScroll:true});}
  for(const [id,delta] of [['count-down',-1],['count-up',1]])$('#'+id).addEventListener('click',()=>{$('#reply-count').value=String(Math.max(1,Math.min(max,(Number($('#reply-count').value)||1)+delta)));counts();$('#reply-feedback').hidden=true;});
  form.addEventListener('input',()=>{$('#reply-feedback').hidden=true;counts();});form.addEventListener('change',counts);
  $('#reply-retry').addEventListener('click',connect);$('#reply-reload').addEventListener('click',()=>{$('#reply-feedback').hidden=true;connect();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!ready||busy)return;
    const attendance=form.querySelector('input[name=attendance]:checked')?.value,partySize=attendance==='yes'?Number($('#reply-count').value):0;
    if(!attendance){feedback('请选择出席或不出席。',true);return;}
    if(attendance==='yes'&&(!Number.isInteger(partySize)||partySize<1||partySize>max)){feedback('请填写 1–20 位出席人数。',true);return;}
    const body={attendance,partySize,recipient:$('#reply-recipient').value,phone:$('#reply-phone').value,address:$('#reply-address').value,expectedVersion:version},signature=JSON.stringify(body);
    if(!pending||pending.signature!==signature)pending={signature,key:crypto.randomUUID()};
    busy=true;fields.disabled=true;$('#reply-submit').textContent='正在保存…';$('#reply-reload').hidden=true;
    try{const data=await request('/api/rsvp',body,pending.key);version=data.version;pending=null;hasReply=true;
      if(data.replayed){if(await connect())feedback('已确认回复保存成功，并载入最新安排。');else feedback('此前的回复已保存，请重新连接后确认最新安排。',true);}
      else feedback(attendance==='yes'?`回复已保存：${partySize} 位出席。期待与你相见！`:'回复已保存，谢谢你的心意。安排有变时可通过原链接修改。');
    }catch(error){feedback(error.message||'暂时未能确认保存，请检查网络后重试。',true);if(['version_conflict','idempotency_conflict'].includes(error.code)){pending=null;$('#reply-reload').hidden=false;}}
    finally{busy=false;fields.disabled=!ready;$('#reply-submit').textContent=hasReply?'更新回复':'确认回复';counts();}
  });
  if(initial)apply(initial);else{$('#reply-status').textContent=initialError.message;$('#reply-retry').hidden=false;}
  return true;
}
