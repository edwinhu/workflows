#!/usr/bin/env bash
# sandbox.sh — the throwaway sandbox a farm.sh `sandbox: true` row runs its shell commands in.
#
#   sandbox.sh hold CWD TMP          exec the holder (farm.sh backgrounds it, bwrap --info-fd on fd 3):
#                                    / read-only; $HOME, CWD and the external target of every symlink
#                                    in CWD (data/ -> external storage) as overlays whose writes land in
#                                    a tmpfs; /tmp a fresh tmpfs with TMP bound through read-write; no
#                                    network. Killing the holder discards every write.
#   sandbox.sh '<command>'           CLAUDE_CODE_SHELL_PREFIX: run the command inside the holder
#                                    FARM_SANDBOX_PID names. No live sandbox -> exit 126, nothing runs.
#   sandbox.sh agent NAME FILE OUT   write the --agents JSON for NAME-sandboxed: FILE's prompt and
#                                    frontmatter, its tools minus every writer, plus Bash.
#
# One holder per row, entered per command, because Claude Code spawns a shell per Bash call and a
# test's outputs must still be there for the next call to read. The prefix also wraps hooks; they run
# sandboxed too, which fails closed rather than guessing which invocation is a Bash call.
set -uo pipefail

die() { printf 'sandbox.sh: %s\n' "$*" >&2; exit "${2:-126}"; }

WRITERS='["Edit","Write","NotebookEdit","MultiEdit","mcp__ide__openDiff"]'

case "${1:-}" in
  hold)
    [ $# -eq 3 ] || die "usage: sandbox.sh hold CWD TMP" 2
    cwd=$(realpath -e -- "$2") || die "hold: no such directory $2" 2
    tmp=$(realpath -e -- "$3") || die "hold: no such directory $3" 2
    declare -a lowers=("$HOME" "$cwd")
    # The outputs a reviewer verifies live where data/ points, outside the tree and outside git.
    while IFS= read -r -d '' l; do
      t=$(realpath -e -- "$l" 2>/dev/null) || continue
      [ -d "$t" ] || t=$(dirname -- "$t")
      lowers+=("$t")
    done < <(find "$cwd" -maxdepth 2 -type l -print0 2>/dev/null)
    # Parents first; drop a path a kept overlay already covers. An overlay does not descend into
    # another filesystem, so a nested path on a different device keeps its own.
    declare -a keep=()
    while IFS= read -r p; do
      [ "$p" = / ] && continue
      covered=0
      for k in "${keep[@]:-}"; do
        [ -n "$k" ] || continue
        case "$p/" in "$k"/*) [ "$(stat -c %d -- "$p")" = "$(stat -c %d -- "$k")" ] && covered=1 ;; esac
      done
      [ "$covered" = 1 ] || keep+=("$p")
    # sort -u BEFORE ranking by length: `sort -n -u` keys on the length alone and drops a second path
    # of the same length (it dropped /data/<p>/data beside a project path of 27 characters).
    done < <(printf '%s\n' "${lowers[@]}" | sort -u | awk '{ print length, $0 }' | sort -n -s | cut -d' ' -f2-)
    args=(--ro-bind / / --dev /dev --tmpfs /dev/shm --proc /proc --tmpfs /tmp)
    for k in "${keep[@]}"; do args+=(--overlay-src "$k" --tmp-overlay "$k"); done
    args+=(--bind "$tmp" "$tmp" --unshare-net --unshare-pid --unshare-ipc --die-with-parent --info-fd 3)
    exec bwrap "${args[@]}" -- sleep infinity
    ;;
  agent)
    [ $# -eq 4 ] || die "usage: sandbox.sh agent NAME FILE OUT" 2
    WRITERS=$WRITERS exec bun -e '
      const [name, file, out] = process.argv.slice(1)
      const writers = JSON.parse(process.env.WRITERS)
      const text = require("fs").readFileSync(file, "utf8")
      const end = text.indexOf("\n---\n", 3)
      if (!text.startsWith("---\n") || end < 0) { console.error(`sandbox.sh: ${file} has no frontmatter`); process.exit(2) }
      const fm = Bun.YAML.parse(text.slice(4, end)) || {}
      const list = v => v == null ? null : (Array.isArray(v) ? v : String(v).split(",")).map(s => String(s).trim()).filter(Boolean)
      const { name: _n, color: _c, tools, disallowedTools, ...rest } = fm
      const def = { ...rest, prompt: text.slice(end + 5).replace(/^\n+/, "") }
      const t = list(tools)
      if (t) def.tools = [...t.filter(x => !writers.includes(x)), ...(t.includes("Bash") ? [] : ["Bash"])]
      def.disallowedTools = [...new Set([...(list(disallowedTools) || []).filter(x => x !== "Bash"), ...writers])]
      require("fs").writeFileSync(out, JSON.stringify({ [`${name}-sandboxed`]: def }, null, 2) + "\n")
    ' "$2" "$3" "$4"
    ;;
esac

# Prefix mode. Refuse anything but a live holder in namespaces other than ours: running the command
# here instead would be the unsandboxed run this script exists to prevent.
[ $# -eq 1 ] || die "sandbox: expected ONE argument (the command), got $#"
pid=${FARM_SANDBOX_PID:-}
[[ $pid =~ ^[0-9]+$ ]] || die "sandbox: FARM_SANDBOX_PID is not set; refusing to run unsandboxed"
net=$(readlink "/proc/$pid/ns/net" 2>/dev/null) || die "sandbox: holder $pid is gone; refusing to run unsandboxed"
mnt=$(readlink "/proc/$pid/ns/mnt" 2>/dev/null) || die "sandbox: holder $pid is gone; refusing to run unsandboxed"
[ "$net" != "$(readlink /proc/self/ns/net)" ] && [ "$mnt" != "$(readlink /proc/self/ns/mnt)" ] \
  || die "sandbox: process $pid shares our namespaces, it is not a sandbox; refusing to run unsandboxed"
exec nsenter -t "$pid" -U -m -n -p --preserve-credentials -r --wd="$PWD" -- bash -c "$1"
