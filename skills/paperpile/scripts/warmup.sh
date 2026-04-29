#!/usr/bin/env bash
# Refresh UVA EZproxy session by hitting a proxied URL via Dia CDP.
# If the session expired, auto-clicks "Log in with your digital certificate"
# (Hammerspoon cert-autoaccept handles the keychain dialog).
#
# Cron this every 25 min to defeat the 30-min idle timeout.

set -euo pipefail

CDP=http://localhost:9222
PROXY_URL="https://proxy1.library.virginia.edu/login?url=https://www.virginia.edu/"

if ! curl -sf --connect-timeout 2 "$CDP/json/version" >/dev/null; then
  echo "[warmup] Dia CDP not on :9222" >&2
  exit 1
fi

# Open a new tab and navigate to the proxy URL
TAB=$(curl -sf -X PUT "$CDP/json/new" 2>/dev/null)
if [ -z "$TAB" ]; then
  echo "[warmup] failed to open new tab" >&2
  exit 1
fi
WS_URL=$(echo "$TAB" | python3 -c "import json,sys; print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
TAB_ID=$(echo "$TAB" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

cleanup() { curl -sf "$CDP/json/close/$TAB_ID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Use bun to drive the WebSocket (simpler than Python websockets for a one-shot)
bun -e "
const ws = new WebSocket('$WS_URL');
let id = 0;
const next = () => ++id;

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = next();
    const timer = setTimeout(() => reject('timeout'), 15000);
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(msg);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onopen = async () => {
  try {
    await call('Page.enable');
    await call('Page.navigate', { url: '$PROXY_URL' });

    // Wait for page to settle
    await new Promise(r => setTimeout(r, 5000));

    // Check where we ended up
    const loc = await call('Runtime.evaluate', {
      expression: 'location.href', returnByValue: true
    });
    const url = loc?.result?.result?.value || '';
    console.error('[warmup] landed on: ' + url.slice(0, 80));

    // If we're on the NetBadge SSO page, click the cert login button
    if (url.includes('shibidp.its.virginia.edu')) {
      const clicked = await call('Runtime.evaluate', {
        expression: \`
          (() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
              if (b.textContent.includes('digital certificate')) {
                b.click();
                return true;
              }
            }
            return false;
          })()
        \`,
        returnByValue: true
      });
      if (clicked?.result?.result?.value) {
        console.error('[warmup] clicked cert login button');
        await new Promise(r => setTimeout(r, 5000));
        const final = await call('Runtime.evaluate', {
          expression: 'location.href', returnByValue: true
        });
        console.error('[warmup] final: ' + (final?.result?.result?.value || '').slice(0, 80));
      } else {
        console.error('[warmup] cert login button not found');
      }
    } else if (url.includes('proxy1.library.virginia.edu') || url.includes('virginia.edu')) {
      console.error('[warmup] session still alive');
    } else {
      console.error('[warmup] unexpected page: ' + url);
    }
  } catch (e) {
    console.error('[warmup] error: ' + e);
  } finally {
    ws.close();
    process.exit(0);
  }
};
ws.onerror = () => { console.error('[warmup] ws error'); process.exit(1); };
" 2>&1 | sed 's/^/[warmup] /'
