#!/usr/bin/env bash
# Launch tuicr (full-screen review TUI) in a NEW HERDR TAB and block until it exits.
#
# Why a separate tab: tuicr needs a real controlling TTY. Running it inline from a tool call — or
# via the `!` prefix — fails with "No such device or address (os error 6)". A herdr pane is a real
# PTY, so `herdr tab create` + `herdr pane run` gives tuicr the terminal it needs.
#
# Why herdr (not ghostty): ghostty is not guaranteed to be installed wherever this runs, and the
# ghostty path additionally needed Hyprland + jq to place the window. herdr is the terminal
# workspace we are already inside, its socket API works the same locally and over --remote, and the
# review lands one tab away. ghostty stays as a fallback for hosts with no running herdr server.
#
# tuicr persists the session to ~/.local/share/tuicr/reviews/sessions/*.json, so this launcher does
# NOT capture annotations from stdout. After it returns, read them with `tuicr review comments`.
#
# usage:  launch-tuicr.sh <tuicr args...>
#   e.g.  launch-tuicr.sh pr 70 --no-update-check
#         launch-tuicr.sh -w --no-update-check
#         launch-tuicr.sh --file docs/plan.md --no-update-check
#
# output: a single line  TUICR_RC=<n>  (tuicr's exit code; 0 = clean quit)
set -euo pipefail

TUICR_BIN=$(command -v tuicr 2>/dev/null || true)
if [ -z "$TUICR_BIN" ]; then
    echo "error: tuicr not found in PATH." >&2
    echo "install: add 'tuicr' to ~/nix/modules/shared/packages.nix and rebuild, or 'nix run nixpkgs#tuicr --'." >&2
    exit 1
fi

TMPBASE="${TMPDIR:-/tmp}"
CWD="$(pwd)"
SENTINEL=$(mktemp "$TMPBASE/tuicr-done-XXXXXX"); rm -f "$SENTINEL"
trap 'rm -f "$SENTINEL" "$SENTINEL.tmp"' EXIT

# shell-quote one arg for safe embedding in the command line the tuicr host shell will run.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
INNER="cd $(sq "$CWD") && $(sq "$TUICR_BIN")"
for arg in "$@"; do
    INNER="$INNER $(sq "$arg")"
done
# capture tuicr's exit code to a sentinel (atomic write) so we can report it after the tab closes.
INNER="$INNER; rc=\$?; printf '%s' \"\$rc\" > $(sq "$SENTINEL").tmp && mv -f $(sq "$SENTINEL").tmp $(sq "$SENTINEL")"

# block until the wrapper writes the sentinel (tuicr quit), then report the exit code.
wait_and_report() {
    while [ ! -f "$SENTINEL" ]; do
        sleep 0.3
    done
    local rc
    rc=$(cat "$SENTINEL" 2>/dev/null || echo 1)
    echo "TUICR_RC=${rc:-1}"
}

