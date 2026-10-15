#!/usr/bin/env bash
# The single mechanical verdict for an addendum. Seven legs, none short-circuiting:
#   plan      — check-plan.py: the plan records both interview answers and each reading's
#               page target (and any non-court readings)
#   compile   — typst builds the addendum
#   quotes    — check-quotes.py --leg: the verbatim check once per reading, captions DERIVED
#               from the .typ
#   addendum  — check-addendum.py: arity, table truth vs the PDF, per-reading length
#   strays    — the stray-line family, each defect under ITS OWN name and its own exit code:
#                 widows.py --prose   widow  (a paragraph's last line alone at a page top)
#                 orphans.py --prose  orphan (a paragraph's first line alone at a page foot)
#                 runts.py --prose    runt   (one word alone on a paragraph's last line)
#                 check-stranded-headings.py  a heading at a page foot, its text overleaf
#               The first three are canonical, in the typst plugin, in one copy. Only the
#               fourth is this skill's own.
#   marks     — check-marks.py: one elision mark per addendum, and every retained footnote
#               renumbered 1..k per reading with each #super[N] marker paired to a body
#   constraints — `bin/workflow-check elide --constraints-only`: every constraint under
#               checks/elide/constraints/, where the checkers above and check-source-identity.py live, over the addendum
#               and the plan.
#               The legs above carry this script's per-reading flags, which the constraint
#               contract has no place for; this leg is what reaches a constraint added there.
# Every leg runs; the exit code is 0 only when all of them passed.
#
# Usage: check.sh --addendum <typ> [--pdf <pdf>] [--docs <dir>]
#                 (--plan <md> | --no-plan) (--target MIN-MAX | --no-target)
#                 [--strays | --no-strays]
#
# --plan enforces the interview. The named file must carry a '## Doctrinal target'
# section answering, non-placeholder: 'Doctrinal thread:', 'Cuts against:', and
# 'Taught for:' (holding|reasoning). A missing or empty answer FAILS naming which one.
#
# THE PLAN LEG FAILS CLOSED. Passing neither --plan nor --no-plan is a FAIL naming the
# missing flag: an optional leg whose absence passes is opt-in, and a run could then be
# certified with the interview checked by nothing. --no-plan is the explicit escape for
# fixture and dev runs that check an addendum alone; it prints a loud NOT CHECKED line
# and does not fail. What it buys is that skipping the interview is always a deliberate,
# visible act rather than the default.
#
# THE PAGE TARGET COMES FROM THE PLAN, PER READING. With --plan, each '## Readings In Scope'
# row supplies its own MIN-MAX and the plan leg FAILS on a missing section, a row with no page
# target, or a placeholder one (TBD, <...>, N/A), naming the row. A number typed at the command
# line is a number an agent can invent to suit its output; a number in the plan is one the
# instructor approved.
#
# PRECEDENCE, STATED: when a plan is given, the PLAN WINS. --target and --no-target on the same
# command line are ignored, with a loud line naming the plan's values. Silently preferring
# either one is how a fabricated target gets back in.
#
# THE LENGTH CHECK FAILS CLOSED ON --no-plan RUNS. There --target MIN-MAX is the override for
# fixtures and dev, and passing neither it nor --no-target is a FAIL naming the missing flag:
# without a target check-addendum.py measures no reading, and a leg that still reported
# "length all hold" was certifying a check nothing ran. --no-target prints a loud NOT CHECKED
# line, does not fail, and the leg's PASS line then says only what was actually checked.
#
# Declaring a reading non-court text is the INSTRUCTOR's call, so it lives in the plan's
# '## Non-court readings' section, keyed by caption. A bullet must name exactly ONE caption,
# matched on whole words as an exact or contiguous run; a bullet matching none, or several,
# FAILS naming it. The same declaration written into
# the .typ as `// elide-unchecked:` is SELF-EXEMPTING — the agent writing the excerpt
# would be switching the verbatim check off its own work — so its presence is itself a
# FAIL naming the reading.
#
# THE STRAYS LEG IS ON BY DEFAULT, which is its fail-closed form: the flag's absence
# RUNS the check rather than skipping it, so no invocation can quietly certify stray lines
# nobody looked at. --no-strays is the loud explicit waiver and --strays states the default
# on the record; passing both FAILS. (--widows/--no-widows are accepted as the old names of
# the same pair, because the leg used to cover only two of the four defects.) The fix
# vocabulary is LAYOUT-ONLY — spacing, the measure, or where the line and page break —
# never the court's words, which the quotes leg owns.
#
# WIDOW, ORPHAN AND RUNT ARE THREE NAMES, NOT ONE. They have different causes (page
# breaking vs. line filling), different fixes (move the break vs. rebreak the line), and on
# real prose their findings are disjoint. Reporting all of them as "widows" is what let the
# runt class go unmeasured while the leg called a 20-runt document clean.
#
# EACH SUB-CHECK HAS ITS OWN EXIT CODE, so one class going unmeasured can never be absorbed
# into another's verdict. A checker that cannot be found or cannot run is a FAIL naming it,
# never a silent shorter run — the local widow/orphan detector used to REFUSE on ragged-right
# prose (three of the four real addenda), which is a non-answer the canonical checkers do not
# need: they take paragraph boundaries from the vertical gap, not the right margin.
#
# Source mapping stays auditable: every reading prints the file it was checked against
# and whether that mapping was DERIVED from the caption, DECLARED in the .typ via
# `// elide-source: <basename>` (which names a file that must exist, and so cannot
# fabricate a pass), or exempted by the PLAN. A reading with no resolvable source and no
# plan declaration FAILS — that distinction is the difference between a disclosed
# exemption and a silent skip.
#
# THE SOURCE OF RECORD IS THE `.westlaw.docx`, and check-quotes.py projects it to text in
# memory. A `.txt` remains fully resolvable, both by derivation and when an existing plan
# or `// elide-source:` names one, so an addendum that passed before this change still
# passes. Where a stem carries both, the `.docx` wins. A `.txt` source cannot carry the
# court's italics, so the leg prints a loud ITALICS NOT CHECKED line for that reading —
# not a failure, since the CourtListener/RECAP fallback route yields a court PDF with no
# formatting layer and that route is how a case Westlaw does not cover gets retrieved.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The checkers are the elide workflow's constraints (checks/elide/constraints/), each also on the
# constraint contract the constraints leg runs them on.
CHECKS_DIR="$(cd "$SCRIPTS_DIR/../../../checks/elide/constraints" && pwd)"

