// Pass as the `function` param to evaluate_script on the Bloomberg Law tab. Install BEFORE
// clicking Search, so page 1 (the form submission) is captured too. Idempotent.
// Results arrive as POST /product/blaw/api/v1/search/criteria; paging is an in-app route change,
// so the hook survives every page turn.
() => {
  if (window.__cap) return {already:true, pages:window.__cap.pages.length, dumped:window.__cap.dumped||0};
  window.__cap = { pages: [], seen: new Set(), errors: [], dumped: 0, queries: {} };
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open, origSend = XHR.send;
  XHR.open = function(m,u){ this.__url = u; return origOpen.apply(this, arguments); };
  XHR.send = function(body){
    this.addEventListener('load', () => {
      try{
        if (!this.__url || !/\/api\/v1\/search\/criteria$/.test(this.__url)) return;
        const j = JSON.parse(this.responseText);
        const docs = j.results_page && j.results_page.components && j.results_page.components.documents;
        const crit = (j.results_page && j.results_page.criteria) || {};
        if (!docs || !Array.isArray(docs.items)) return;
        const page = crit.page || 1, size = crit.page_size || docs.items.length;
        // Query identity = criteria minus paging. A filter click is a NEW query on the same endpoint.
        const q = JSON.stringify(Object.fromEntries(Object.entries(crit)
                    .filter(([k]) => !['page','bucket'].includes(k)).sort()));
        window.__cap.queries[q] = docs.remote_count;
        const key = q + '#' + page;
        if (window.__cap.seen.has(key)) return;
        window.__cap.seen.add(key);
        window.__cap.pages.push({start: (page-1)*size, page, query: q,
                                 total: docs.remote_count, rows: docs.items});
      }catch(e){ window.__cap.errors.push(String(e).slice(0,160)); }
    });
    return origSend.apply(this, arguments);
  };
  return {installed:true};
}
