#!/usr/bin/env bash
# Refresh UVA institutional sessions by hitting proxied URLs via Dia CDP.
# Warms up: EZproxy + HeinOnline (via WAYFless SSO).
# If SSO expired, auto-clicks "Log in with your digital certificate".
# Hammerspoon cert-autoaccept handles the macOS keychain dialog.
#
# launchd: com.paperpile.warmup.plist (every 25 min)

set -euo pipefail

CDP=http://localhost:9222

if ! curl -sf --connect-timeout 2 "$CDP/json/version" >/dev/null; then
  echo "[warmup] Dia CDP not on :9222" >&2
  exit 1
fi

# Helper: open tab, navigate, handle SSO if needed, close tab
warmup_url() {
  local label="$1"
  local url="$2"

  local TAB
  TAB=$(curl -sf -X PUT "$CDP/json/new" 2>/dev/null) || { echo "[$label] failed to open tab"; return 1; }
  local WS_URL TAB_ID
  WS_URL=$(echo "$TAB" | python3 -c "import json,sys; print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
  TAB_ID=$(echo "$TAB" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

  bun -e "
const ws = new WebSocket('$WS_URL');
let id = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    const timer = setTimeout(() => reject('timeout'), 20000);
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) { clearTimeout(timer); ws.removeEventListener('message', handler); resolve(msg); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onopen = async () => {
  try {
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Page.navigate', { url: '$url' });
    await new Promise(r => setTimeout(r, 6000));

    const loc = await call('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const u = loc?.result?.result?.value || '';
    console.error('[$label] landed: ' + u.slice(0, 80));

    if (u.includes('shibidp.its.virginia.edu')) {
      await call('Runtime.evaluate', {
        expression: '(() => { for (const b of document.querySelectorAll(\"button\")) if (b.textContent.includes(\"digital certificate\")) { b.click(); return true; } return false; })()',
        returnByValue: true
      });
      console.error('[$label] clicked cert login');
      await new Promise(r => setTimeout(r, 8000));
      const fin = await call('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
      console.error('[$label] final: ' + (fin?.result?.result?.value || '').slice(0, 80));
    } else {
      console.error('[$label] session alive');
    }
  } catch (e) { console.error('[$label] error: ' + e); }
  finally { ws.close(); process.exit(0); }
};
ws.onerror = () => { console.error('[$label] ws error'); process.exit(1); };
" 2>&1

  curl -sf "$CDP/json/close/$TAB_ID" >/dev/null 2>&1 || true
}

# 1. EZproxy warmup
echo "[warmup] === EZproxy ==="
warmup_url "ezproxy" "https://proxy1.library.virginia.edu/login?url=https://www.virginia.edu/"

# 2. Clear stale OpenAthens state_ cookies (they accumulate and cause HTTP 431)
echo "[warmup] === Clear OpenAthens cookies ==="
OA_TAB=$(curl -sf -X PUT "$CDP/json/new" 2>/dev/null) || true
OA_TAB_ID=$(echo "$OA_TAB" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null) || true
OA_WS=$(echo "$OA_TAB" | python3 -c "import json,sys; print(json.load(sys.stdin)['webSocketDebuggerUrl'])" 2>/dev/null) || true
if [ -n "$OA_WS" ]; then
  bun -e "
const ws = new WebSocket('$OA_WS');
let id = 0;
function call(m, p={}) { return new Promise((res,rej)=>{const i=++id;const t=setTimeout(()=>rej('to'),5000);ws.addEventListener('message',function h(ev){const msg=JSON.parse(ev.data);if(msg.id===i){clearTimeout(t);ws.removeEventListener('message',h);res(msg);}});ws.send(JSON.stringify({id:i,method:m,params:p}));}); }
ws.onopen = async () => {
  try {
    await call('Network.enable');
    const r = await call('Network.getCookies', { urls: ['https://connect.openathens.net'] });
    const cookies = r.result?.cookies || [];
    let n = 0;
    for (const c of cookies) {
      if (c.name.startsWith('state_')) {
        await call('Network.deleteCookies', { name: c.name, domain: c.domain || 'connect.openathens.net', path: c.path || '/' });
        n++;
      }
    }
    console.error('[openathens] cleared ' + n + ' stale cookies');
  } catch (e) { console.error('[openathens] error: ' + e); }
  finally { ws.close(); process.exit(0); }
};
" 2>&1
  curl -sf "$CDP/json/close/$OA_TAB_ID" >/dev/null 2>&1 || true
fi

# 3. HeinOnline WAYFless SSO warmup
echo "[warmup] === HeinOnline ==="
HEIN_ENTITY="https://shibidp.its.virginia.edu/shibboleth"
HEIN_TARGET="https://heinonline.org/HOL/Welcome"
HEIN_URL="https://heinonline.org/HOL/WAYFless?entityID=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$HEIN_ENTITY'))")&target=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$HEIN_TARGET'))")"
warmup_url "heinonline" "$HEIN_URL"

echo "[warmup] done"
