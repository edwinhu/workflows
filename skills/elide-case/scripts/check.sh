#!/usr/bin/env bash
# The single mechanical verdict for an addendum. Five legs, none short-circuiting:
#   plan      — the plan records both interview answers (and any non-court readings)
#   compile   — typst builds the addendum
#   quotes    — check-quotes.py once per reading, captions DERIVED from the .typ
#   addendum  — check-addendum.py: arity, table truth vs the PDF, per-reading length
#   strays    — the stray-line family, each defect under ITS OWN name and its own exit code:
#                 widows.py --prose   widow  (a paragraph's last line alone at a page top)
#                 orphans.py --prose  orphan (a paragraph's first line alone at a page foot)
#                 runts.py --prose    runt   (one word alone on a paragraph's last line)
#                 check-stranded-headings.py  a heading at a page foot, its text overleaf
#               The first three are canonical, in the typst plugin, in one copy. Only the
#               fourth is this skill's own.
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
  plan_out="$(python3 - "$PLAN" "$DECLARED_FILE" "$READINGS_FILE" <<'PY'
import re, sys
from pathlib import Path

plan = Path(sys.argv[1]).read_text(encoding="utf-8")
declared_out = Path(sys.argv[2])
readings_out = Path(sys.argv[3])

PLACEHOLDER = re.compile(r"^(tbd|todo|n/?a|none|\?+|_+|x+|<.*>|\[.*\])$", re.I)


def section(name: str) -> str | None:
    m = re.search(rf"^##+\s*{re.escape(name)}\s*$(.*?)(?=^##\s|\Z)", plan, re.I | re.M | re.S)
    return m.group(1) if m else None


def field(body: str, label: str) -> str:
    # Horizontal whitespace only: \s* would cross the newline and capture the NEXT bullet
    # as this label's answer, so an empty answer would read as filled in.
    m = re.search(rf"{re.escape(label)}[^\S\n]*:[^\S\n]*([^\n]*)", body, re.I)
    if not m:
        return ""
    v = m.group(1).strip().strip("*_` ")
    return "" if PLACEHOLDER.match(v) else v


problems: list[str] = []
target = section("Doctrinal target")
if target is None:
    problems.append("no '## Doctrinal target' section — neither interview answer is recorded")
else:
    if not field(target, "Doctrinal thread"):
        problems.append("interview answer 1 absent: 'Doctrinal thread:' is missing or empty")
    if not field(target, "Cuts against"):
        problems.append("interview answer 1 incomplete: 'Cuts against:' is missing or empty")
    taught = field(target, "Taught for").lower()
    if not taught:
        problems.append("interview answer 2 absent: 'Taught for:' is missing or empty")
    elif not re.search(r"\b(holding|reasoning)\b", taught):
        problems.append(f"interview answer 2 unusable: 'Taught for: {taught}' is neither holding nor reasoning")

# '## Readings In Scope' is the source of truth for each reading's page target. It is
# enforced exactly as the three Doctrinal target lines are: absent section, a row with no
# target, or a placeholder target all FAIL, and the failure names the offending row.
TARGET_RE = re.compile(r"^(\d+)\s*[-–—]\s*(\d+)$")
readings: list[str] = []
scope = section("Readings In Scope")
if scope is None:
    problems.append(
        "no '## Readings In Scope' section — no reading has an approved page target"
    )
