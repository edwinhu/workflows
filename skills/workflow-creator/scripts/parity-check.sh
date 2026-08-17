#!/usr/bin/env bash
# parity-check.sh — the gate and the write-time hook must agree about the same file.
#
# wc-probe.ts (gate time) and validate-skill-write.ts (write time) share their predicates but not
# their dispatch, and that is exactly where they came apart before: sharing the predicates and not
# the dispatch left the bug one level up. This asserts they return the SAME rule set for one agent
# .md carrying one known defect.
#
# It lived as a mechanicalChecks `cmd` string for a while — a single line carrying four levels of
# shell/JSON escaping, quoted into a plan, retyped by whoever dispatched the run. That is the shape
# the skill's own doctrine warns about: a command that exists only as a string in a document is
# executed by nothing and verified by no one, and this one eventually failed to survive being passed
# through a JSON argument at all. A file can be run, tested, diffed and committed. A string cannot.
#
# Writes only under `mktemp -d`, and removes it. Safe on a readOnly run.
#
# Exit 0 = the two surfaces agree. Exit 1 = they disagree (the output shows both sides).
#
# DECLARED EXEMPTION: the fixture below writes a deliberately broken ${CLAUDE_PLUGIN_ROOT} reference
# so both surfaces have something to disagree about. It is data, not a path this script uses.
# <!-- wc-probe: ignore-paths -->
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT

mkdir -p "$d/agents"
printf -- '---\nname: s\ndescription: d\n---\n# s\n' > "$d/SKILL.md"
# ${CLAUDE_PLUGIN_ROOT} in an AGENT body. It does substitute in a plugin-shipped SKILL body, but an
# agent is not that: a plugin-shipped agent's hooks: block is ignored entirely, and outside a plugin
# there is no installation directory at all — so here it stays literal, a defect both surfaces name.
printf -- '---\nname: g\ndescription: d\n---\n\nuses ${CLAUDE_PLUGIN_ROOT}/x.sh\n' > "$d/agents/impl.md"
# A SECOND agent, broken a different way. One fixture only exercises the rules it happens to trip:
# a rule added to one surface and not the other is invisible unless something trips it. This one
# has no frontmatter, so it registers nothing — the class checkAgentFrontmatter exists for.
printf -- 'no frontmatter here\n' > "$d/agents/unregistered.md"
# A THIRD agent, tripping a rule whose NAME carries two spaces (`P9 exemption vocabulary`). The
# write-side extractor below used to be `grep -oE 'P[0-9] [a-z-]+'`, which truncated it to
# `P9 exemption` and reported PARITY BROKEN between two surfaces printing the identical string.
# Three shipped rule names have a second space, so the fixture pins the parse, not just the rules.
printf -- '---\nname: v\ndescription: d\n---\n\n<!-- wc-probe: ignore-fences -->\nbody\n' > "$d/agents/vocab.md"

# NOTE the `|| true` on each producer, and why it is not sloppiness: wc-probe exits 1 whenever it
# has findings, which is the WHOLE POINT of this fixture — it ships a known defect. Under
# `set -eo pipefail` that expected non-zero killed the script between the two captures, so it
# reported nothing and exited 1 while looking exactly like a parity failure. Only the exit codes
# below are load-bearing here; the producers' are not.
gate_json=$(bun "$SKILL_DIR/scripts/wc-probe.ts" --target "$d" --json || true)

# PER FILE, not unioned. Comparing one union against the other asserts only that the two surfaces
# name the same rules SOMEWHERE in the directory: a rule firing on `impl.md` at gate time and on
# `unregistered.md` at write time cancels out and reads as agreement. Every agent file is still
# covered — the loop just keeps each file's verdict in its own bucket.
broken=0
named=0
for f in "$d"/agents/*.md; do
  b=$(basename "$f")
  gate=$(printf '%s' "$gate_json" |
    jq -r --arg f "$f" '[.findings[] | select(.file == $f) | .rule] | unique | join(",")')
  # The write surface has no structured channel — only the rendered `systemMessage` — so the rule
  # name is taken from that line's SHAPE, `  [severity] <rule>[ (line N)]: detail`, not by pattern-
  # matching the name itself. A name-shaped pattern cannot know where a rule name ends: the previous
  # `grep -oE 'P[0-9] [a-z-]+'` stopped at the second space and truncated the three shipped names
  # that have one. The class here excludes `:` and `(` — the two characters that actually delimit
  # the field — so the name binds however many words it has. `sed -n` prints nothing and exits 0
  # when the surface named no rule, which is a real outcome and must reach the comparison as "".
  write=$(printf '{"tool_input":{"file_path":"%s"}}' "$f" |
    { bun "$SKILL_DIR/scripts/validate-skill-write.ts" 2>/dev/null || true; } |
    jq -rs '.[].systemMessage? // empty' 2>/dev/null |
    sed -nE 's/^[[:space:]]+\[[^]]*\] (P[0-9][^:(]*[^:( ]).*/\1/p' | sort -u | paste -sd, -)

  echo "$b: gate=${gate:-<none>} write=${write:-<none>}"
  [ "$gate" != "$write" ] && broken=1
  [ -n "$gate" ] && named=1
done

if [ "$broken" -ne 0 ]; then
  echo "PARITY BROKEN: the gate and the write-time hook disagree about the same file" >&2
  exit 1
fi

# A vacuous pass is not a pass: two empty strings are equal. If no file tripped a rule on either
# surface, the fixtures stopped tripping them and this check is asserting nothing.
if [ "$named" -eq 0 ]; then
  echo "PARITY VACUOUS: no fixture tripped a rule on either surface" >&2
  exit 1
fi

echo "parity: agree"
