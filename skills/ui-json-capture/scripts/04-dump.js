// Drain in-memory pages to disk. Pass evaluate_script's `filePath` param so the payload
// NEVER transits the model context. filePath must be inside a configured workspace root.
() => {
  const out = window.__cap.pages.map(p=>({start:p.start, rows:p.rows}));
  window.__cap.dumped = (window.__cap.dumped||0) + out.length;
  window.__cap.pages = [];
  return out;
}