else:
    rows = []
    for raw in scope.splitlines():
        if not raw.strip().startswith("|"):
            continue
        cells = [c.strip() for c in raw.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        if set("".join(cells)) <= set("-: "):
            continue  # the |---|---| separator
        if cells[0].lower() in ("caption", "reading"):
            continue  # the header row
        rows.append(cells)
    if not rows:
        problems.append("'## Readings In Scope' has no reading rows")
    for cells in rows:
        cap = cells[0].strip("*_` ")
        tgt = cells[-1].strip().strip("*_` ")
        label = cap[:60] if cap else "<unnamed row>"
        if not cap:
            problems.append(f"'## Readings In Scope' row has no caption: {' | '.join(cells)}")
            continue
        if len(cells) < 3 or not tgt or PLACEHOLDER.match(tgt):
            problems.append(
                f"reading '{label}' has no page target — the '## Readings In Scope' row must "
                f"end in a MIN-MAX page target (2-6 is the default range)"
            )
            continue
        m = TARGET_RE.match(tgt)
        if not m:
            problems.append(
                f"reading '{label}' has an unusable page target {tgt!r} — expected MIN-MAX, e.g. 2-6"
            )
            continue
        readings.append(f"{cap}\x1f{int(m.group(1))}-{int(m.group(2))}")
readings_out.write_text("\n".join(readings) + ("\n" if readings else ""), encoding="utf-8")

lines = []
noncourt = section("Non-court readings")
if noncourt:
    for raw in noncourt.splitlines():
        m = re.match(r"\s*[-*]\s+(.+)", raw)
        if not m:
            continue
        item = m.group(1).strip()
        parts = re.split(r"\s+[—–]\s+|\s+--\s+", item, maxsplit=1)
        cap = parts[0].strip().strip("*_`")
        why = (parts[1].strip() if len(parts) > 1 else "") or "declared non-court text in the plan"
        if cap:
            lines.append(f"{cap}\x1f{why}")
declared_out.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

for p in problems:
    print(f"  {p}")
sys.exit(1 if problems else 0)
PY
)"
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

# check-quotes.py prints its gap-match block on SUCCESS as well as failure: a sentence that
# matched across a source gap may have been fused across dropped holding rather than across
# a footnote block, and only a human can tell. Surfacing it only in the FAIL branch discards
# the one diagnostic that catches that corruption silently.
gap_block() {
  printf '%s\n' "$1" | awk '
    /^matched across a source gap/ { show = 1 }
    show && /^[[:space:]]*$/ { exit }
    show { print }
  '
}

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
# The caption list is DERIVED from the .typ using check-addendum.py's own parser, so a
# reading added to the addendum is checked without anyone being told it exists.
echo "--- leg quotes"
RESOLVED="$(python3 - "$ADDENDUM" "$DOCS_DIR" "$SCRIPTS_DIR/check-addendum.py" "$DECLARED_FILE" <<'PY'
import importlib.util, re, sys
from pathlib import Path