ADDENDUM=""
PDF=""
TARGET=""
DOCS_DIR=""
PLAN=""
NO_PLAN=0
NO_TARGET=0
WIDOWS=0
NO_WIDOWS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --addendum) ADDENDUM="${2:-}"; shift 2 ;;
    --pdf)      PDF="${2:-}"; shift 2 ;;
    --docs)     DOCS_DIR="${2:-}"; shift 2 ;;
    --target)   TARGET="${2:-}"; shift 2 ;;
    --no-target) NO_TARGET=1; shift ;;
    --plan)     PLAN="${2:-}"; shift 2 ;;
    --no-plan)  NO_PLAN=1; shift ;;
    --strays|--widows)   WIDOWS=1; shift ;;
    --no-strays|--no-widows) NO_WIDOWS=1; shift ;;
    -h|--help)  echo "usage: check.sh --addendum <typ> [--pdf <pdf>] [--docs <dir>] (--plan <md> | --no-plan) [--target MIN-MAX | --no-target] [--strays | --no-strays]
       --plan supplies each reading's page target and OVERRIDES --target/--no-target;
       on a --no-plan run exactly one of --target/--no-target is required;
       the strays leg (widow, orphan, stranded heading, runt) is ON BY DEFAULT —
       --no-strays waives it loudly; --widows/--no-widows are the old names"; exit 0 ;;
    *) echo "FAIL setup: unknown argument $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$ADDENDUM" ]]; then
  echo "FAIL setup: --addendum <typ> is required" >&2
  exit 2
fi
if [[ ! -f "$ADDENDUM" ]]; then
  echo "FAIL setup: no such addendum: $ADDENDUM" >&2
  exit 2
fi
ADDENDUM="$(cd "$(dirname "$ADDENDUM")" && pwd)/$(basename "$ADDENDUM")"
ADDENDUM_DIR="$(dirname "$ADDENDUM")"

# In the course repo docs/ sits beside addenda/; a self-contained fixture keeps its own
# docs/ alongside the .typ. --docs overrides both.
if [[ -z "$DOCS_DIR" ]]; then
  if [[ -d "$ADDENDUM_DIR/docs" ]]; then
    DOCS_DIR="$ADDENDUM_DIR/docs"
  else
    DOCS_DIR="$ADDENDUM_DIR/../docs"
  fi
