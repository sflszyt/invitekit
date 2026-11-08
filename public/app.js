import { wedding } from './content.js';
import { initMusic } from './music.js';
initMusic(wedding.music);
const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const setText = (selector, value) => all(selector).forEach(el => { el.textContent = value ?? ''; });
const setOptional = (selector, value) => all(selector).forEach(el => {
  el.textContent = value || '';
  el.hidden = !value;
});
const names = wedding.names.join(' & ');
const initials = wedding.names.map(name => Array.from(name.trim())[0] || '').join(' & ');
setText('[data-name="0"]', wedding.names[0]);
setText('[data-name="1"]', wedding.names[1]);
setText('[data-monogram]', initials);
setText('[data-venue]', wedding.venue);
setText('[data-venue-en]', wedding.venueEnglish || wedding.venue);
setText('[data-insert-venue]', wedding.venueTraditional || wedding.venue);
setText('[data-groom-chinese]', wedding.groomChinese);
setText('[data-bride-chinese]', wedding.brideChinese);
for (const key of ['introduction', 'closing']) setText(`[data-${key}]`, wedding[key]);
setOptional('[data-hall-en]', wedding.hallEnglish || wedding.hall);
setOptional('[data-address-en]', wedding.streetAddressEnglish || wedding.streetAddress);
setOptional('#venue-address', [wedding.hall, wedding.streetAddress].filter(Boolean).join(' · '));
for (const image of all('[data-photo]')) {
  const photo = wedding.photos?.[image.dataset.photo];
  image.hidden = !photo?.src;
  image.removeAttribute('srcset');
  image.removeAttribute('sizes');
  if (!photo?.src) {
    image.removeAttribute('src');
    image.alt = '';
    continue;
  }
  if (photo.sizes) image.sizes = photo.sizes;
  if (photo.srcset) image.srcset = photo.srcset;
  image.src = photo.src;
  image.alt = photo.alt || '';
  image.style.objectPosition = photo.position || 'center';
}
for (const caption of all('[data-photo-credit]')) {
  const photo = wedding.photos?.[caption.dataset.photoCredit];
  const credit = [photo?.location, photo?.photographer].filter(Boolean).join(' · ');
  caption.textContent = credit;
  caption.hidden = !credit;
}
// wedding.date is a civil date at the venue, not an instant in the browser's
// zone. UTC keeps its day stable even when the visitor or venue changes zones.
const [year, month, day] = wedding.date.split('-');
const date = new Date(`${wedding.date}T12:00:00Z`);
const options = { timeZone: 'UTC' };
const formatDate = (locale, fields) => new Intl.DateTimeFormat(locale, { ...options, ...fields }).format(date);
const zhDate = formatDate('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const weekday = formatDate('zh-CN', { weekday: 'long' });
const cityEnglish = wedding.cityEnglish || wedding.city;
setText('[data-date-short]', `${day}.${month}.${year}`);
setText('[data-date-zh]', `${zhDate} · ${weekday}`);
setText('[data-book-date]', formatDate('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase());
setText('[data-book-weekday]', `${formatDate('en-GB', { weekday: 'long' }).toUpperCase()} · ${cityEnglish.toUpperCase()}`);
setText('[data-side-note]', `${cityEnglish.toUpperCase()} / ${year}`);
setText('[data-footer-city]', `${wedding.city} · ${year}`);
setText('[data-footer-love]', `WITH LOVE, ${initials}`);
setText('[data-book-hint]', `WITH LOVE, ${names.toUpperCase()}`);
$('.monogram').setAttribute('aria-label', wedding.names.join(' 与 ') + ' 请柬首页');
$('[data-book-cover]').setAttribute('aria-label', '打开 ' + wedding.names.join(' 与 ') + ' 的婚礼请帖');
document.title = names;
$('meta[name="description"]').content = `${names} · ${zhDate} · ${wedding.venue}婚礼请柬`;
const zoneName = locale => {
  if (!wedding.timeZone) return '';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: wedding.timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(date).find(part => part.type === 'timeZoneName')?.value || wedding.timeZone;
  } catch { return wedding.timeZone; }
};
const ceremony = locale => wedding.ceremonyTime ? [wedding.ceremonyTime, zoneName(locale)].filter(Boolean).join(' · ') : '';
setOptional('[data-ceremony-summary]', ceremony('zh-CN'));
setOptional('[data-ceremony-en]', ceremony('en-GB'));
const hanDigits = '〇一二三四五六七八九';
const hanNumber = value => {
  const number = Number(value);
  if (number < 10) return hanDigits[number];
  return (number < 20 ? '' : hanDigits[Math.floor(number / 10)]) + '十' + (number % 10 ? hanDigits[number % 10] : '');
};
setText('[data-insert-solar]', '公曆' + [...year].map(n => hanDigits[Number(n)]).join('') + '年' + hanNumber(month) + '月' + hanNumber(day) + '日');
setText('[data-insert-weekday]', weekday);
const ceremonyClock = wedding.ceremonyTime?.match(/^(\d{1,2}):(\d{2})$/);
setOptional('[data-insert-time]', ceremonyClock ? '恭候' + hanNumber(ceremonyClock[1]) + '時' + (Number(ceremonyClock[2]) ? hanNumber(ceremonyClock[2]) + '分' : '正') : '');
// Clear the fallback before conversion so unsupported calendars never retain
// the example's lunar date after the configured wedding date changes.
setOptional('[data-insert-lunar]', '');
try {
  const formatter = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', { ...options, year: 'numeric', month: 'long', day: 'numeric' });
  if (formatter.resolvedOptions().calendar === 'chinese') {
    const lunar = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    const numericDay = Number(lunar.day);
    const lunarDay = Number.isInteger(numericDay) && numericDay >= 1 && numericDay <= 30
      ? hanNumber(numericDay)
      : /^(?:初[一二三四五六七八九十]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|廿[一二三四五六七八九]?|三十)$/.test(lunar.day || '') ? lunar.day : null;
    if (lunar.yearName && lunar.month && lunarDay) setOptional('[data-insert-lunar]', '農曆' + lunar.yearName + '年' + lunar.month + lunarDay);
  }
} catch { /* The configured solar date remains readable on older engines. */ }

// Motion is progressive enhancement: normal document scrolling and readable HTML always work.
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const motionTargets=all('.reveal,.hero-image [data-photo],#hero-title');
const animations=[];
let observer;
if(window.gsap && !reduced.matches) {
  animations.push(gsap.from('.hero-image [data-photo]',{opacity:.35,duration:1.8,ease:'power1.out',clearProps:'opacity'}));
  animations.push(gsap.from('#hero-title',{opacity:0,y:16,duration:1.1,delay:.3,ease:'power2.out',clearProps:'opacity,transform'}));
  if ('IntersectionObserver' in window) {
    observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){ if(!reduced.matches) animations.push(gsap.from(entry.target,{opacity:0,y:18,duration:.7,ease:'power2.out',clearProps:'opacity,transform'})); observer.unobserve(entry.target); }
    }),{threshold:.08});
    all('.reveal').forEach(el=>observer.observe(el));
  }
}
reduced.addEventListener('change',()=>{
  if(reduced.matches){observer?.disconnect(); animations.forEach(a=>a.kill()); motionTargets.forEach(el=>{el.style.removeProperty('opacity');el.style.removeProperty('transform');});}
});

