#!/usr/bin/env bash
# Refresh `paperpile` CLI auth by pulling cookies from the logged-in browser
# over CDP — no manual Cookie-Editor export needed.
#
# Usage: refresh-auth-from-dia.sh [CDP_PORT]   (default 9222)
# Prereq: the browser is on CDP (port 9222) and logged into Paperpile.
#         macOS: Dia. Linux: Chromium. Same port either way.
#
# Flips the path of least resistance: when `paperpile auth` fails, this is the
# one command to run — there is never a reason to drive the Paperpile web UI.
#
# Cookies are read from the BROWSER-level CDP target via Storage.getCookies,
# not from a page target. Page targets route through a renderer, and a wedged
# tab (a playing YouTube tab reproduces this) never answers Network.getCookies —
# which used to hang this script forever, since it attached to whichever page
# happened to be listed first. The browser target has no renderer to wedge.
set -euo pipefail

PORT="${1:-9222}"
BASE="http://localhost:${PORT}"

if ! curl -sf --connect-timeout 2 "${BASE}/json/version" >/dev/null; then
  echo "error: no CDP browser on :${PORT} (Dia on macOS, Chromium on Linux)." >&2
  echo "       Bring it up (browser-automation skill) and retry." >&2
  exit 1
fi

TMP="$(mktemp -t pp_cookies.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT

OUT="$TMP" CDP_BASE="$BASE" node - <<'NODE'
const base = process.env.CDP_BASE;

// Browser-level target: immune to a wedged page renderer.
const ver = await (await fetch(`${base}/json/version`)).json();
if (!ver.webSocketDebuggerUrl) {
  console.error('error: CDP gave no browser-level webSocketDebuggerUrl');
  process.exit(1);
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);

let nextId = 1;
const cmd = (method, params = {}) => {
  const id = nextId++;
  return new Promise((res, rej) => {
    // Never wait forever: a hang here is what this script is fixing.
    const timer = setTimeout(() => rej(new Error(`timed out waiting for ${method}`)), 10000);
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', h);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });
};

const fail = (msg, code) => { console.error(msg); try { ws.close(); } catch {} process.exit(code); };

await new Promise((r, j) => {
  ws.addEventListener('open', r);
  ws.addEventListener('error', () => j(new Error('CDP websocket failed')));
});

let all;
try {
  ({ cookies: all } = await cmd('Storage.getCookies'));
} catch (e) {
  fail(`error: could not read cookies over CDP — ${e.message}`, 1);
}

const cookies = all.filter((c) => /(^|\.)paperpile\.com$/.test(c.domain));
if (!cookies.some((c) => c.name === 'plack_session')) {
  fail('error: no Paperpile session cookie found — log into Paperpile in the browser first.', 2);
}

const ss = { None: 'no_restriction', Lax: 'lax', Strict: 'strict' };
const out = cookies.map((c) => ({
  domain: c.domain, name: c.name, value: c.value, path: c.path || '/',
  secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: ss[c.sameSite] || 'no_restriction',
  expirationDate: (c.expires && c.expires > 0) ? c.expires : undefined,
  hostOnly: !c.domain.startsWith('.'), session: !(c.expires && c.expires > 0), storeId: null,
}));
(await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.error(`extracted ${out.length} cookies`);
ws.close();
process.exit(0);
NODE

paperpile auth import "$TMP"
paperpile auth
