// Pass this as the `function` param to evaluate_script. Installs an XHR capture hook.
// Idempotent: returns {already:true} if already installed.
// EDIT THE URL TEST for your site before first use.
() => {
  if (window.__cap) return {already:true, pages:window.__cap.pages.length, dumped:window.__cap.dumped||0};
  window.__cap = { pages: [], seen: new Set(), errors: [], dumped: 0 };
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open, origSend = XHR.send;
  XHR.open = function(m,u){ this.__url = u; return origOpen.apply(this, arguments); };
  XHR.send = function(){
    this.addEventListener('load', () => {
      try{
        // ---- SITE-SPECIFIC: the endpoint that returns the result page ----
        const isResults = this.__url && /\/state-court\/cases\//.test(this.__url);
        const isJson = /application\/json/.test(this.getResponseHeader('content-type')||'');
        if (isResults && isJson){
          const j = JSON.parse(this.responseText);
          // ---- SITE-SPECIFIC: array field + offset field ----
          const rows = j.result, off = j.start, total = j.total_results_number;
          if (Array.isArray(rows)) {
            const key = off + ':' + rows.length;              // dedupe key
            if(!window.__cap.seen.has(key)){
              window.__cap.seen.add(key);
              window.__cap.pages.push({start: off, total, rows});
            }
          }
        }
      }catch(e){ window.__cap.errors.push(String(e).slice(0,160)); }
    });
    return origSend.apply(this, arguments);
  };
  return {installed:true};
}
