// Detached pager for Bloomberg Law results. Returns IMMEDIATELY; poll with
// ui-json-capture/scripts/03-status.js, halt with 05-stop.js. Human pacing: scroll, read, click.
() => {
  if (window.__cap.running) return {already:true};
  window.__cap.running = true; window.__cap.stop = false;
  window.__cap.stats = window.__cap.stats || {clicks:0,longs:0,scrolls:0,stalls:0,startedAt:Date.now()};
  const s = window.__cap.stats;
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const rnd = (a,b) => a + Math.random()*(b-a);
  // The pager is an <svg>, disabled via attribute disabled="true".
  const nextBtn = () => {
    const n = document.querySelector('[data-testid="search-results-next-page"]');
    return n && n.getAttribute('disabled') !== 'true' ? n : null;
  };
  const got = () => window.__cap.pages.length + (window.__cap.dumped||0);
  (async () => {
    let stalls = 0;
    while(!window.__cap.stop){
      const n = 2 + Math.floor(Math.random()*3);
      for(let i=0;i<n;i++){ window.scrollBy({top:rnd(300,900),behavior:'smooth'}); s.scrolls++; await sleep(rnd(800,2500)); }
      await sleep(rnd(3000,9000));
      if(Math.random() < 0.08){ await sleep(rnd(20000,60000)); s.longs++; }
      const b = nextBtn(); if(!b){ s.done='no next button'; break; }
      const before = got();
      b.dispatchEvent(new MouseEvent('click',{bubbles:true})); s.clicks++;
      let ok=false;
      for(let w=0; w<120; w++){ await sleep(250); if(got()>before){ok=true;break;} }
      if(!ok){ stalls++; s.stalls=stalls; if(stalls>=3){ s.done='stalled'; break; } await sleep(rnd(8000,20000)); }
      else stalls=0;
      window.scrollTo({top:0,behavior:'smooth'});
    }
    window.__cap.running = false;
  })();
  return {started:true, at: got()};
}