typ, docs_dir, parser_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
declared_file = Path(sys.argv[4])
spec = importlib.util.spec_from_file_location("check_addendum", parser_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

src = typ.read_text(encoding="utf-8")
captions = mod.parse_captions(src)

# Offsets let a declaration attach to the caption block that follows it.
cap_offsets = [m.end() for m in mod.CAPTION_RE.finditer(src)]
declared: dict[int, tuple[str, str]] = {}
for m in re.finditer(r"//\s*elide-(source|unchecked):\s*([^\n]*)", src):
    kind, value = m.group(1), m.group(2).strip()
    for i, off in enumerate(cap_offsets):
        if off > m.start():
            declared[i] = (kind, value)
            break

# Readings the PLAN declares non-court text. The match must be DEFINITE: a bullet matches a
# caption only when its token sequence IS the caption's or appears in it as a full contiguous
# run. A raw substring test would let a short bullet ('blog') switch the verbatim check off
# every caption it happened to occur inside — and that check is the first Iron Law, so a loose
# match hands the instructor's authority to whoever writes a vague bullet.
def toklist(s: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", s.lower()) if w]


def run_matches(needle: list[str], hay: list[str]) -> bool:
    if not needle or len(needle) > len(hay):
        return False
    return any(hay[i : i + len(needle)] == needle for i in range(len(hay) - len(needle) + 1))


plan_unchecked: list[tuple[str, list[str], str]] = []  # (raw bullet, tokens, why)
if declared_file.is_file():
    for line in declared_file.read_text(encoding="utf-8").splitlines():
        if "\x1f" in line:
            cap, why = line.split("\x1f", 1)
            if toklist(cap):
                plan_unchecked.append((cap.strip(), toklist(cap), why))

# A bullet naming no reading is a typo, and a bullet naming several does not say WHICH reading
# is not court text. Both are failures: silently ignoring either is how a reading the
# instructor meant to exempt gets checked, or a reading he never named stops being.
cap_tokens = [toklist(c) for c in captions]
bullet_hits: list[tuple[str, list[int]]] = [
    (raw, [i for i, ct in enumerate(cap_tokens) if run_matches(bt, ct)])
    for raw, bt, _ in plan_unchecked
]
bad_bullets = {i for i, (_, hits) in enumerate(bullet_hits) if len(hits) != 1}


def plan_exempt(idx: int) -> str | None:
    for b, (_, hits) in enumerate(bullet_hits):
        if b not in bad_bullets and hits == [idx]:
            return plan_unchecked[b][2]
    return None


# Tokens that name no party and so cannot discriminate between two sources.
STOP = {
    "sec", "securities", "exchange", "commission", "opinion", "order", "court",
    "united", "states", "district", "circuit", "appeals", "supp", "f2d", "f3d",
    "cir", "and", "the", "inc", "corp", "corporation", "llc", "ltd",
}


def toks(s: str) -> set[str]:
    return {w for w in re.split(r"[^a-z0-9]+", s.lower()) if w}


def file_tokens(stem: str) -> set[str]:
    return {w for w in toks(stem) if w.isalpha() and len(w) >= 4 and w not in STOP}


# The .docx is the source of record; a .txt is still resolvable, which is what keeps an
# addendum whose plan names one working unchanged. When a stem carries BOTH — every pair
# retrieved before the docx became canonical does — the .docx wins, and offering both to
# the scorer would instead make every such caption AMBIGUOUS and fail a run that passed.
candidates: dict[str, Path] = {}
if docs_dir.is_dir():
    for suffix in (".txt", ".docx"):  # .docx second, so it overwrites
        for p in sorted(docs_dir.glob(f"*{suffix}")):
            candidates[p.stem] = p
sources = []
for _stem, p in sorted(candidates.items()):
    ft = file_tokens(p.stem)
    if ft:
        sources.append((p, ft))

rows = []  # (caption, path, status, mode)
for i, cap in enumerate(captions):
    if i in declared and declared[i][0] == "unchecked":
        # Self-exemption: the .typ is written by the same agent as the excerpt, so honouring
        # this marker would let fabricated text switch the verbatim check off itself.
        rows.append((cap, "", f"SELFEXEMPT:{declared[i][1] or 'not court text'}", "typ-marker"))
        continue
    why = plan_exempt(i)
    if why is not None:
        rows.append((cap, "", f"UNCHECKED:{why}", "plan"))
        continue
    if i in declared:
        kind, value = declared[i]
        cand = docs_dir / value
        # A declaration naming the retired `.txt` twin resolves to the `.docx` it was
        # derived from. The declaration still names a file that must exist, so it cannot
        # fabricate a pass; what it must not do is fail an addendum whose only defect is
        # that it was written before the docx became the sole stored source.
        if not cand.is_file() and cand.suffix.lower() == ".txt":
            sibling = cand.with_suffix(".docx")
            if sibling.is_file():
                cand = sibling
        if cand.is_file():
            rows.append((cap, str(cand), "OK", "declared"))
        else:
            rows.append((cap, "", f"DECLARED-MISSING:{value}", "declared"))
        continue
    ct = toks(cap)
    scored = []
    for p, ft in sources:
        hit = len(ft & ct)
        if hit:
            scored.append((hit / len(ft), hit, p))
    scored.sort(key=lambda r: (-r[0], -r[1], str(r[2])))
    if not scored:
        rows.append((cap, "", "NOSOURCE", "derived"))
    elif len(scored) > 1 and (scored[0][0], scored[0][1]) == (scored[1][0], scored[1][1]):
        rows.append((cap, "", f"AMBIGUOUS:{scored[0][2].name},{scored[1][2].name}", "derived"))
    else:
        rows.append((cap, str(scored[0][2]), "OK", "derived"))

# A source answering for two readings means at least one is verified against text that is
# not its own. That is reported as its own failure — but the quote check still RUNS for
# both, because replacing a computed result with an unrun status is a vacuous pass.
by_path: dict[str, list[int]] = {}
for i, (_, path, status, _) in enumerate(rows):
    if status == "OK":
        by_path.setdefault(path, []).append(i)
shared = {p: idxs for p, idxs in by_path.items() if len(idxs) > 1}

for cap, path, status, mode in rows:
    dup = ""
    if status == "OK" and path in shared:
        dup = ",".join(str(j + 1) for j in shared[path])
    print("\x1f".join((cap.replace("\x1f", " "), path, status, mode, dup)))

for p, idxs in sorted(shared.items()):
    caps = " | ".join(rows[j][0][:60] for j in idxs)
    print("\x1f".join(("!SHARED", Path(p).name, ",".join(str(j + 1) for j in idxs), caps)))

for b in sorted(bad_bullets):
    raw, hits = bullet_hits[b][0], bullet_hits[b][1]
    if not hits:
        print("\x1f".join(("!BULLETNONE", raw.replace("\x1f", " "), "", "")))
    else:
        caps = " | ".join(rows[j][0][:60] for j in hits)
        print("\x1f".join(("!BULLETMANY", raw.replace("\x1f", " "),
                           ",".join(str(j + 1) for j in hits), caps)))
PY
)"
resolve_rc=$?

n_readings=0
n_verified=0
n_unchecked=0
n_lossy=0
if [[ $resolve_rc -ne 0 ]]; then
  fail_quotes=1
  echo "could not derive the caption list from $(basename "$ADDENDUM"):"
  echo "$RESOLVED"
else
  mapfile -t all_lines < <(printf '%s\n' "$RESOLVED" | sed '/^$/d')
  rows=()
  shared_lines=()
  for line in "${all_lines[@]}"; do
    if [[ "$line" == '!'* ]]; then shared_lines+=("$line"); else rows+=("$line"); fi
  done
  n_readings=${#rows[@]}
  if [[ $n_readings -eq 0 ]]; then
    fail_quotes=1
    echo "no reading caption blocks found in $(basename "$ADDENDUM"); there is nothing to verify"
  fi
  idx=0
  n_verified=0
  n_unchecked=0
  for row in "${rows[@]}"; do
    idx=$((idx + 1))
    IFS=$'\x1f' read -r caption src status mode dup <<<"$row"
    label="reading $idx/$n_readings \"${caption:0:60}\""
    case "$status" in
      UNCHECKED:*)
        n_unchecked=$((n_unchecked + 1))
        echo "  $label: DECLARED-UNCHECKED [$mode] — ${status#UNCHECKED:}"
        continue
        ;;
      SELFEXEMPT:*)
        fail_quotes=1
        echo "  $label: FAIL [$mode] — SELF-EXEMPTING '// elide-unchecked:' marker in the .typ."
        echo "    Declaring a reading non-court text is the instructor's call and belongs in the"
        echo "    plan's '## Non-court readings' section, not in the file the excerpt is written into."
        continue
        ;;
      OK) ;;
      *)
        fail_quotes=1
        echo "  $label: FAIL [$mode] — no source resolved in $DOCS_DIR ($status)"
        continue
        ;;
    esac
    # --skip-editorial: an editors' note is authored commentary, never a quotation, so
    # grading it against the reporter reports the editor's own prose as missing court text.
    q_out="$(python3 "$SCRIPTS_DIR/check-quotes.py" "$ADDENDUM" "$src" --caption "$caption" --skip-editorial 2>&1)"
    if [[ $? -eq 0 ]]; then
      n_verified=$((n_verified + 1))
      echo "  $label: PASS [$mode] — verbatim against $(basename "$src")"
      # A PASS otherwise prints only the gap block, which would swallow the one line
      # saying the source had no typography to check against. Same shape as the
      # --no-plan and --no-target waivers: loud, named, and not a failure — the
      # CourtListener/RECAP fallback route yields a court PDF with no formatting
      # layer at all, and that route is not going away.
      if [[ "$src" != *.docx ]]; then
        n_lossy=$((n_lossy + 1))
        echo "    ITALICS NOT CHECKED — $(basename "$src") is plain text and carries no"
        echo "    formatting layer, so whether this excerpt's emphasis matches the court's"
        echo "    is verified by nothing. Pass the .westlaw.docx where one exists; on the"
        echo "    CourtListener/RECAP fallback route no source can carry it."
      fi
      gaps="$(gap_block "$q_out")"
      [[ -n "$gaps" ]] && printf '%s\n' "$gaps" | sed 's/^/    /'
    else
      fail_quotes=1
      echo "  $label: FAIL [$mode] — against $(basename "$src")"
      printf '%s\n' "$q_out" | sed 's/^/    /'
    fi
    [[ -n "$dup" ]] && echo "    (source shared with reading(s) $dup)"
  done
  for line in "${shared_lines[@]}"; do
    IFS=$'\x1f' read -r kind a idxs caps <<<"$line"
    fail_quotes=1
    case "$kind" in
      '!SHARED')
        echo "  AMBIGUOUS MAPPING: readings $idxs all resolve to $a — $caps" ;;
      '!BULLETNONE')
        echo "  PLAN BULLET MATCHES NO READING: \"$a\""
        echo "    A '## Non-court readings' bullet must name a caption exactly, or as a full"
        echo "    contiguous run of its words. This one names nothing in the addendum." ;;
      '!BULLETMANY')
        echo "  PLAN BULLET IS AMBIGUOUS: \"$a\" matches readings $idxs — $caps"
        echo "    Say which reading is not court text; a bullet this general would switch the"
        echo "    verbatim check off every one of them." ;;
    esac
  done
