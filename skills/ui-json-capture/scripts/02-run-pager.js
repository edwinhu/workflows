// Detached self-driving pager. Returns IMMEDIATELY — evaluate_script cannot await a long
// loop (CDP protocolTimeout kills the call at ~120s while the in-page loop keeps running).
// Poll with 03-status.js. Halt by setting window.__cap.stop = true.
// TUNE the pacing constants; TUNE the Next-button selector.
() => {
  if (window.__cap.running) return {already:true};
  window.__cap.running = true; window.__cap.stop = false;
  window.__cap.stats = window.__cap.stats || {clicks:0,longs:0,scrolls:0,stalls:0,startedAt:Date.now()};
  const s = window.__cap.stats;
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const rnd = (a,b) => a + Math.random()*(b-a);
  // ---- SITE-SPECIFIC: locate the next-page control ----
  const nextBtn = () => Array.from(document.querySelectorAll('button'))
      .find(b=>(b.innerText||'').trim()==='Next' && !b.disabled);
  const got = () => window.__cap.pages.length + (window.__cap.dumped||0);
  (async () => {
    let stalls = 0;
    while(!window.__cap.stop){
      const n = 1 + Math.floor(Math.random()*2);
      for(let i=0;i<n;i++){ window.scrollBy({top:rnd(250,800),behavior:'smooth'}); s.scrolls++; await sleep(rnd(350,1100)); }
      await sleep(rnd(1200,4000));
      if(Math.random() < 0.04){ await sleep(rnd(12000,30000)); s.longs++; }
      const b = nextBtn(); if(!b){ s.done='no next button'; break; }
      const before = got(); b.click(); s.clicks++;
      let ok=false;
      for(let w=0; w<80; w++){ await sleep(250); if(got()>before){ok=true;break;} }
      if(!ok){ stalls++; s.stalls=stalls; if(stalls>=3){ s.done='stalled'; break; } await sleep(rnd(6000,15000)); }
      else stalls=0;
      window.scrollTo({top:0,behavior:'smooth'});
    }
    window.__cap.running = false;
  })();
  return {started:true, at: got()};
}
