/** Optional wedding-page photo charms. Importing/disabled initialization has no side effects. */
const PROTECTED = 'h1,h2,h3,h4,h5,h6,p,li,dl,table,figure,img,video,canvas,svg,nav,header,form,#rsvp,a,button,input,select,textarea,label,summary,details,[role="button"],[contenteditable],[data-charms-protect]';
const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const bodyRect = body => ({left:body.x,top:body.y,right:body.x+body.size,bottom:body.y+body.size});
const clearBody = (body,bounds,obstacles) => {
  const r=bodyRect(body);
  return r.left>=bounds.left&&r.top>=bounds.top&&r.right<=bounds.right&&r.bottom<=bounds.bottom&&!obstacles.some(o=>overlaps(r,o));
};
const touching = (a,b) => Math.hypot(a.x+a.size/2-b.x-b.size/2,a.y+a.size/2-b.y-b.size/2)<(a.size+b.size)/2;

// A viewport resize can compress two separate circles into one another. Resolve
// that overlap once, before the normal collision loop uses its rollback state.
export function separateResizedCharms(bodies,bounds) {
  const capacity=(b,nx,ny)=>Math.max(0,Math.min(
    nx>1e-9?(bounds.right-b.size-b.x)/nx:nx< -1e-9?(bounds.left-b.x)/nx:Infinity,
    ny>1e-9?(bounds.bottom-b.size-b.y)/ny:ny< -1e-9?(bounds.top-b.y)/ny:Infinity
  ));
  for(let pass=0;pass<64;pass++) {
    let corrected=false;
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++) {
      const a=bodies[i],b=bodies[j];
      if(!touching(a,b))continue;
      const dx=b.x+b.size/2-a.x-a.size/2,dy=b.y+b.size/2-a.y-a.size/2;
      const radius=(a.size+b.size)/2+.001,distance2=dx*dx+dy*dy;
      // Prefer the shortest outward push. Other directions handle a corner or
      // a narrow viewport where a wall prevents separation along that normal.
      const angles=[Math.atan2(dy,dx),0,Math.PI/4,Math.PI/2,3*Math.PI/4,Math.PI,5*Math.PI/4,3*Math.PI/2,7*Math.PI/4];
      let best;
      for(const angle of angles) {
        const nx=Math.cos(angle),ny=Math.sin(angle),dot=dx*nx+dy*ny;
        const distance=-dot+Math.sqrt(dot*dot+radius*radius-distance2);
        const aSpace=capacity(a,-nx,-ny),bSpace=capacity(b,nx,ny);
        if(distance>aSpace+bSpace+1e-8||best&&distance>=best.distance)continue;
        let aMove=Math.min(distance/2,aSpace),bMove=Math.min(distance-aMove,bSpace);
        aMove=distance-bMove;
        best={nx,ny,distance,aMove,bMove};
      }
      if(!best)continue;
      a.x-=best.nx*best.aMove;a.y-=best.ny*best.aMove;
      b.x+=best.nx*best.bMove;b.y+=best.ny*best.bMove;
      corrected=true;
    }
    if(!corrected)break;
  }
}

