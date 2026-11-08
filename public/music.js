// Optional local audio. Only an explicit autoplay setting attempts playback on load.
export function initMusic(config) {
  if (!config?.src || !/^\/assets\/audio\/[a-zA-Z0-9_./-]+\.(mp3|m4a|ogg|wav)$/i.test(config.src) || config.src.includes('..') || !config.title || !config.credit) return;
  const player=document.createElement('div');player.className='music-control';player.classList.toggle('is-default-on',config.autoplay===true);player.setAttribute('role','group');player.setAttribute('aria-label','请柬配乐');
  const button=document.createElement('button');button.type='button';button.className='text-button';button.id='music-toggle';button.setAttribute('aria-pressed','false');
  const status=document.createElement('span');status.id='music-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const credit=document.createElement('p');credit.className='music-credit';
  function externalLink(text,url){
    const el=document.createElement('a');el.textContent=text;
    try{const parsed=new URL(url);if(parsed.protocol==='https:'){el.href=parsed.href;el.target='_blank';el.rel='noopener noreferrer';return el;}}catch{}
    return document.createTextNode(text);
  }
  credit.append(externalLink('“'+config.title+'”',config.sourceUrl),document.createTextNode(' '+config.credit+'.'));
  if(config.license)credit.append(document.createTextNode(' Licensed under '),externalLink(config.license,config.licenseUrl),document.createTextNode('.'));
  if(config.changes)credit.append(document.createTextNode(' '+config.changes));
  button.setAttribute('aria-describedby','music-status');player.append(button,status,credit);
  const footer=document.querySelector('footer');if(footer)footer.before(player);else document.body.append(player);
  const audio=new Audio();audio.preload='none';audio.loop=true;
  if(config.autoplay===true)audio.volume=0.3;
  let attempt=0,phase='paused',wantsPlayback=false,loadTimer;
  const gestures=['pointerdown','touchend','keydown'];
  function clearDeferred(){for(const event of gestures)document.removeEventListener(event,onGesture,true);}
  function clearBridge(){document.removeEventListener('WeixinJSBridgeReady',onBridgeReady);}
  function onBridgeReady(){
    // WeChat can reject the initial attempt before its native bridge is ready.
    if(wantsPlayback&&!document.hidden&&phase!=='playing')start(true);
  }
  function showPaused(message='配乐已关闭'){
    phase='paused';button.textContent='播放配乐';button.setAttribute('aria-pressed','false');status.textContent=message;
  }
  function stop(message){
    attempt++;wantsPlayback=false;clearTimeout(loadTimer);clearDeferred();clearBridge();audio.pause();showPaused(message);
  }
  function showPlaying(){
    // Media events and play promises may arrive after the guest has already paused.
    if(!wantsPlayback||document.hidden){audio.pause();return;}
    if(audio.paused)return;
    clearTimeout(loadTimer);clearDeferred();clearBridge();phase='playing';button.textContent='暂停配乐';button.setAttribute('aria-pressed','true');status.textContent='正在播放 · '+config.title;
  }
  function onGesture(event){
    if(!event.isTrusted||button.contains(event.target)||document.hidden)return;
    if(event.type==='pointerdown'&&event.pointerType!=='mouse')return;
    // Keep play() inside the trusted event, without consuming the guest's action.
    start(true);
  }
  function waitForGesture(){
    clearTimeout(loadTimer);phase='waiting';button.textContent='播放配乐';button.setAttribute('aria-pressed','false');
    status.textContent='浏览器限制自动播放，等待点按页面后播放配乐。';
    for(const event of gestures)document.addEventListener(event,onGesture,true);
  }
  function start(deferIfBlocked=false){
    if(document.hidden){stop();return;}
    clearDeferred();clearTimeout(loadTimer);wantsPlayback=true;phase='loading';const current=++attempt;
    button.textContent='取消载入';button.setAttribute('aria-pressed','false');status.textContent='正在载入配乐…';
    if(!audio.src)audio.src=config.src;else if(audio.error)audio.load();
    loadTimer=setTimeout(()=>{if(current===attempt)stop('载入配乐超时，请点击重试。');},20000);
    function failed(error){
      if(current!==attempt)return;
      if(error?.name==='NotAllowedError'&&deferIfBlocked&&!document.hidden)waitForGesture();
      else stop('未能播放。请再次点击，或检查网络后重试。');
    }
    try{
      Promise.resolve(audio.play()).then(()=>{
        if(current===attempt)showPlaying();
        else if(!wantsPlayback)audio.pause();
      },failed);
    }catch(error){failed(error);}
  }
  showPaused();
  audio.addEventListener('playing',showPlaying);
  audio.addEventListener('pause',()=>{if(phase==='playing'&&audio.paused)stop();});
  audio.addEventListener('ended',()=>{if(wantsPlayback)stop();});
  audio.addEventListener('error',()=>{if(wantsPlayback&&audio.error)stop('暂时无法播放配乐，请稍后重试。');});
  button.addEventListener('click',()=>{if(phase==='loading'||!audio.paused)stop();else start();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  if(config.autoplay===true){document.addEventListener('WeixinJSBridgeReady',onBridgeReady);start(true);}
}
