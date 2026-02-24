'use strict';

// Instrument Tracker — pwa.js
// - install prompt wiring
// - service worker registration

export function setupInstallPrompt({ installBtnEl, onReady } = {}){
  let deferred = null;

  function showBtn(show){
    if(!installBtnEl) return;
    installBtnEl.hidden = !show;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    showBtn(true);
    if(typeof onReady === 'function') onReady();
  });

  if(installBtnEl){
    installBtnEl.addEventListener('click', async () => {
      if(!deferred) return;
      showBtn(false);
      deferred.prompt();
      try{ await deferred.userChoice; }catch(_){ /* ignore */ }
      deferred = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    deferred = null;
    showBtn(false);
  });
}

export async function registerServiceWorker(swPath = './sw.js'){
  if(!('serviceWorker' in navigator)) return { ok:false, reason:'no-sw' };

  try{
    const reg = await navigator.serviceWorker.register(swPath, { scope:'./' });
    return { ok:true, reg };
  }catch(err){
    return { ok:false, reason:String(err?.message || err) };
  }
}