function rebound(body,velocity) {
  body[velocity]=-body[velocity];
  const speed=Math.hypot(body.vx,body.vy);
  if(speed){const scale=body.cruiseSpeed*1.5/speed;body.vx*=scale;body.vy*=scale;body.rebounding=true;}
}
function travelAxis(body,axis,seconds,bounds,obstacles) {
  const horizontal=axis==='x',velocity=horizontal?'vx':'vy',cross=horizontal?'y':'x';
  const near=horizontal?'left':'top',far=horizontal?'right':'bottom';
  const crossNear=horizontal?'top':'left',crossFar=horizontal?'bottom':'right';
  let low=bounds[near],high=bounds[far]-body.size;
  for(const obstacle of obstacles){
    if(body[cross]>=obstacle[crossFar]||body[cross]+body.size<=obstacle[crossNear])continue;
    if(obstacle[far]<=body[axis]+1e-7)low=Math.max(low,obstacle[far]);
    if(obstacle[near]>=body[axis]+body.size-1e-7)high=Math.min(high,obstacle[near]-body.size);
  }
  if(high-low<1e-6){body[axis]=low;return;}
  let remaining=seconds;
  // Move to contact, reflect, and spend the rest of this step travelling away.
  for(let contact=0;contact<4&&remaining>0;contact++){
    const speed=body[velocity];if(!speed)break;
    const edge=speed>0?high:low,time=Math.max(0,(edge-body[axis])/speed);
    if(time>=remaining){body[axis]+=speed*remaining;break;}
    body[axis]=edge;remaining-=time;rebound(body,velocity);
  }
}
function reflectPair(a,b) {
  const dx=b.x+b.size/2-a.x-a.size/2,dy=b.y+b.size/2-a.y-a.size/2;
  const distance=Math.hypot(dx,dy),nx=distance?dx/distance:1,ny=distance?dy/distance:0;
  const ma=a.fixed?0:1,mb=b.fixed?0:1;
  const relative=((b.fixed?0:b.vx)-(a.fixed?0:a.vx))*nx+((b.fixed?0:b.vy)-(a.fixed?0:a.vy))*ny;
  if(relative<0&&ma+mb){
    const before=[{vx:a.vx,vy:a.vy},{vx:b.vx,vy:b.vy}],impulse=-2*relative/(ma+mb);
    a.vx-=ma*impulse*nx;a.vy-=ma*impulse*ny;b.vx+=mb*impulse*nx;b.vy+=mb*impulse*ny;
    for(const [i,body] of [a,b].entries())if(!body.fixed){
      let speed=Math.hypot(body.vx,body.vy);
      const cruise=body.cruiseSpeed||Math.hypot(before[i].vx,before[i].vy)||speed;
      const target=Math.max(cruise,Math.min(cruise*1.5,speed));
      // Keep a gentle cruise even if a head-on exchange cancels one velocity.
      if(speed<1e-6){const normal=before[i].vx*nx+before[i].vy*ny;body.vx=before[i].vx-2*normal*nx;body.vy=before[i].vy-2*normal*ny;speed=Math.hypot(body.vx,body.vy);}
      if(speed){body.vx*=target/speed;body.vy*=target/speed;}
      body.cruiseSpeed=cruise;body.rebounding=target>cruise;
    }
  }
}
/** Small fixed substeps keep circular portraits outside content and one another. */
export function advanceCharms(bodies,seconds,bounds,obstacles=[]) {
  const elapsed=Math.min(.05,Math.max(0,seconds));
  const steps=Math.ceil(elapsed*120);
  if(!steps)return;
  const dt=elapsed/steps;
  for(let step=0;step<steps;step++) {
    const previous=bodies.map(b=>({x:b.x,y:b.y}));
    for(const b of bodies) {
      if(b.fixed)continue;
      b.cruiseSpeed??=Math.hypot(b.vx,b.vy);
      if(b.rebounding){
        const speed=Math.hypot(b.vx,b.vy);
        if(speed>b.cruiseSpeed){const scale=(b.cruiseSpeed+(speed-b.cruiseSpeed)*Math.exp(-dt/.55))/speed;b.vx*=scale;b.vy*=scale;}
        else b.rebounding=false;
      }
      travelAxis(b,'x',dt,bounds,obstacles);
      travelAxis(b,'y',dt,bounds,obstacles);
    }
    const contacts=new Set();
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++) {
      const a=bodies[i],b=bodies[j];
      if(!touching(a,b))continue;
      contacts.add(i);contacts.add(j);reflectPair(a,b);
    }
    // Only the contacting group rolls back; unrelated pets keep moving.
    // Include any neighbour reached by a rollback so separation stays safe.
    for(let pass=0;contacts.size&&pass<bodies.length;pass++){
      for(const i of contacts)Object.assign(bodies[i],previous[i]);
      let added=false;
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)if(touching(bodies[i],bodies[j])&&(!contacts.has(i)||!contacts.has(j))){reflectPair(bodies[i],bodies[j]);contacts.add(i);contacts.add(j);added=true;}
      if(!added)break;
    }
  }
}
function localAsset(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try { const url=new URL(value,location.origin); return url.origin===location.origin && !url.username && !url.password ? url.pathname+url.search : null; } catch { return null; }
}
function safeLink(value) { try { const url=new URL(value); return url.protocol==='https:' ? url.href : null; } catch { return null; } }
function validCredit(credit) { return credit && typeof credit.title==='string' && typeof credit.creator==='string' && typeof credit.license==='string' && (credit.household===true || (safeLink(credit.sourceUrl) && safeLink(credit.licenseUrl))); }
function descriptor(pet) {
  if (!pet || pet.verified !== true || !['cat','dog'].includes(pet.species) || typeof pet.label !== 'string' || !pet.label.trim() || !validCredit(pet.credit)) return null;
  const src=localAsset(pet.src); if (!src) return null;
  const sound=pet.sound?.verified===true && (pet.sound?.stock===true || pet.sound?.credit?.household===true) && validCredit(pet.sound.credit) && localAsset(pet.sound.src) ? {...pet.sound,src:localAsset(pet.sound.src),fallbackSrc:localAsset(pet.sound.fallbackSrc)} : null;
  return {...pet,src,sound};
}

