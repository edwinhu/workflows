// Cheap poll. Safe to call any time.
() => {
  const c = window.__cap, s = (c && c.stats) || {};
  const tot = c ? c.pages.length + (c.dumped||0) : 0;
  const mins = s.startedAt ? (Date.now()-s.startedAt)/60000 : 0;
  return {running: c && c.running, pagesTotal: tot, inMemory: c ? c.pages.length : 0,
          onDisk: c ? c.dumped : 0,
          lastStart: c && c.pages.length ? c.pages[c.pages.length-1].start : null,
          clicks:s.clicks, scrolls:s.scrolls, longPauses:s.longs, stalls:s.stalls, done:s.done,
          elapsedMin:+mins.toFixed(1), pagesPerMin:+(tot/Math.max(mins,0.1)).toFixed(2),
          errors: c ? c.errors.slice(0,3) : null};
}