fi
# An addendum whose every reading carries the unchecked marker verifies nothing, and a leg
# that verified nothing has no verdict to report. Zero verified is a FAIL.
if [[ $fail_quotes -eq 0 && $n_verified -eq 0 ]]; then
  fail_quotes=1
  echo "  NOTHING VERIFIED: 0 of $n_readings reading(s) were checked against a source ($n_unchecked declared unchecked)"
fi
if [[ $fail_quotes -eq 0 ]]; then
  if [[ $n_lossy -gt 0 ]]; then
    echo "LEG quotes: PASS — $n_verified of $n_readings reading(s) verified verbatim, $n_unchecked declared unchecked; ITALICS NOT CHECKED on $n_lossy reading(s) with a plain-text source"
  else
    echo "LEG quotes: PASS — $n_verified of $n_readings reading(s) verified verbatim, $n_unchecked declared unchecked"
  fi
else
  echo "LEG quotes: FAIL — at least one of $n_readings reading(s) is not verified"
fi

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
  map_out="$(python3 - "$ADDENDUM" "$READINGS_FILE" "$SCRIPTS_DIR/check-addendum.py" "$TARGETS_FILE" <<'PY'
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
  a_out="$(python3 "$SCRIPTS_DIR/check-addendum.py" "$ADDENDUM" "$PDF" --targets "$TARGETS_FILE" 2>&1)"
