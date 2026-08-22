---
name: marimo-serve
description: "Use when several marimo notebooks should be reachable at once rather than one `marimo run` per file — 'serve my notebooks', 'host the marimo apps', 'run all the notebooks', 'give me a URL for these notebooks', 'share these dashboards', 'put this on the LAN', 'expose marimo on the tailnet', 'JupyterLab-but-for-marimo', 'let my coauthor click through these'. Also covers the editor-on-a-directory case. NOT for authoring or debugging one notebook (marimo) and NOT for pairing on a live kernel (marimo-pair)."
user-invocable: true
---

# marimo-serve

Runs one uvicorn process that auto-mounts every `*.py` notebook in a directory under `http://host:port/<mount>/<stem>`. Add or remove files — the URL list updates without restart. This is marimo's closest equivalent to "JupyterLab for many notebooks."

**Default is read-only Run mode.** Pass `--edit` to launch `marimo edit DIRECTORY --watch` instead (full editor, saves on disk; picks up external `.py` edits without restart).

## Quick usage

```bash
# Read-only Run mode (default)
pixi run python ${CLAUDE_SKILL_DIR}/scripts/serve.py [DIRECTORY] \
    [--host 127.0.0.1] [--port 2718] [--mount /<project>] [--include-code]

# Edit mode — launches marimo's built-in multi-session editor
pixi run python ${CLAUDE_SKILL_DIR}/scripts/serve.py [DIRECTORY] --edit \
    [--host 127.0.0.1] [--port 2718]
```

Defaults:
- `DIRECTORY` = `./notebooks`
- Bind = `127.0.0.1:2718`
- Mode = **read-only Run mode**. Users interact with UI widgets and see outputs but cannot edit cells. `marimo.create_asgi_app()` only supports Run mode.
- Mount = `/<project>` (the parent directory's name — e.g. running from `~/projects/mirror` with `./notebooks` → `/mirror/<stem>`). marimo requires a non-empty prefix; pass `--mount` to override. **Run mode only** — edit mode serves at `/`.
- Source code hidden (`--include-code` to reveal; read-only regardless)

## Expose on tailnet

Keep the server on `127.0.0.1` and let Tailscale Serve handle the tailnet + HTTPS. Because marimo requires a non-empty mount prefix (`/apps`), the upstream URL **must include the same prefix** or tailscale will strip it and marimo returns 404:

```bash
# mounts /<project> on the tailnet AND forwards /<project> upstream (path preserved)
tailscale serve --bg --https=443 --set-path=/<project> http://127.0.0.1:2718/<project>
# browse: https://<machine>.<tailnet>.ts.net/<project>/<notebook_stem>
tailscale serve status   # see active config
tailscale serve --https=443 --set-path=/<project> off   # remove just this path
tailscale serve reset    # tear down all paths
```

Use `--set-path` if `/` is already mapped to another service — tailscale serve supports multiple path prefixes on the same hostname.

### Service-worker conflict (separate port)

If an app already mapped at `/` (e.g. a PWA) registers a service worker with root scope, that SW will intercept requests to `/<project>/*` on the **same** origin and return its own cached shell — marimo never gets the request. Fix: put marimo on a different HTTPS port so it's a separate origin (SWs cannot cross origins):

```bash
tailscale serve --bg --https=8443 --set-path=/<project> http://127.0.0.1:2718/<project>
# browse: https://<machine>.<tailnet>.ts.net:8443/<project>/<notebook_stem>
```

`tailscale serve --https=443 off` removes ALL paths on :443 — use `--set-path=/<path> off` to remove a single prefix.

## Persistence (macOS launchd)

For always-on serving, wrap in `~/Library/LaunchAgents/com.user.marimo-serve.plist` pointing at the `serve.py` command with `KeepAlive=true`. Tailscale Serve config survives reboots automatically.

## Dependencies

Project must have `marimo` and `uvicorn` installed. With pixi:

```bash
pixi add marimo uvicorn
```

## When to use another approach

- **Editing, not serving**: pass `--edit` (this wraps `marimo edit <dir>`) or call `marimo edit <dir>` directly.
- **Fully static hosting (no Python)**: `marimo export html-wasm` → drop on any static host.
- **Single notebook, one-off**: `marimo run notebook.py` is simpler.

## Implementation notes

Run mode uses `marimo.create_asgi_app().with_dynamic_directory()` — the officially documented pattern for multi-notebook ASGI serving. Filenames starting with `_` are skipped (treat as private/helper modules). `create_asgi_app()`'s docstring states it "only works for application that are in Run mode" — that's why edit mode delegates to the `marimo edit` CLI (`os.execv`) instead.

Edit mode passes `--watch` by default so that edits made to the `.py` file from outside the browser (e.g. by an agent using Edit/Write) are picked up by the running session without a manual reload. This pairs with the marimo-pair skill: one agent edits the file on disk, the user (or another agent) runs cells in the browser.