export function createAnimalCharms({ enabled=false, pets=[], controlsMount, roamPage=false, showCredits=true, isMusicPlaying=()=>false }={}) {
  const inactive={enabled:false,ready:Promise.resolve({enabled:false}),getState:()=>({enabled:false,animationRunning:false,audioBusy:false}),refresh(){},destroy(){}};
  if (!enabled || !Array.isArray(pets) || !pets.length || !controlsMount || !controlsMount.isConnected || /^\/admin(?:\b|\/)/.test(location.pathname)) return inactive;
  const verified=pets.map(descriptor).filter(Boolean).slice(0,3); if (!verified.length) return inactive;
  let destroyed=false, initialized=false, hidden=false, paused=false, muted=false, raf=0, audio=null, audioBusy=false, audioGeneration=0, lastTrigger=-Infinity, lastFrame=null, layoutTimer=0, audioTimer=0;
  let motionBounds={left:0,top:0,right:0,bottom:0}, motionObstacles=[];
  let lastLayoutScrollX=scrollX,lastLayoutScrollY=scrollY;
  // Keep one persistent viewport position per pet across the entire page.
  const roaming=roamPage===true;
  const media=matchMedia('(prefers-reduced-motion: reduce)'),pointerHover=matchMedia('(hover: hover) and (pointer: fine)'); const entries=[]; const removers=[];
  const layer=document.createElement('div'); layer.className='animal-charms-layer'; layer.setAttribute('aria-label','婚礼小伙伴'); layer.hidden=true;
  const controls=document.createElement('section');controls.className='animal-charms-controls';controls.setAttribute('aria-label','小伙伴设置');
  const heading=document.createElement('p');heading.className='animal-charms-caption';heading.textContent=verified.some(p=>p.temporary)?'临时小伙伴头像 · 点击听听授权动物音效':'婚礼小伙伴 · 点击打个招呼';controls.append(heading);
  const dock=document.createElement('div');dock.className='animal-charms-dock';dock.setAttribute('role','group');dock.setAttribute('aria-label','固定小伙伴 · 随时打个招呼');controls.append(dock);
  const toolbar=document.createElement('div');toolbar.className='animal-charms-toolbar';controls.append(toolbar);
  const controlButtons={};
  for(const [key,label] of [['mute','静音'],['pause','暂停移动'],['hide','隐藏小伙伴']]) {const b=document.createElement('button');b.type='button';b.dataset.charmsAction=key;b.textContent=label;b.setAttribute('aria-pressed','false');toolbar.append(b);controlButtons[key]=b;}
  const status=document.createElement('p');status.className='animal-charms-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent=showCredits?'点击小伙伴，听听它的声音。':'';controls.append(status);
  if(showCredits){
  const credits=document.createElement('details');const summary=document.createElement('summary');summary.textContent='头像与音效来源';credits.append(summary);
  function addCredit(credit,prefix) {const p=document.createElement('p');p.append(document.createTextNode(`${prefix}：${credit.title} — ${credit.creator} · `));if(credit.household)p.append(document.createTextNode(credit.license));else for(const [label,url] of [['来源',credit.sourceUrl],[credit.license,credit.licenseUrl]]){const a=document.createElement('a');a.textContent=label;a.href=safeLink(url);a.target='_blank';a.rel='noopener noreferrer';p.append(a,document.createTextNode(' '));}if(credit.changes)p.append(document.createTextNode(`（${credit.changes}）`));credits.append(p);}
  const creditedSounds=new Set();
  for(const pet of verified){addCredit(pet.credit,pet.temporary?`${pet.label} · 临时替代头像`:pet.label);if(pet.sound&&!creditedSounds.has(pet.sound.src)){creditedSounds.add(pet.sound.src);addCredit(pet.sound.credit,pet.sound.credit.household?`${pet.label}的声音`:'授权动物音效');}}
  controls.append(credits);
  }
  controlsMount.append(controls);document.body.append(layer);
  function listen(target,type,fn,options){target.addEventListener(type,fn,options);removers.push(()=>target.removeEventListener(type,fn,options));}
  function updateControls(){for(const [key,value] of [['mute',muted],['pause',paused],['hide',hidden]])controlButtons[key].setAttribute('aria-pressed',String(value));controlButtons.mute.textContent=muted?'开启音效':'静音';controlButtons.pause.textContent=paused?'继续移动':'暂停移动';controlButtons.hide.textContent=hidden?'显示浮动小伙伴':'隐藏浮动小伙伴';}
  function stopAudio(){audioGeneration++;audioBusy=false;clearTimeout(audioTimer);audioTimer=0;if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio=null;}}
  function stopLoop(){if(raf)cancelAnimationFrame(raf);raf=0;lastFrame=null;}
  function shouldAnimate(){return !destroyed&&!hidden&&!paused&&!document.hidden&&!media.matches&&entries.some(e=>e.slot&&!e.button.hidden);}
  function paint(entry){
    const body=entry.slot;if(!body)return;
    entry.button.style.transform=`translate(${body.x}px, ${body.y}px)`;
  }
  function draw(time){
    raf=0;if(!shouldAnimate()){lastFrame=null;return;}
    const active=entries.filter(e=>e.slot&&!e.button.hidden);
    for(const e of active)e.slot.fixed=e.button.matches(':focus-visible')||(pointerHover.matches&&e.button.matches(':hover'));
    advanceCharms(active.map(e=>e.slot),lastFrame===null?0:(time-lastFrame)/1000,motionBounds,motionObstacles);
    lastFrame=time;
    for(const e of active)paint(e);
    raf=requestAnimationFrame(draw);
  }
  function syncLoop(){if(!shouldAnimate())stopLoop();else if(!raf)raf=requestAnimationFrame(draw);}
  function protectedRects(){
    const reveals=new Map();
    return [...document.querySelectorAll(PROTECTED)].filter(el=>!layer.contains(el)).flatMap(el=>{
      if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')return[];
      const r=el.getBoundingClientRect();if(!r.width||!r.height)return[];
      let dx=0,dy=0,travel=0;
      // Reserve the complete 18px reveal path, not its changing frame rectangle.
      // Otherwise each GSAP update can evict a pet to another gap in the page.
      for(let parent=el;parent;parent=parent.parentElement)if(parent.matches('.reveal,#hero-title')){
        if(!reveals.has(parent)){const transform=getComputedStyle(parent).transform;reveals.set(parent,transform==='none'?{m41:0,m42:0}:new DOMMatrixReadOnly(transform));}
        const matrix=reveals.get(parent);dx+=matrix.m41;dy+=matrix.m42;travel+=18;
      }
      return [{left:r.left-dx-8,right:r.right-dx+8,top:r.top-dy-8,bottom:r.bottom-dy+travel+8}];
    });
  }
  function layout(){
    // Image decoding can finish in any order. Wait for the complete, sorted
    // collection before assigning positions so two portraits cannot share one.
    if(destroyed||!initialized)return;const vv=window.visualViewport;const width=vv?.width||innerWidth,height=vv?.height||innerHeight,left=vv?.offsetLeft||0,top=vv?.offsetTop||0;const size=width<=700?52:72;const occupied=[];
    if(roaming){
      const previous=motionBounds;
      motionBounds={left:left+8,top:top+8,right:left+width-8,bottom:top+height-8};
      const resized=previous.right!==motionBounds.right||previous.bottom!==motionBounds.bottom||previous.left!==motionBounds.left||previous.top!==motionBounds.top||entries.some(e=>e.slot&&e.slot.size!==size);
      motionObstacles=[];
      layer.hidden=hidden||document.hidden;
      for(let i=0;i<entries.length;i++){
        const e=entries[i];
        if(!e.slot){
          const speed=width<=700?22:30,angle=[.66,2.35,-.95][i];
          e.slot={x:left+8+(width-size-16)*[.12,.76,.42][i],y:top+8+(height-size-16)*[.23,.52,.81][i],size,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,cruiseSpeed:speed};
        } else if(resized){
          // Browser chrome, keyboard and orientation changes resize the arena.
          // Preserve the relative position; ordinary scrolling never moves it.
          const b=e.slot;
          const nx=(b.x-previous.left)/Math.max(1,previous.right-previous.left-b.size),ny=(b.y-previous.top)/Math.max(1,previous.bottom-previous.top-b.size);
          b.size=size;b.x=motionBounds.left+Math.max(0,Math.min(1,nx))*Math.max(0,width-size-16);b.y=motionBounds.top+Math.max(0,Math.min(1,ny))*Math.max(0,height-size-16);
        }
        e.button.hidden=false;e.button.style.width=`${size}px`;e.button.style.height=`${size}px`;
      }
      if(resized)separateResizedCharms(entries.map(e=>e.slot),motionBounds);
      for(const e of entries)paint(e);
      syncLoop();return;
    }
    const scrollDistance=Math.hypot(scrollX-lastLayoutScrollX,scrollY-lastLayoutScrollY);lastLayoutScrollX=scrollX;lastLayoutScrollY=scrollY;
    motionBounds={left:left+8,top:top+8,right:left+width-8,bottom:top+height-8};
    motionObstacles=protectedRects();
    layer.hidden=hidden||document.hidden;
    for(let i=0;i<entries.length;i++){
      const e=entries[i],old=e.slot;let found=null;
      const safe=body=>clearBody(body,motionBounds,motionObstacles)&&!occupied.some(b=>touching(body,b));
      if(!layer.hidden&&width>=size+24&&height>=size+24){
        if(old&&old.size===size&&safe(old))found=old;
        else {
          const candidates=[],xs=[left+10,left+width-size-10];
          const candidate=(x,y)=>{const body={x,y,size};if(safe(body))candidates.push(body);};
          if(old){
            const x=Math.max(motionBounds.left,Math.min(motionBounds.right-size,old.x)),y=Math.max(motionBounds.top,Math.min(motionBounds.bottom-size,old.y));
            candidate(x,y);
            for(const obstacle of motionObstacles){candidate(x,obstacle.top-size);candidate(x,obstacle.bottom);candidate(obstacle.left-size,y);candidate(obstacle.right,y);}
          }
          for(let x=left+size+24;x<left+width-size-10;x+=size+24)xs.push(x);
          for(const x of xs)for(let y=top+12;y<=top+height-size-12;y+=18)candidate(x,y);
          const targetY=top+height*[.28,.57,.76][i],targetX=i%2?left+width-size:left;
          candidates.sort(old?(a,b)=>Math.hypot(a.x-old.x,a.y-old.y)-Math.hypot(b.x-old.x,b.y-old.y):(a,b)=>Math.abs(a.y-targetY)-Math.abs(b.y-targetY)+(Math.abs(a.x-targetX)-Math.abs(b.x-targetX))*.15);
          found=candidates[0];
          // If scrolling consumes an entire gap, wait offscreen instead of
          // teleporting a visible portrait across text to a distant gap.
          if(found&&old&&old.size===size&&!e.button.hidden&&Math.hypot(found.x-old.x,found.y-old.y)>scrollDistance+8)found=null;
          if(found){const speed=width<=700?15:23,angle=[.66,2.35,-.95][i];found.vx=old?.vx??Math.cos(angle)*speed;found.vy=old?.vy??Math.sin(angle)*speed;found.cruiseSpeed=old?.cruiseSpeed??speed;found.rebounding=old?.rebounding??false;}
        }
      }
      e.slot=found;
      if(!found){if(document.activeElement===e.button)controlButtons.hide.focus({preventScroll:true});e.button.hidden=true;continue;}
      e.button.hidden=false;e.button.style.width=`${size}px`;e.button.style.height=`${size}px`;e.button.style.transform=`translate(${found.x}px, ${found.y}px)`;occupied.push(found);
    }syncLoop();
  }
  function scheduleLayout(){if(destroyed||layoutTimer)return;layoutTimer=requestAnimationFrame(()=>{layoutTimer=0;layout();});}
  function pulse(entry){entry.button.classList.remove('is-reacting');void entry.button.offsetWidth;entry.button.classList.add('is-reacting');clearTimeout(entry.feedbackTimer);entry.feedbackTimer=setTimeout(()=>entry.button.classList.remove('is-reacting'),550);}
  async function activate(entry,event){
    if(!event.isTrusted||destroyed||(hidden&&entry.kind!=='dock')||document.hidden)return;
    const now=performance.now();if(audioBusy||now-lastTrigger<800)return;lastTrigger=now;pulse(entry);
    if(muted){status.textContent=`${entry.pet.label}向你打招呼 · 音效已静音。`;return;}
    if(!entry.pet.sound){status.textContent=`${entry.pet.label}向你打招呼 · 暂无已验证的音效。`;return;}
    stopAudio();const generation=audioGeneration;const effect=new Audio();audio=effect;audioBusy=true;effect.preload='none';let music=false;try{music=Boolean(isMusicPlaying());}catch{}
    const volume=Number.isFinite(entry.pet.sound.volume)?Math.max(0,Math.min(1,entry.pet.sound.volume)):.25;effect.volume=volume*(music?.48:1);
    const sound=entry.pet.sound;effect.src=sound.fallbackSrc&&sound.src.endsWith('.ogg')&&!effect.canPlayType('audio/ogg')?sound.fallbackSrc:sound.src;
    status.textContent=`正在加载${entry.pet.label}的声音…`;
    const current=()=>!destroyed&&generation===audioGeneration&&audio===effect;
    const failure=()=>{if(!current())return;stopAudio();status.textContent='音效暂时无法播放，可稍后再次点击。';};
    audioTimer=setTimeout(failure,8000);
    effect.addEventListener('error',failure,{once:true});
    effect.addEventListener('ended',()=>{if(current()){stopAudio();status.textContent=`${entry.pet.label}向你打招呼。`; }},{once:true});
    try{await effect.play();if(!current()||muted||(hidden&&entry.kind!=='dock')||document.hidden){effect.pause();return;}status.textContent=`正在播放${entry.pet.label}的声音。`;}catch{failure();}
  }
  const ready=Promise.all(verified.map(async (pet,index)=>{
    const image=new Image();image.alt='';image.decoding='async';image.draggable=false;image.src=pet.src;
    try{await image.decode();}catch{return;}
    if(destroyed||!image.naturalWidth)return;
    const description=`${pet.label}，点击打招呼${pet.species==='cat'?'并听猫咪音效':'并听狗狗音效'}${pet.temporary?'（临时替代头像）':''}`;
    const frame=document.createElement('span');frame.className='animal-charm-photo';
    if(pet.portraitClass)frame.classList.add(pet.portraitClass);
    frame.append(image);
    const button=document.createElement('button');button.className='animal-charm';button.type='button';button.hidden=true;button.setAttribute('aria-label',`浮动小伙伴：${description}`);button.append(frame);layer.append(button);
    const dockButton=document.createElement('button');dockButton.className='animal-charm-dock';dockButton.type='button';dockButton.setAttribute('aria-label',`固定小伙伴：${description}`);const dockFrame=frame.cloneNode(true),dockImage=dockFrame.querySelector('img');const dockLabel=document.createElement('span');dockLabel.className='animal-charm-dock-label';dockLabel.textContent=pet.label;dockButton.append(dockFrame,dockLabel);dock.append(dockButton);
    const dockEntry={pet,button:dockButton,image:dockImage,kind:'dock',feedbackTimer:0};const entry={pet,index,button,image,slot:null,feedbackTimer:0,dockEntry};entries.push(entry);listen(button,'click',e=>activate(entry,e));listen(dockButton,'click',e=>activate(dockEntry,e));
  })).then(()=>{if(!destroyed){if(!entries.length){layer.remove();controls.remove();}else{entries.sort((a,b)=>a.index-b.index);for(const e of entries){layer.append(e.button);dock.append(e.dockEntry.button);}initialized=true;layout();}}return{enabled:!destroyed&&entries.length>0,loaded:entries.length};});
  listen(controlButtons.mute,'click',()=>{muted=!muted;if(muted)stopAudio();status.textContent=muted?'小伙伴音效已静音。':'音效已开启，点击小伙伴才会播放。';updateControls();});
  listen(controlButtons.pause,'click',()=>{paused=!paused;for(const e of entries){e.button.classList.remove('is-reacting');e.dockEntry.button.classList.remove('is-reacting');}layer.classList.toggle('is-paused',paused);controls.classList.toggle('is-paused',paused);updateControls();layout();});
  listen(controlButtons.hide,'click',()=>{hidden=!hidden;if(hidden)stopAudio();updateControls();layout();});
  listen(window,'resize',scheduleLayout,{passive:true});listen(window,'scroll',scheduleLayout,{passive:true,capture:true});
  if(window.visualViewport){listen(visualViewport,'resize',scheduleLayout,{passive:true});listen(visualViewport,'scroll',scheduleLayout,{passive:true});}
  listen(media,'change',()=>{for(const e of entries){e.button.classList.remove('is-reacting');e.dockEntry.button.classList.remove('is-reacting');}layout();});
  listen(document,'visibilitychange',()=>{if(document.hidden)stopAudio();layout();});
  const resizeObserver=new ResizeObserver(scheduleLayout);resizeObserver.observe(document.documentElement);
  const mutationObserver=new MutationObserver(records=>{if(records.some(r=>!layer.contains(r.target)&&!controls.contains(r.target)))scheduleLayout();});mutationObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});
  document.fonts?.ready.then(()=>{if(!destroyed)layout();});
  updateControls();
  return {enabled:true,ready,getState:()=>({enabled:!destroyed,hidden,paused,muted,reducedMotion:media.matches,audioBusy,animationRunning:Boolean(raf),visible:destroyed?0:entries.filter(e=>!e.button.hidden&&!layer.hidden).length}),refresh:layout,destroy(){if(destroyed)return;destroyed=true;stopLoop();stopAudio();cancelAnimationFrame(layoutTimer);for(const e of entries){clearTimeout(e.feedbackTimer);clearTimeout(e.dockEntry.feedbackTimer);}for(const remove of removers)remove();resizeObserver.disconnect();mutationObserver.disconnect();layer.remove();controls.remove();}};
}
