#!/usr/bin/env bash
# Refresh `paperpile` CLI auth by pulling cookies from the logged-in Dia browser
# over CDP — no manual Cookie-Editor export needed.
#
# Usage: refresh-auth-from-dia.sh [CDP_PORT]   (default 9222 = Dia)
# Prereq: Dia is on CDP (port 9222) and logged into Paperpile in some tab.
#
# Flips the path of least resistance: when `paperpile auth` fails, this is the
# one command to run — there is never a reason to drive the Paperpile web UI.
set -euo pipefail

PORT="${1:-9222}"
BASE="http://localhost:${PORT}"

if ! curl -sf --connect-timeout 2 "${BASE}/json/version" >/dev/null; then
  echo "error: no CDP browser on :${PORT} (Dia). Bring it up (browser-automation skill) and retry." >&2
  exit 1
fi

TMP="$(mktemp -t pp_cookies.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT

OUT="$TMP" CDP_BASE="$BASE" node - <<'NODE'
const base = process.env.CDP_BASE;
const list = await (await fetch(`${base}/json/list`)).json();
const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
if (!t) { console.error('error: no page target to attach to'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
const cmd = (method, params = {}) => {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((res, rej) => {
    const h = (e) => { const m = JSON.parse(e.data); if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });
};
await new Promise(r => ws.addEventListener('open', r));
const { cookies } = await cmd('Network.getCookies', { urls: ['https://app.paperpile.com', 'https://paperpile.com', 'https://www.paperpile.com'] });
ws.close();
if (!cookies.some(c => c.name === 'plack_session')) {
  console.error('error: no Paperpile session cookie found — log into Paperpile in Dia first.');
  process.exit(2);
}
const ss = { None: 'no_restriction', Lax: 'lax', Strict: 'strict' };
const out = cookies.map(c => ({
  domain: c.domain, name: c.name, value: c.value, path: c.path || '/',
  secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: ss[c.sameSite] || 'no_restriction',
  expirationDate: (c.expires && c.expires > 0) ? c.expires : undefined,
  hostOnly: !c.domain.startsWith('.'), session: !(c.expires && c.expires > 0), storeId: null,
}));
(await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.error(`extracted ${out.length} cookies`);
NODE

paperpile auth import "$TMP"
paperpile auth