fi

TYPST_ROOT="$(dirname "$ADDENDUM_DIR")"

TMPDIR_SELF=""
cleanup() {
  [[ -n "$TMPDIR_SELF" ]] && rm -rf "$TMPDIR_SELF"
  [[ -n "${DECLARED_FILE:-}" ]] && rm -f "$DECLARED_FILE"
  [[ -n "${READINGS_FILE:-}" ]] && rm -f "$READINGS_FILE"
  [[ -n "${TARGETS_FILE:-}" ]] && rm -f "$TARGETS_FILE"
  return 0
}
trap cleanup EXIT
if [[ -z "$PDF" ]]; then
  TMPDIR_SELF="$(mktemp -d)"
  PDF="$TMPDIR_SELF/$(basename "${ADDENDUM%.typ}").pdf"
fi

fail_plan=0
fail_compile=0
fail_quotes=0
fail_addendum=0
fail_marks=0

# Captions the PLAN declares to be non-court text. Empty file when there is no plan, which
# is why an unresolvable reading still fails in that case.
DECLARED_FILE="$(mktemp)"
: >"$DECLARED_FILE"

# The plan's '## Readings In Scope' rows, one `caption \x1f MIN-MAX` line each. Empty when
# there is no plan, which is what makes --target the only target source on a --no-plan run.
READINGS_FILE="$(mktemp)"
: >"$READINGS_FILE"
TARGETS_FILE="$(mktemp)"
: >"$TARGETS_FILE"

# ---------------------------------------------------------------- leg: plan
# The interview is the point of this workflow, and a property a skill claims is decoration
# unless a parameter or an exit code carries it. This leg is that exit code.
echo "--- leg plan"
if [[ -n "$PLAN" && $NO_PLAN -eq 1 ]]; then
  fail_plan=1
  echo "LEG plan: FAIL — --plan and --no-plan are contradictory; pass exactly one"
elif [[ -z "$PLAN" && $NO_PLAN -eq 0 ]]; then
  # Fail closed. An absent flag must never be the quiet way to skip the interview.
  fail_plan=1
  echo "LEG plan: FAIL — neither --plan <md> nor --no-plan was given; the interview is enforced by nothing"
  echo "  pass --plan <md> to check the interview answers, or --no-plan to check this addendum alone"
elif [[ $NO_PLAN -eq 1 ]]; then
  echo "LEG plan: NOT CHECKED — --no-plan was given; NOBODY IS CHECKING THE INTERVIEW ANSWERS"
  echo "  this addendum was graded on its text alone; the doctrinal target it was cut for is unverified"
elif [[ ! -f "$PLAN" ]]; then
  fail_plan=1
  echo "LEG plan: FAIL — no such plan file: $PLAN"
else
  # check-plan.py is the elide workflow's constraint for the interview; in this form it also writes
  # the plan's per-reading targets and non-court readings for the legs below.
  plan_out="$(python3 "$CHECKS_DIR/check-plan.py" "$PLAN" "$DECLARED_FILE" "$READINGS_FILE")"
  plan_rc=$?
  [[ -n "$plan_out" ]] && printf '%s\n' "$plan_out"
  # grep -c prints 0 AND exits 1 on no match, so `|| echo 0` would append a second line.
  n_declared=$(grep -c . "$DECLARED_FILE" 2>/dev/null); n_declared=${n_declared:-0}
  if [[ $plan_rc -eq 0 ]]; then
    n_targets=$(grep -c . "$READINGS_FILE" 2>/dev/null || echo 0)
    echo "LEG plan: PASS — both interview answers recorded in $(basename "$PLAN"); $n_targets reading(s) with a page target; $n_declared non-court reading(s) declared"
  else
    fail_plan=1
    : >"$READINGS_FILE"
    echo "LEG plan: FAIL — $(basename "$PLAN") does not record the interview answers or the per-reading page targets"
  fi
fi

# ---------------------------------------------------------------- leg: compile
echo "--- leg compile"
compile_out="$(typst compile --root "$TYPST_ROOT" "$ADDENDUM" "$PDF" 2>&1)"
if [[ $? -ne 0 || ! -s "$PDF" ]]; then
  fail_compile=1
  [[ -n "$compile_out" ]] && echo "$compile_out"
fi
if [[ $fail_compile -eq 0 ]]; then
  echo "LEG compile: PASS — $(basename "$ADDENDUM") builds to $(basename "$PDF")"
