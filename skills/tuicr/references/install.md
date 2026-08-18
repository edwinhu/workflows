# tuicr — Installation & Launcher

## Install (nixpkgs)

tuicr ships in nixpkgs, so no custom Nix module is needed (unlike revdiff, which was a
`fetchurl` derivation). It is declared in `~/nix/modules/shared/packages.nix` (`tuicr`) and
installed by the normal rebuild:

```bash
cd ~/nix && nix run .#build-switch
```

Verify:

```bash
command -v tuicr && tuicr --version   # → tuicr 0.18.0 (or newer)
```

### One-off / before it's installed

```bash
TUICR=$(nix build --no-link --print-out-paths nixpkgs#tuicr)/bin/tuicr
"$TUICR" --version
# or simply:  nix run nixpkgs#tuicr -- --version
```

The launcher resolves tuicr via `command -v tuicr`, so once it's on PATH nothing else is needed.

## The launcher

`scripts/launch-tuicr.sh <tuicr args…>` opens tuicr in **a new herdr tab**, blocks until you quit,
and prints `TUICR_RC=<exit code>`.

Why a launcher at all: tuicr is a full-screen TUI that needs a real controlling TTY. Running it
inline from a tool call — or via the `!` prefix — fails with `No such device or address
(os error 6)`. A herdr pane is a real PTY, so it gives tuicr the terminal it needs.

### How the herdr path works

```bash
herdr tab create --cwd "$PWD" --label tuicr --no-focus  # → .result.root_pane.pane_id
herdr pane run <pane_id> "<one quoted command line>"    # types + submits it in the pane's shell
herdr tab focus <tab_id>                                # only once tuicr has painted
```

Four things to know:

- `herdr pane run` joins its `COMMAND` words with spaces and types the result into the shell — it
  does **not** preserve per-argument quoting. Pass the whole pipeline as *one* already-quoted
  argument (the launcher builds it with a `sq()` shell-quoting helper).
- The pane's shell isn't ready the instant the tab appears, so the launcher polls
  `herdr pane process-info --pane <id>` for a `shell_pid` before running.
- Blocking is a sentinel file the wrapped command writes atomically when tuicr exits; the launcher
  then closes the review tab.
- **Deferred focus** is what makes it feel instant. `tab.create` takes only
  `cwd`/`env`/`focus`/`label`/`workspace_id` — there is no `command` param — so the pane always
  starts as a bare shell. Focusing immediately would park the user on an empty prompt for the whole
  fetch. Instead the tab is created `--no-focus`, the launcher polls `herdr pane read` for tuicr's
  first box-drawing border (capped ~10s, and skipped if the sentinel already exists because tuicr
  died on startup), then calls `herdr tab focus`.

Measured on `pr 27`: `tab create` 8ms, shell-ready poll 4ms, `pane run` 2ms, tuicr process up
~110ms, **diff painted ~1.4s** (GitHub fetch — not herdr overhead), `tab focus` 4ms. The launcher
itself costs ~15ms; deferred focus hides the rest.

### Why herdr (don't re-try ghostty-first or limux)

Reminder so this isn't re-litigated:

- **ghostty** worked but can't be assumed present on every host, and its window placement also
  needed Hyprland + `jq`. It's now only the fallback.
- **limux**: `limux new-workspace --command` doesn't run the command, and `limux send` can't
  *submit* the typed line (atuin/ble.sh eat the injected Enter). herdr's socket API submits for you.

### ghostty fallback

If no herdr server is reachable (`herdr tab list` fails) or `jq` is missing, the launcher falls back
to `ghostty -e` in its own window. On Hyprland it finds that window (by diffing the ghostty window
set before/after — `--class` doesn't stick and the `sh -c` wrapper makes the title "sh") and runs
`movetoworkspacesilent special:scratchpad`, then reveals the scratchpad (**Super+S**).

Launcher exit codes: `1` = tuicr not on PATH, `2` = no herdr server *and* no ghostty.

`scripts/resolve-session.sh [PR# | --all]` prints the slug of the newest matching persisted session
so the agent can read/write it after the window closes.
