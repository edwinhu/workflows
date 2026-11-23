async () => {
window.__fcheck3 = async (batch, tag) => {
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const waitFor=async(fn,ms=20000)=>{const t0=Date.now(); while(Date.now()-t0<ms){const v=fn(); if(v) return v; await sleep(400);} return null;};
const KW=/found|start|launch|join|hired|named|recruit|appoint|tapped|brought|succeed|replac|step(ped)? down|chief executive|CEO/i;
const FND=/co-?found|found/i, CEO=/chief executive|CEO/;
const sents=(t,sur)=>{const re=new RegExp(sur);return [...t.replace(/\n+/g,' ').matchAll(/[^.]{0,220}\.?/g)].map(m=>m[0].trim()).filter(s=>s.length>20&&!/Search Factiva|Modify Search/.test(s)&&((re.test(s)&&KW.test(s))||(FND.test(s)&&CEO.test(s)))).map(s=>s.slice(0,260));};
// Read an article in a hidden same-origin iframe: history.back() from an opened article does not restore the results list.
const readArticle=async(href)=>{const fr=document.createElement('iframe'); fr.style.cssText='position:fixed;left:-9999px;width:1200px;height:900px'; fr.src=href; document.body.appendChild(fr);
 const t0=Date.now(); let t='';
 while(Date.now()-t0<25000){ await sleep(1000); try{ t=fr.contentDocument.body.innerText; }catch(e){ t=''; } if(/words,/.test(t)&&t.length>1500) break; }
 fr.remove(); return t;};
const store=()=>{ try{ localStorage.setItem('__f3_'+tag, JSON.stringify(window.__f3[tag])); }catch(e){} };
window.__f3 = window.__f3 || {}; if(!window.__f3[tag]){ try{ window.__f3[tag]=JSON.parse(localStorage.getItem('__f3_'+tag)||'[]'); }catch(e){ window.__f3[tag]=[]; } }
const done = new Set(window.__f3[tag].map(r=>r.rid));
for (const [rid,q,sur,to,maxA] of batch) {
 if (done.has(rid)) continue;
 try {
  if(!document.querySelector('[aria-label="Search Field"]')){ const l=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim()==='Search Builder'); l && l.click(); }
  const f=await waitFor(()=>document.querySelector('[aria-label="Search Field"]')); if(!f){window.__f3[tag].push({rid,err:'nofield'}); store(); continue;} await sleep(1500);
  const db=await waitFor(()=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-haspopup')==='dialog' && /Year|Dates|Last|Custom|\d{4}/.test(b.textContent))); db.click();
  const cd=await waitFor(()=>[...document.querySelectorAll('[role=dialog] *')].find(e=>e.children.length===0 && e.textContent.trim()==='Custom Date')); (cd.closest('label,button,[role=radio],li')||cd).click();
  await waitFor(()=>document.getElementById('searchBuilderDateFilter-from'));
  const set=(id,v)=>{const el=document.getElementById(id); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.blur();};
  set('searchBuilderDateFilter-from','01-01-1985'); set('searchBuilderDateFilter-to',to); await sleep(300);
  [...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Apply').click(); await sleep(900);
  const dbt=([...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-haspopup')==='dialog' && /Year|Dates|Last|Custom|\d{4}/.test(b.textContent))||{}).textContent||''; if(/Last Year|Last Week|Last Month|All Dates/i.test(dbt)){console.warn('date-not-applied',rid,dbt); location.reload(); return 'reloaded';}
  f.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, q); await sleep(700);
  const sb=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Search' && !b.closest('[role=search]')); if(!sb||sb.disabled){window.__f3[tag].push({rid,err:'disabled'}); store(); continue;}
  if(!(f.innerText||'').includes(q.slice(0,12))){window.__f3[tag].push({rid,err:'query-not-typed'}); store(); continue;}
  sb.click();
  await waitFor(()=>/Headlines\n\d/.test(document.body.innerText) || /no results|did not match/i.test(document.body.innerText), 20000); await sleep(1500);
  const n=(document.body.innerText.match(/Headlines\n([\d,]+)/)||[])[1]||'0';
  const snip=sents(document.body.innerText,sur).slice(0,4);
  const opened=[]; const arts=[]; const links=[...new Map([...document.querySelectorAll('a[href*="article?id="]')].map(a=>[a.href,a.textContent.trim().slice(0,100)])).entries()].slice(0,maxA||6);
  for(const [href,hl] of links){
    const t=await readArticle(href);
    const s=sents(t,sur).slice(0,4);
    const tn=t.replace(/\n+/g,' ');
    if(s.length) arts.push({hl, src:(tn.match(/words, \d{1,2} \w+ (?:19|20)\d\d, ([^,]{3,60}),/)||[])[1], date:(tn.match(/words, (\d{1,2} \w+ (?:19|20)\d\d)/)||[])[1], s});
    opened.push(hl);
  }
  window.__f3[tag].push({rid,n,snip,arts,opened}); store();
  const l=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim()==='Search Builder'); l && l.click(); await sleep(2500);
 } catch(e) { window.__f3[tag].push({rid,err:String(e).slice(0,120)}); store(); }
}
return window.__f3[tag].length;
};
window.__go3 = (batch, tag) => { window.__f3done = window.__f3done || {}; window.__f3done[tag]=false; window.__fcheck3(batch, tag).then(()=>{window.__f3done[tag]=true}).catch(e=>{window.__f3done[tag]='err '+e}); return 'started '+tag; };
window.__get3 = (tag) => { let r = (window.__f3||{})[tag]; if(!r){ try{ r=JSON.parse(localStorage.getItem('__f3_'+tag)||'[]'); }catch(e){ r=[]; } } return r; };
return typeof window.__fcheck3;
}