else
  echo "LEG compile: FAIL — typst could not build $(basename "$ADDENDUM")"
fi

# ---------------------------------------------------------------- leg: quotes
# check-quotes.py --leg derives the caption list from the .typ with check-addendum.py's own parser,
# so a reading added to the addendum is checked without anyone being told it exists; resolves each
# reading's source in $DOCS_DIR; and runs the verbatim check once per reading. The constraint
# contract runs the same leg (the constraints leg below).
echo "--- leg quotes"
python3 "$CHECKS_DIR/check-quotes.py" --leg "$ADDENDUM" "$DOCS_DIR" "$DECLARED_FILE" || fail_quotes=1

# ---------------------------------------------------------------- leg: addendum
echo "--- leg addendum"
# Fail closed on the length check, exactly as the plan leg does on the interview. An absent
# --target must never be the quiet way to skip it — and arity and the table still run, so the
# missing flag costs one check rather than the whole leg.
length_checked=0
plan_targets=0
target_msg=""

# The plan is the source of truth for the page target, per reading. Map each caption in the
# .typ to its '## Readings In Scope' row and hand check-addendum.py that row's own MIN-MAX.
if [[ -n "$PLAN" && $NO_PLAN -eq 0 && $fail_plan -eq 0 && -s "$READINGS_FILE" ]]; then
  plan_targets=1
  map_out="$(python3 - "$ADDENDUM" "$READINGS_FILE" "$CHECKS_DIR/check-addendum.py" "$TARGETS_FILE" <<'PY'
import importlib.util, re, sys
from pathlib import Path

