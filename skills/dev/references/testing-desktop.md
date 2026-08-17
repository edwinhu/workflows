# Testing desktop and native behaviour

Applies the evidence rules in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/tdd.md` to Electron,
Linux (Wayland/X11) and macOS apps.

## The sequence every desktop test follows

A GUI process can be launched, be dead, and still leave a screenshot tool happy. Run these five
steps in order; the assertion is only trustworthy because the four before it ran.

1. **Launch** with stdout+stderr redirected to a file — never to a pipe you don't read.
2. **Wait for readiness** by polling the thing you're about to drive (CDP port, window, D-Bus name)
   with a bounded timeout. Never `sleep`.
3. **Check the process** is still alive by saved PID.
4. **Read the whole log** and confirm it holds no startup failure. Startup crashes appear here and
   nowhere else — a renderer that never loaded still returns an empty DOM, not an error.
5. **Assert on what the user sees**, then capture artifacts.

Stop by the saved PID (`kill "$APP_PID"`), not `pkill -f`: `-f` matches the killing command line too.

```bash
APP_LOG=/tmp/app.log
"$APP_BIN" --remote-debugging-port=9222 --enable-logging --log-file="$APP_LOG" >>"$APP_LOG" 2>&1 &
APP_PID=$!
timeout 30 sh -c 'until curl -sf http://127.0.0.1:9222/json/version >/dev/null; do sleep 0.25; done'
kill -0 "$APP_PID" || { cat "$APP_LOG"; exit 1; }
cat "$APP_LOG"
grep -qiE 'fatal|uncaught exception|segmentation fault|core dumped' "$APP_LOG" && exit 1
```

Poll `/json/version`, not `/json/list`: background targets appear in the target list before any real
window does.

## Electron

Requires `curl`, `jq`, and `websocat` (or `wscat`). Missing tooling is a full stop, not a reason to
assert from source.

**An Electron app has two processes and both can fail.** The renderer is reachable over CDP by
default; the main process only if launched under `--inspect`. Renderer-only testing cannot see main
crashes, IPC failures, native-dialog bugs, or file-I/O errors.

```bash
NODE_OPTIONS="--inspect=5858" "$APP_BIN" --remote-debugging-port=9222 --enable-logging --log-file=/tmp/electron.log &
RENDERER_WS=$(curl -s http://127.0.0.1:9222/json/list | jq -r '.[] | select(.type=="page")  | .webSocketDebuggerUrl' | head -1)
MAIN_WS=$(    curl -s http://127.0.0.1:9222/json/list | jq -r '.[] | select(.type=="node")  | .webSocketDebuggerUrl' | head -1)
```

Enable a domain before using it (`Runtime.enable`, `Page.enable`, `DOM.enable`, `Network.enable`);
otherwise the command comes back `{"error":{"code":-32601}}`.

Every CDP command must be read back. Sending it is not evidence: a response can carry `.error`, or a
`.result.exceptionDetails` for JavaScript that threw, and both look like success if you ignore them.

```bash
cdp() {  # cdp <ws-url> <id> <json-params-object> ; prints the value, non-zero on failure
  local resp; resp=$(echo "{\"id\":$2,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":$(jq -Rs . <<<"$3"),\"returnByValue\":true,\"awaitPromise\":true}}" \
    | websocat --one-message "$1")
  jq -e '.error // .result.exceptionDetails' <<<"$resp" >/dev/null && { echo "$resp" >&2; return 1; }
  jq -r '.result.result.value' <<<"$resp"
}

cdp "$MAIN_WS"     1 'require("electron").app.getVersion()'
cdp "$RENDERER_WS" 2 'document.querySelector(".status-text").textContent'
```

Assert on what the panel displays, not on internal state. Drive the UI the way the user does —
`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`, or a real `.click()` — never by calling the
handler function directly, which exercises a code path production never enters.

**Use the transport production uses.** Electron features commonly ride WebSocket or IPC; a test that
hits an HTTP stand-in passes while the shipped path is broken. Find the transport before writing the
test (`rg 'WebSocket|ws://|ipcRenderer|ipcMain' --type ts`), then exercise that one.

| Feature under test | Real test |
|---|---|
| IPC `invoke`/`handle` | `Runtime.evaluate` the `ipcRenderer.invoke(...)` with `awaitPromise:true`, assert the resolved value |
| IPC push (main → renderer) | install an `ipcRenderer.on` collector, trigger, then read the collected array back |
| Native menu item | trigger via its accelerator (`Input.dispatchKeyEvent` with the modifier bitmask: alt 1, ctrl 2, meta 4, shift 8) and assert the resulting document state |
| File dialog | a real dialog blocks automation — have main return a fixed path under a test env var, and assert on what the app does with the path |
| Second window | re-list targets and select by `.url` or `.title`, then assert in that window's context |
| Renderer console errors | `Runtime.enable`, collect `Runtime.consoleAPICalled` events, assert the error list is empty |

On Linux CI with no display, run the app under `Xvfb :99 -screen 0 1920x1080x24 &` with
`DISPLAY=:99`; the sequence above is otherwise unchanged.

## Linux native (GTK/Qt, Wayland or X11)

Detect the display server first — assuming Wayland breaks every X11 machine.

```bash
if [ "$XDG_SESSION_TYPE" = wayland ]; then
  ydotool type "hello"; ydotool key 28:1 28:0     # 1=Esc 14=Bksp 15=Tab 28=Enter 29=Ctrl 42=LShift 56=Alt 57=Space
  wtype -M ctrl -k l                              # wtype is the friendlier Wayland alternative
  grim /tmp/shot.png
else
  xdotool search --name "MyApp" windowactivate --sync
  xdotool type "hello"; xdotool key ctrl+s
  scrot -u /tmp/shot.png
fi
```

`ydotool` needs its daemon (`systemctl --user enable --now ydotool`). Tool checks (`which ydotool
wtype grim xdotool scrot dbus-send`) belong before the test, not inside it.

Prefer an interface over synthetic input where the app exposes one — it asserts state instead of
inferring it from pixels:

```bash
dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
  org.freedesktop.DBus.ListNames                     # is the app's name on the bus at all?
dbus-send --session --print-reply --dest=org.example.App /org/example/App \
  org.freedesktop.DBus.Introspectable.Introspect     # what can be called and asserted
```

AT-SPI (`pyatspi`) reaches widget roles, names and enabled state, and can invoke a control through
`queryAction().doAction(0)` — that is a readable assertion target. `xdotool getactivewindow
getwindowname` and clipboard read-back (`xclip -selection clipboard -o`, `wl-paste`) are the cheapest
user-facing assertions available.

## macOS native (Hammerspoon)

`hs` is the CLI (`/opt/homebrew/bin/hs`), enabled by `require("hs.ipc")` in `~/.hammerspoon/init.lua`
plus Accessibility permission. It drives native apps that no browser tool can reach.

Readiness is `hs.timer.waitUntil` on the app existing, not a `usleep` guess:

```lua
hs.application.launchOrFocus("TextEdit")
hs.timer.waitUntil(function() return hs.application.get("TextEdit") ~= nil end,
                   function() end, 0.2)
local app = hs.application.get("TextEdit"); assert(app, "FAIL: did not launch")
hs.eventtap.keyStrokes("automated test")
hs.eventtap.keyStroke({"cmd"}, "a"); hs.eventtap.keyStroke({"cmd"}, "c")
assert(hs.pasteboard.getContents():find("automated test"), "FAIL: clipboard mismatch")
hs.window.focusedWindow():snapshot():saveToFile("/tmp/test_result.png")
```

Run it as a test so the shell sees a verdict — the script must `os.exit(1)` on failure:

```bash
hs /path/to/test_workflow.lua   # exit code is the result; wrap the body in pcall and os.exit
```

Assertable state without screenshots: `hs.pasteboard.getContents()`, `win:title()`, `win:frame()`,
`app:findMenuItem({"File","Save"}).enabled`, `app:isRunning()`. `cliclick` covers bare
click/type/keypress but has no app or window model — prefer Hammerspoon whenever the assertion needs
one.

## What counts as evidence

Behavioural: a value read back out of the running app after a real interaction — DOM text or an
`ipcRenderer.invoke` return over CDP, a clipboard or window title, a D-Bus property, an AT-SPI node's
state, an empty renderer console-error list, the exit code of a script that asserts one of these.

Not behavioural:

- a screenshot on its own. It proves a render happened, not that it is right; nothing in it fails.
  Attach one as an artifact and assert on something else. Comparing two screenshots' *file sizes* is
  not an assertion either.
- "the process is running" — step 3 of the sequence, not the conclusion of it
- a log line merely existing, without reading the log for startup failures
- a direct call to the handler behind the button, or a check of internal state the user never sees
- an HTTP probe of a feature that ships over WebSocket or IPC
- a renderer-only pass reported as whole-app health