# ------------------------------------------------------------------ herdr (preferred)
launch_via_herdr() {
    local herdr created tab_id pane_id
    herdr=$(command -v herdr 2>/dev/null || true)
    [ -n "$herdr" ] || return 1
    command -v jq >/dev/null 2>&1 || return 1
    # no running server → the socket API calls would fail; fall back instead.
    "$herdr" tab list >/dev/null 2>&1 || return 1

    # created UNFOCUSED on purpose: tuicr needs ~1.4s to fetch + paint, and `tab.create` has no
    # command param, so a focused tab would show a bare shell prompt for that whole time. We focus
    # only once the diff is on screen, so the user's first sight of the tab is the rendered review.
    local ws_args=()
    [ -n "${HERDR_WORKSPACE_ID:-}" ] && ws_args=(--workspace "$HERDR_WORKSPACE_ID")
    created=$("$herdr" tab create "${ws_args[@]}" --cwd "$CWD" --label tuicr --no-focus 2>/dev/null || true)
    tab_id=$(printf '%s' "$created" | jq -r '.result.tab.tab_id // empty' 2>/dev/null || true)
    pane_id=$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id // empty' 2>/dev/null || true)
    if [ -z "$pane_id" ]; then
        [ -n "$tab_id" ] && "$herdr" tab close "$tab_id" >/dev/null 2>&1
        return 1
    fi

    # the pane's shell may not be ready the instant the tab appears; wait for its pid.
    for _ in $(seq 1 25); do
        "$herdr" pane process-info --pane "$pane_id" 2>/dev/null \
            | jq -e '.result.process_info.shell_pid' >/dev/null 2>&1 && break
        sleep 0.2
    done

    # `pane run` joins its COMMAND words with spaces and types the result into the pane's shell, so
    # the whole pipeline must be handed over as ONE already-quoted argument.
    "$herdr" pane run "$pane_id" "$INNER" >/dev/null 2>&1 || true

    # Wait for tuicr to paint its first frame (box-drawing border), then reveal the tab. Capped at
    # ~10s, and we bail early if the sentinel already exists (tuicr died on startup). On timeout we
    # focus anyway — better a visibly-loading tab than a review the user never sees.
    for _ in $(seq 1 100); do
        [ -f "$SENTINEL" ] && break
        "$herdr" pane read "$pane_id" 2>/dev/null | grep -q '┌' && break
        sleep 0.1
    done
    [ -f "$SENTINEL" ] || "$herdr" tab focus "$tab_id" >/dev/null 2>&1 || true

    wait_and_report
    "$herdr" tab close "$tab_id" >/dev/null 2>&1 || true
    return 0
}

# ------------------------------------------------------------------ ghostty (fallback)
launch_via_ghostty() {
    local ghostty hypr=0 before="" addr="" shown=""
    ghostty=$(command -v ghostty 2>/dev/null || true)
    if [ -z "$ghostty" ]; then
        echo "error: no reachable herdr server and ghostty not found in PATH." >&2
        echo "start herdr (run 'herdr'), or install ghostty, then retry." >&2
        exit 2
    fi

    # On Hyprland (omarchy): drop the review window into the existing `special:scratchpad` workspace
    # and reveal it (Super+S toggles it, so it never traps focus). ghostty ignores --class here and
    # the `sh -c` wrapper makes the title "sh", so match by diffing the ghostty window set instead.
    if command -v hyprctl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then hypr=1; fi
    ghostty_addrs() {
        hyprctl clients -j 2>/dev/null \
            | jq -r '.[] | select(.class=="com.mitchellh.ghostty") | .address' 2>/dev/null || true
    }
    [ "$hypr" = 1 ] && before=$(ghostty_addrs)

    # setsid detaches it from this script's session so it survives and owns its window; the sentinel
    # (not this PID) is what we wait on.
    setsid "$ghostty" --class=tuicr-review -e sh -c "$INNER" >/dev/null 2>&1 &

    if [ "$hypr" = 1 ]; then
        for _ in $(seq 1 25); do
            addr=$(comm -13 <(printf '%s\n' "$before" | sort -u) <(ghostty_addrs | sort -u) 2>/dev/null | head -1)
            [ -n "$addr" ] && break
            sleep 0.4
        done
        if [ -n "$addr" ]; then
            hyprctl dispatch movetoworkspacesilent "special:scratchpad,address:$addr" >/dev/null 2>&1 || true
            shown=$(hyprctl monitors -j 2>/dev/null | jq -r 'first(.[] | select(.focused)) | .specialWorkspace.name // ""' 2>/dev/null || true)
            [ "$shown" != "special:scratchpad" ] && hyprctl dispatch togglespecialworkspace scratchpad >/dev/null 2>&1 || true
            hyprctl dispatch focuswindow "address:$addr" >/dev/null 2>&1 || true
        fi
    fi

    wait_and_report
}

launch_via_herdr || launch_via_ghostty
exit 0