typ, readings_file, parser_path, out_file = (Path(a) for a in sys.argv[1:5])
spec = importlib.util.spec_from_file_location("check_addendum", parser_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
captions = mod.parse_captions(typ.read_text(encoding="utf-8"))


def toklist(s: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", s.lower()) if w]


def run_matches(needle: list[str], hay: list[str]) -> bool:
    if not needle or len(needle) > len(hay):
        return False
    return any(hay[i : i + len(needle)] == needle for i in range(len(hay) - len(needle) + 1))


rows = []
for line in readings_file.read_text(encoding="utf-8").splitlines():
    if "\x1f" in line:
        cap, tgt = line.split("\x1f", 1)
        rows.append((cap.strip(), toklist(cap), tgt.strip()))

problems: list[str] = []
lines: list[str] = []
for i, cap in enumerate(captions, 1):
    ct = toklist(cap)
    hits = [r for r in rows if run_matches(r[1], ct) or run_matches(ct, r[1])]
    if len(hits) == 1:
        lines.append(f"{i}\t{hits[0][2]}")
    elif not hits:
        problems.append(
            f"reading {i} ({cap[:60]!r}) matches no '## Readings In Scope' row, so no approved "
            f"page target reaches it"
        )
    else:
        named = " | ".join(h[0][:40] for h in hits)
        problems.append(
            f"reading {i} ({cap[:60]!r}) matches {len(hits)} '## Readings In Scope' rows — {named}"
        )
out_file.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
for p in problems:
    print(f"  {p}")
sys.exit(1 if problems else 0)
PY
)"
  map_rc=$?
  if [[ -n "$TARGET" || $NO_TARGET -eq 1 ]]; then
    ignored=$([[ -n "$TARGET" ]] && echo "--target $TARGET" || echo "--no-target")
    echo "  IGNORED FLAG — $ignored was given alongside --plan and is IGNORED; the plan supplies each reading's page target:"
    while IFS=$'\x1f' read -r cap tgt; do
      [[ -n "$cap" ]] && echo "    $tgt  ${cap:0:60}"
    done <"$READINGS_FILE"
  fi
  if [[ $map_rc -ne 0 ]]; then
    fail_addendum=1
    target_msg="$(printf '  LENGTH NOT CHECKED — a reading could not be matched to a plan row:\n%s' "$map_out")"
  else
    length_checked=1
  fi
elif [[ -n "$PLAN" && $NO_PLAN -eq 0 ]]; then
  fail_addendum=1
  target_msg="  LENGTH NOT CHECKED — the plan leg failed, so no approved page target is available"
elif [[ -n "$TARGET" && $NO_TARGET -eq 1 ]]; then
  fail_addendum=1
  target_msg="  LENGTH NOT CHECKED — --target and --no-target are contradictory; pass exactly one"
elif [[ -z "$TARGET" && $NO_TARGET -eq 0 ]]; then
  fail_addendum=1
  target_msg="  LENGTH NOT CHECKED — neither --target MIN-MAX nor --no-target was given; the length check is enforced by nothing
  pass --target MIN-MAX to check each reading's length, or --no-target to check arity and the table alone"
elif [[ $NO_TARGET -eq 1 ]]; then
  target_msg="  LENGTH NOT CHECKED — --no-target was given; NOBODY IS CHECKING PER-READING LENGTH
  arity and the table were still checked; how many pages each reading runs to is unverified"
else
  length_checked=1
  target_msg=""
fi

if [[ $length_checked -eq 1 && $plan_targets -eq 1 ]]; then
  a_out="$(python3 "$CHECKS_DIR/check-addendum.py" "$ADDENDUM" "$PDF" --targets "$TARGETS_FILE" 2>&1)"
elif [[ $length_checked -eq 1 ]]; then
  a_out="$(python3 "$CHECKS_DIR/check-addendum.py" "$ADDENDUM" "$PDF" --target "$TARGET" 2>&1)"
else
  a_out="$(python3 "$CHECKS_DIR/check-addendum.py" "$ADDENDUM" "$PDF" 2>&1)"
fi
if [[ $? -ne 0 ]]; then
  fail_addendum=1
fi
printf '%s\n' "$a_out" | sed 's/^/  /'
[[ -n "$target_msg" ]] && printf '%s\n' "$target_msg"
# The summary states what was CHECKED. Claiming length holds when nothing measured it is the
# defect itself; the exit code is only half of it.
if [[ $fail_addendum -eq 0 ]]; then
  if [[ $length_checked -eq 1 && $plan_targets -eq 1 ]]; then
    echo "LEG addendum: PASS — arity, table page ranges and per-reading length (targets from the plan) all hold"
  elif [[ $length_checked -eq 1 ]]; then
    echo "LEG addendum: PASS — arity, table page ranges and length all hold"
  else
    echo "LEG addendum: PASS — arity and table page ranges hold; per-reading length NOT CHECKED"
  fi
else
  if [[ $length_checked -eq 1 ]]; then
    echo "LEG addendum: FAIL — check-addendum.py rejected the table, arity or length"
  else
    echo "LEG addendum: FAIL — arity or the table was rejected, or neither --target nor --no-target was given"
  fi
fi

# ---------------------------------------------------------------- leg: strays
# check-quotes.py proves the WORDS match the reporter and says nothing about how
# Typst SET them, so a verbatim-perfect excerpt can still put a paragraph's last
# line alone atop a page, or leave a single word alone on a line. This leg decides
# the stray-line family, and reports each defect UNDER ITS OWN NAME:
#
#   widow             a paragraph's last line alone at the top of a page
#   orphan            a paragraph's first line alone at the foot of a page
#   stranded heading  a heading at the foot of a page, its text overleaf
#   runt              one word alone on a paragraph's last line
#
# THE DEFAULT IS ON, and that is the fail-closed choice: the leg's absence can
# never read as a pass because absence RUNS it. --no-strays is the explicit, loud
# waiver (fixtures, and a compile-only dev run); --strays states the default in a
# command line that wants it on the record. Passing both is a FAIL.
#
# THE TWO SUB-CHECKS ARE INDEPENDENT. Widow/orphan detection needs justified text
# and refuses itself (exit 3) below the flush-right floor; the runt check needs no
# such premise and is exactly the defect ragged-right prose has. Sharing one gate
# would mean a gate that has to be both on and off at once, so each keeps its own
# exit code and its own line.
#
# THE FIX VOCABULARY IS LAYOUT-ONLY. A stray line is fixed by spacing, the measure,
# hyphenation or where the break falls — never by adding, cutting or rewording the
# court's text: that would defeat the verbatim gate. Runts are the most tempting to
# fix by deleting a word, which is why the verbatim gate matters more here, not less.
echo "--- leg strays"
fail_widows=0
if [[ $WIDOWS -eq 1 && $NO_WIDOWS -eq 1 ]]; then
  fail_widows=1
  echo "LEG strays: FAIL — --strays and --no-strays are contradictory; pass at most one"
elif [[ $NO_WIDOWS -eq 1 ]]; then
  echo "LEG strays: NOT CHECKED — --no-strays was given; NOBODY IS CHECKING PAGE BREAKS OR RUNTS"
  echo "  a paragraph's last line may sit alone at the top of a page, or a paragraph may end on a"
  echo "  single stranded word, and nothing here would say so"
elif [[ $fail_compile -ne 0 || ! -s "$PDF" ]]; then
  fail_widows=1
  echo "LEG strays: FAIL — there is no compiled PDF to inspect, so page breaks and runts were not checked"
else
  # --- resolve the canonical checkers ONCE. widows, orphans and runts are the typst
  # plugin's, in one copy; only stranded-heading is this skill's own. None of the three
  # re-execs to find pymupdf, so borrow the local script's resolver for an interpreter.
  # A checker that cannot be found is a FAIL: nothing checked that class.
  # The typst plugin keeps them as workshop constraints (checks/workshop/constraints/), so
  # `workflow-check workshop --list` reaches them first; a typst plugin from before that layout
  # keeps them in the directory `typst-constraints --dir` names.
  CANON_LISTED="$(python3 "$SCRIPTS_DIR/../../../bin/workflow-check" workshop --list 2>/dev/null \
    | python3 -c 'import json, sys; print("\n".join(json.load(sys.stdin)["constraints"]))' 2>/dev/null)" || CANON_LISTED=""
  CANON_DIR=""
  # ASK the plugin; the list below is the plain-shell fallback, not a second source of truth.
  if command -v typst-constraints >/dev/null 2>&1; then
    CANON_DIR="$(typst-constraints --dir 2>/dev/null)" || CANON_DIR=""
  fi
  if [[ -z "$CANON_DIR" || ! -d "$CANON_DIR" ]]; then
    # a plain shell has no plugin bin/ on PATH, so only the explicit override can name the directory
    [[ -n "${TYPST_CHECKERS_DIR:-}" && -d "$TYPST_CHECKERS_DIR" ]] && CANON_DIR="$TYPST_CHECKERS_DIR"
  fi
  canon_file() {  # canon_file widows.py -> its path, or nothing
    local f
    while IFS= read -r f; do [[ "${f##*/}" == "$1" && -f "$f" ]] && { echo "$f"; return; }; done <<<"$CANON_LISTED"
    [[ -n "$CANON_DIR" && -f "$CANON_DIR/$1" ]] && echo "$CANON_DIR/$1"
  }
  PYEXE="$(python3 "$CHECKS_DIR/check-stranded-headings.py" "$PDF" --which-python 2>/dev/null)"
  [[ -x "$PYEXE" ]] || PYEXE=python3

  # --- sub-check: stranded heading. This skill's own class; needs no justified text.
  h_out="$(python3 "$CHECKS_DIR/check-stranded-headings.py" "$PDF" 2>&1)"
  h_rc=$?
  printf '%s\n' "$h_out" | grep -v 'API is deprecated' | sed 's/^/  /'
  case $h_rc in
    0) echo "  SUB stranded-heading: PASS — no heading left at a page foot" ;;
    1) fail_widows=1
       echo "  SUB stranded-heading: FAIL — a heading sits at a page foot with its text overleaf" ;;
    *) fail_widows=1
       echo "  SUB stranded-heading: FAIL — the checker could not run (exit $h_rc); a check that did not run is not a pass" ;;
  esac

  # --- sub-checks: widow, orphan, runt. Each canonical, each its own exit code, so one
  # class going unmeasured can never be absorbed into another's verdict.
  for _c in "widows:widow:a paragraph's last line sits alone at a page top" \
            "orphans:orphan:a paragraph's first line sits alone at a page foot" \
            "runts:runt:a paragraph ends on a single stranded word"; do
    _file="${_c%%:*}.py"; _rest="${_c#*:}"; _name="${_rest%%:*}"; _what="${_rest#*:}"
    _path="$(canon_file "$_file")"
    if [[ -z "$_path" ]]; then
      fail_widows=1
      echo "  SUB $_name: FAIL — $_file not found (TYPST_CHECKERS_DIR, or the typst plugin); nothing checked ${_name}s"
      continue
    fi
    c_out="$("$PYEXE" "$_path" "$PDF" --prose 2>&1)"
    c_rc=$?
    printf '%s\n' "$c_out" | grep -v 'API is deprecated' | sed 's/^/  /'
    case $c_rc in
      0) echo "  SUB $_name: PASS" ;;
      1) fail_widows=1
         echo "  SUB $_name: FAIL — $_what"
         echo "    FIX BY LAYOUT ONLY — spacing, the measure, or where the page breaks."
         echo "    Deleting a word visibly closes one, and that is what the verbatim gate forbids." ;;
      *) fail_widows=1
         echo "  SUB $_name: FAIL — the checker could not run (exit $c_rc); a check that did not run is not a pass" ;;
    esac
  done

  if [[ $fail_widows -eq 0 ]]; then
    echo "LEG strays: PASS — no widow, orphan, stranded heading or runt"
  else
    echo "LEG strays: FAIL — at least one widow, orphan, stranded heading or runt"
  fi