const token=new URLSearchParams(location.hash.slice(1)).get('invite');
window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).get('invite')!==token)location.reload();});
if(token){
  document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(!link)return;const target=document.getElementById(link.getAttribute('href').slice(1));if(target){event.preventDefault();target.scrollIntoView({behavior:reduced.matches?'instant':'smooth'});}});
  const {initManagedRsvp}=await import('./managed-rsvp.js');
  if(!await initManagedRsvp(token))initLegacyRsvp();
}else initLegacyRsvp();
function initLegacyRsvp(){
const form=$('#rsvp-form'),fields=$('#rsvp-fields'),submit=$('#submit-rsvp'),status=$('#connection-status'),feedback=$('#form-feedback');
const adults=$('#adult-count'),children=$('#child-count');
let ready=false,preview=false,busy=false,maxParty=1,version=0,pending=null;
const messages={
  invalid_invitation:'请使用新人发送的专属邀请链接回复。如链接已失效，请联系新人。',
  session_required:'请允许本网站保存 Cookie，然后刷新页面后再回复。',
  rate_limited:'回复较为频繁，请一分钟后再试。',
  invalid_fields:'请检查姓名、是否出席及成人与儿童人数后再试。',
  invalid_party_size:'总人数须在邀请范围内，且包含你本人。',
  invalid_origin:'回复链接暂不可用，请从原邀请链接重新打开。',
  version_conflict:'回复已在另一页面更新。请先读取最新回复，再确认你的调整。',
  idempotency_conflict:'这次回复的状态已变化，请先读取最新回复再试。',
  unavailable:'在线回复暂未开放或连接中断。请稍后再试，或直接联系新人。'
};
const reloadButton=document.createElement('button'); reloadButton.type='button'; reloadButton.className='text-button'; reloadButton.id='reload-reply'; reloadButton.textContent='读取最新回复'; reloadButton.hidden=true; feedback.after(reloadButton);
async function request(path,body,id) {
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(id?{'Idempotency-Key':id}:{})},body:JSON.stringify(body),signal:controller.signal});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(messages[result.error] || messages.unavailable); error.code=result.error; throw error;}
    return result;
  } catch(error) {
    if(error.name==='AbortError' || error instanceof TypeError) throw new Error('连接中断或超时，请检查网络后重试。');
    throw error;
  } finally {clearTimeout(timeout);}
}
function showReply(reply) {
  if(!reply) return;
  $('#guest-name').value=reply.name;
  const radio=form.querySelector(`input[name="attendance"][value="${reply.attendance==='yes'?'yes':'no'}"]`);
  radio.checked=true;
  adults.value=String(reply.adultCount); children.value=String(reply.childCount);
  $('#party-field').hidden=reply.attendance!=='yes';
}
async function connect() {
  ready=false;fields.disabled=true;$('#retry-connection').hidden=true;reloadButton.hidden=true;status.textContent='正在确认回复通道…';
  try {
    const result=await request('/api/context',{});
    if(result.ready!==true || !Number.isInteger(result.maxPartySize) || !Number.isInteger(result.version)) throw new Error(messages.unavailable);
    ready=true;preview=result.preview===true;maxParty=result.maxPartySize;version=result.version;pending=null;
    adults.max=children.max=String(maxParty);
    showReply(result.reply);
    status.textContent=preview?'本地预览 · 回复仅保存于此电脑，不会发送给新人。':result.reply?'已载入你的回复，可在下方调整。':token?'专属邀请 · 回复可通过原邀请链接更新。':'欢迎赴约 · 填写下方信息，告诉我们你的安排。';
    $('#privacy-note').textContent=preview?'预览仅用于体验，请勿填写真实宾客资料。测试内容仅保存在本机数据库，正式回复将在确认后开放。':'仅收集姓名、是否出席及成人与儿童人数，用于本次婚礼安排。回复仅供新人查看，不在页面公开；'+(token?'可通过原邀请链接更新。':'本浏览器会记住你的回复，可再次打开此网页更新。更换浏览器或清除 Cookie 后，请联系新人修改，避免重复回复。');
    submit.textContent=preview?'保存预览回复':result.reply?'更新回复':'确认回复';
    $('#party-hint').textContent=`总人数为成人与儿童之和，包含你本人，最多 ${maxParty} 位。`;
    fields.disabled=false;updateCounts();return true;
  } catch(error){status.textContent=error.message || messages.unavailable;$('#retry-connection').hidden=false;return false;}
}
$('#retry-connection').addEventListener('click',connect);
reloadButton.addEventListener('click',()=>{feedback.hidden=true;connect();});
function updateCounts(){
  const total=(Number(adults.value)||0)+(Number(children.value)||0); $('#party-total').textContent=String(total);
  all('[data-step]').forEach(button=>{const [id,delta]=button.dataset.step.split(':');button.disabled=Number(delta)<0?Number($('#'+id).value)<=0:total>=maxParty;});
}
function clearFeedback(){feedback.hidden=true;}
all('input[name="attendance"]').forEach(radio=>radio.addEventListener('change',()=>{
  const yes=radio.value==='yes';$('#party-field').hidden=!yes; adults.required=children.required=yes;
  if(yes && Number(adults.value)+Number(children.value)===0) adults.value='1';
  $('#attendance-error').hidden=true;updateCounts();clearFeedback();
}));
all('[data-step]').forEach(button=>button.addEventListener('click',()=>{const [id,delta]=button.dataset.step.split(':');const input=$('#'+id);input.value=String(Math.max(0,Math.min(maxParty,(Number(input.value)||0)+Number(delta))));updateCounts();clearFeedback();}));
[adults,children].forEach(input=>input.addEventListener('input',updateCounts));
form.addEventListener('input',clearFeedback);
function fieldError(id,text,input){$(id).textContent=text;$(id).hidden=false;input?.setAttribute('aria-invalid','true');}
function makeId(){return crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(20)),n=>n.toString(16).padStart(2,'0')).join('');}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!ready || busy)return;
  all('.field-error').forEach(el=>el.hidden=true);all('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));feedback.hidden=true;
  const name=$('#guest-name').value.trim(); const attendance=form.querySelector('input[name="attendance"]:checked')?.value;
  const adultCount=attendance==='yes'?Number(adults.value):0,childCount=attendance==='yes'?Number(children.value):0;
  let invalid=null;
  if(!name || Array.from(name).length>80 || /[<>\u0000-\u001f\u007f]/u.test(name)){fieldError('#name-error','请填写有效姓名（最多80个字符）。',$('#guest-name'));invalid=$('#guest-name');}
  if(!attendance){fieldError('#attendance-error','请选择是否赴约。');invalid ||= form.querySelector('input[name="attendance"]');}
  if(attendance==='yes' && (!Number.isInteger(adultCount)||!Number.isInteger(childCount)||adultCount<0||childCount<0||adultCount+childCount<1||adultCount+childCount>maxParty)){fieldError('#party-error',`成人与儿童人数须为非负整数，合计 1 至 ${maxParty} 位。`,adults);invalid ||= adults;}
  if(invalid){invalid.focus();return;}
  const payload={name,attendance,adultCount,childCount,website:$('#website').value,expectedVersion:version};
  const signature=JSON.stringify(payload);if(!pending || pending.signature!==signature) pending={signature,id:makeId()};
  busy=true;fields.disabled=true;submit.textContent='正在保存…';reloadButton.hidden=true;
  try {
    const result=await request('/api/rsvp',payload,pending.id);
    if(result.saved!==true || !Number.isInteger(result.version))throw new Error(messages.unavailable);
    version=result.version;pending=null;feedback.classList.remove('error');
    if(result.replayed){const refreshed=await connect();feedback.textContent=refreshed?(preview?'已确认预览回复保存成功，并载入最新安排。':'已确认回复保存成功，并载入最新安排。'):'此前的回复已保存，但暂时无法读取最新安排。请重新连接后确认。';}
    else feedback.textContent=preview?`预览回复已保存到本机数据库：成人 ${adultCount} 位，儿童 ${childCount} 位。不会发送给新人。`:attendance==='yes'?`回复已保存：成人 ${adultCount} 位，儿童 ${childCount} 位，共 ${adultCount+childCount} 位。期待与你相见！`:'回复已保存，谢谢你的心意。如有变化，'+(token?'可通过原邀请链接更新。':'可在本浏览器再次打开网页更新。');
  } catch(error){
    feedback.classList.add('error');
    if(['version_conflict','idempotency_conflict'].includes(error.code)){pending=null;reloadButton.hidden=false;feedback.textContent=error.message;}
    else feedback.textContent=`未能确认回复已保存。${error.message || messages.unavailable} 重试不会重复计入人数。`;
  } finally {busy=false;fields.disabled=!ready;submit.textContent=preview?'保存预览回复':'更新回复';updateCounts();feedback.hidden=false;feedback.focus({preventScroll:true});}
});
connect();
}