elif [[ $length_checked -eq 1 ]]; then
  a_out="$(python3 "$SCRIPTS_DIR/check-addendum.py" "$ADDENDUM" "$PDF" --target "$TARGET" 2>&1)"
else
  a_out="$(python3 "$SCRIPTS_DIR/check-addendum.py" "$ADDENDUM" "$PDF" 2>&1)"
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
  CANON_DIR=""
  # ASK the plugin; the list below is the plain-shell fallback, not a second source of truth.
  if command -v typst-constraints >/dev/null 2>&1; then
    CANON_DIR="$(typst-constraints --dir 2>/dev/null)" || CANON_DIR=""
  fi
  if [[ -z "$CANON_DIR" || ! -d "$CANON_DIR" ]]; then
    for cand in "${TYPST_CHECKERS_DIR:-}" "$HOME/.claude/skills/typst/constraints"; do
      [[ -n "$cand" && -d "$cand" ]] && { CANON_DIR="$cand"; break; }
    done
  fi
  PYEXE="$(python3 "$SCRIPTS_DIR/check-stranded-headings.py" "$PDF" --which-python 2>/dev/null)"
  [[ -x "$PYEXE" ]] || PYEXE=python3

  # --- sub-check: stranded heading. This skill's own class; needs no justified text.
  h_out="$(python3 "$SCRIPTS_DIR/check-stranded-headings.py" "$PDF" 2>&1)"
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
    if [[ -z "$CANON_DIR" || ! -f "$CANON_DIR/$_file" ]]; then
      fail_widows=1
      echo "  SUB $_name: FAIL — $_file not found (TYPST_CHECKERS_DIR, or the typst plugin); nothing checked ${_name}s"
      continue
    fi
    c_out="$("$PYEXE" "$CANON_DIR/$_file" "$PDF" --prose 2>&1)"
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

# ---------------------------------------------------------------- verdict
echo "--- verdict"
v() { [[ $1 -eq 0 ]] && echo PASS || echo FAIL; }
if [[ $((fail_plan + fail_compile + fail_quotes + fail_addendum + fail_widows)) -eq 0 ]]; then
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
echo "FAIL: plan=$([[ $NO_PLAN -eq 1 && -z "$PLAN" ]] && echo NOT-CHECKED || v $fail_plan) compile=$(v $fail_compile) quotes=$(v $fail_quotes) addendum=$(v $fail_addendum) strays=$strays_verdict"
exit 1