fi

# ---------------------------------------------------------------- leg: marks
# Decided from the .typ alone, so it needs no PDF and no source: a mixed elision mark, or a
# retained footnote left at its original number or without its pair, is a FAIL naming the line.
echo "--- leg marks"
python3 "$CHECKS_DIR/check-marks.py" "$ADDENDUM"
case $? in
  0) echo "LEG marks: PASS — one elision mark; retained footnotes renumbered and paired" ;;
  1) fail_marks=1
     echo "LEG marks: FAIL — mixed elision marks, or a footnote marker not renumbered or not paired" ;;
  *) fail_marks=1
     echo "LEG marks: FAIL — check-marks.py could not run; a check that did not run is not a pass" ;;
esac

# ---------------------------------------------------------------- leg: constraints
# `bin/workflow-check elide --constraints-only`: every constraint under checks/elide/constraints/ in
# every plugin root on WORKFLOW_CHECKS_PATH, on the constraint contract, over this addendum -- the
# checkers above among them, each judging it with its own defaults (no length target), and any
# constraint added there with no edit here. It is handed the addendum, the sources in $DOCS_DIR, and
# the compiled PDF unless --no-strays waived the page layout.
echo "--- leg constraints"
fail_constraints=0
c_files=("$ADDENDUM")
for f in "$DOCS_DIR"/*.docx "$DOCS_DIR"/*.txt; do [[ -f "$f" ]] && c_files+=("$f"); done
[[ $NO_WIDOWS -eq 1 || ! -s "$PDF" ]] || c_files+=("$PDF")
python3 "$SCRIPTS_DIR/../../../bin/workflow-check" elide --constraints-only --project-dir "$TYPST_ROOT" ${PLAN:+--plan "$PLAN"} --files "${c_files[@]}"
case $? in
  0) echo "LEG constraints: PASS — every elide constraint holds on $(basename "$ADDENDUM")" ;;
  1) fail_constraints=1
     echo "LEG constraints: FAIL — an elide constraint fired on $(basename "$ADDENDUM")" ;;
  *) fail_constraints=1
     echo "LEG constraints: FAIL — not every elide constraint could check $(basename "$ADDENDUM"); a check that did not run is not a pass" ;;
esac

# ---------------------------------------------------------------- verdict
echo "--- verdict"
v() { [[ $1 -eq 0 ]] && echo PASS || echo FAIL; }
if [[ $((fail_plan + fail_compile + fail_quotes + fail_addendum + fail_widows + fail_marks + fail_constraints)) -eq 0 ]]; then
  waived=""
  [[ $NO_PLAN -eq 1 ]] && waived="plan, which --no-plan waived"
  if [[ $NO_TARGET -eq 1 && $plan_targets -eq 0 ]]; then
    [[ -n "$waived" ]] && waived="$waived, and length, which --no-target waived" \
      || waived="length, which --no-target waived"
  fi
  if [[ $NO_WIDOWS -eq 1 ]]; then
    [[ -n "$waived" ]] && waived="$waived, and stray lines, which --no-strays waived" \
      || waived="stray lines, which --no-strays waived"
  fi
  if [[ -n "$waived" ]]; then
    echo "PASS: every leg passed — EXCEPT $waived"
  else
    echo "PASS: every leg passed"
  fi
  exit 0
fi
strays_verdict=$([[ $NO_WIDOWS -eq 1 && $WIDOWS -eq 0 ]] && echo NOT-CHECKED || v $fail_widows)
echo "FAIL: plan=$([[ $NO_PLAN -eq 1 && -z "$PLAN" ]] && echo NOT-CHECKED || v $fail_plan) compile=$(v $fail_compile) quotes=$(v $fail_quotes) addendum=$(v $fail_addendum) strays=$strays_verdict marks=$(v $fail_marks) constraints=$(v $fail_constraints)"
exit 1
