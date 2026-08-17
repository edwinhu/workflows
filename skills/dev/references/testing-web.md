# Testing web and browser behaviour

Applies the evidence rules in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/tdd.md` to a browser.

## Choose the tool by what the evidence has to survive

| | CDP MCP tools | Playwright library |
|---|---|---|
| Where | `mcp__chrome-devtools__*` (Chromium, port 9222, the logged-in browser); `mcp__cdp-headless__*` (headless, port 9250) | project-local `npm install -D playwright` |
| Re-runnable by someone else | no — a live session | yes — a committed file |
| Usable as a `redCommand` | no | yes |
| Console, network, page JS | yes | yes (`page.on('console')`, `page.on('response')`, `page.evaluate`) |
| Logged-in session, real profile | yes | no (fresh context per run) |

**A task's evidence is a Playwright test.** CDP MCP is for diagnosis, for one-off checks against a
site you are already authenticated to, and for driving the user's own browser — none of which a
verifier can re-run. Reaching for the MCP tools because the browser is already open produces a claim
with no artifact behind it.

Both MCP servers attach to their port at session start; a port revived mid-session does not
retro-connect. See `${CLAUDE_PLUGIN_ROOT}/skills/browser-automation/SKILL.md`.

## Launch, then wait for readiness — never sleep

Poll the thing you are about to test until it answers, with a bounded timeout, then confirm the
process is alive and read its whole log before asserting anything.

Substitute the project's own start command and port for the first two lines:

```bash
python3 -m http.server 8137 --directory /tmp >/tmp/app.log 2>&1 &
APP_PID=$!
timeout 30 sh -c 'until curl -sf -o /dev/null http://127.0.0.1:8137/; do sleep 0.25; done'
kill -0 "$APP_PID"        # still up?
cat /tmp/app.log          # startup failures hide here, not in the DOM
```

Stop by the saved PID (`kill "$APP_PID"`), not `pkill -f`: `-f` matches the killing command line too.

Need your own browser rather than the user's:

```bash
chromium --headless=new --remote-debugging-port=9251 --user-data-dir=/tmp/cdp-probe about:blank >/tmp/cdp.log 2>&1 &
CDP_PID=$!
timeout 20 sh -c 'until curl -sf http://127.0.0.1:9251/json/version >/dev/null; do sleep 0.2; done'
curl -s http://127.0.0.1:9251/json/version | jq -r .Browser
kill "$CDP_PID"
```

Readiness-poll `/json/version`, not `/json/list` — extension background pages appear in the target
list before any real tab does.

Check the standing ports before launching anything:

```bash
for p in 9222 9250; do
  echo -n "$p: "
  curl -s --connect-timeout 1 "http://127.0.0.1:$p/json/version" | jq -r '.Browser // "down"' || echo down
done
```

## The Playwright test

```bash
mkdir -p /tmp/pw-probe && cd /tmp/pw-probe
npm install -D playwright
npx playwright install chromium
```

Capture console and failed responses on every run — a page that renders correctly while throwing is
a defect the assertion alone will not see.

```javascript
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [], failures = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
page.on('requestfailed', r => failures.push(`${r.method()} ${r.url()}`));
page.on('response', r => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });

await page.goto('http://127.0.0.1:3000/');
await page.click('#go');
await page.waitForSelector('#out:has-text("done")');   // wait on the outcome, never a timeout
console.log(await page.textContent('#out'), logs, failures);
await browser.close();
```

Wait on the expected state (`waitForSelector`, `waitForResponse`), never on a duration. A fixed sleep
turns a real failure into a flake and a race into a pass.

## What counts as evidence

Behavioural: the assertion that fails when the feature is removed — asserted text or DOM state after
the real interaction, a response body or status read from the network, a value read back out of
`localStorage`/app state via `page.evaluate`, an empty console-error list.

Not behavioural:

- a screenshot on its own. It proves a render happened, not that it is right; nothing in it fails.
  Attach one as an artifact, assert on something else. It earns its keep only against a committed
  baseline (`expect(page).toHaveScreenshot()`), which is an assertion, not a picture.
- an accessibility snapshot or page text you read and judged by eye
- an API response inferred from the handler source instead of read off the wire
- "I clicked it and it worked" — no run, no artifact, no re-execution
- exit code 0 from the dev server, or a log line merely existing
