#!/usr/bin/env bash
# Loop <ID> (user, <YYYY-MM-DD>): in-design replication grind on <Authors (Year, Journal)>, <Table N Panel X>,
# <cell description>. Paper read as <version of record | WP only: published values may differ>, text <paper.txt>.
# Exit 0 done, 1 not done, 2 integrity.
#
# USER DECISIONS (verbatim, dated; the only way this header or the CONFIG block below changes):
#   <YYYY-MM-DD> "<quote>"
#
# JOINT RULE: done = ONE `g_` step, in ONE gated window read, on which EVERY cell in PUB is IN.
# IN = published sign, |t| >= 1.96 on our own coef/se, coef inside the published 95% CI, and (if MIN_F is set)
# first_stage_F >= MIN_F. Published SE derivation, per cell (state the printed values and rounding here):
#   <cell> coef <b>, t <t>  -> se = |b|/|t|
#   <cell> coef <b>, p <p>  -> se = |b|/z, z = Phi^-1(1 - p/2)
# Published nulls never count and may not be listed in PUB (integrity exit 2). Rows whose `switches` carry
# inference_only=1 print but never rank or hit (declared field, not the slug). Steps in REJECTED (user ruled
# out of fence) stay in the ledger and the count but never rank or hit. Windows outside GATE_WINDOWS print,
# never hit. The ledger is append-only: header frozen, (step, cell, window) unique.
set -u
ROOT=/abs/path/to/project          # CONFIG
LOOP=scratch/grind_ID              # CONFIG
cd "$ROOT" || exit 2
if ! md5sum --quiet -c "$LOOP/frozen.md5"; then echo "INTEGRITY: frozen file changed"; echo "NOT DONE"; exit 2; fi
LEDGER=data/output/ID_grind.csv python3 - <<'PY'
import csv, os, sys
from statistics import NormalDist

# ---------------------------------------------------------------- CONFIG (edit at setup; frozen after)
LEDGER = os.environ["LEDGER"]
HEADER = "step,cell,window,class_rule,coef,se,t,p,n,first_stage_F,switches,sample_n"
# cell -> (published coef, published t or None, published p or None); one of t / p is required
PUB = {
    "CELL_A": (0.145, 5.09, None),
    "CELL_B": (0.037, None, 0.006),
}
GATE_WINDOWS = ("YYYY-YYYY",)      # the paper's own window first; others only by user decision
MIN_F = None                       # e.g. 10.0 when the user gates the first stage
REQUIRED_SWITCHES = set()          # tokens a row must declare to count, e.g. {"measure=fund"}
REJECTED = set()                   # steps the user ruled out of fence, e.g. {"g_13_controls_col1"}
# ---------------------------------------------------------------- end CONFIG

def die(msg):
    print("INTEGRITY: " + msg); print("NOT DONE"); sys.exit(2)

CI = {}
print("published cells, gated jointly (95% CI = coef +- 1.96 se):")
for c, (b, t, p) in PUB.items():
    if t is not None:
        se = abs(b) / abs(t); tt = abs(t); basis = f"t {t}"
    elif p is not None:
        tt = NormalDist().inv_cdf(1 - p / 2); se = abs(b) / tt; basis = f"p {p} -> z {tt:.3f}"
    else:
        die(f"{c} has neither a published t nor p")
    if tt < 1.96:
        die(f"{c} is a published null ({basis}); gate printed-significant cells only")
    CI[c] = (b, se, b - 1.96 * se, b + 1.96 * se)
    print(f"  {c}: coef {b} ({basis}) se {se:.6g} CI [{CI[c][2]:.6g}, {CI[c][3]:.6g}]")

if not os.path.exists(LEDGER):
    die("ledger missing")
with open(LEDGER) as fh:
    if fh.readline().strip() != HEADER:
        die("ledger header changed")
rows = list(csv.DictReader(open(LEDGER)))
seen = set()
for r in rows:
    k = (r["step"], r["cell"], r["window"])
    if not r["step"].startswith("g_"):
        die(f"non-g_ step {k}")
    if k in seen:
        die(f"duplicate ledger row {k} (steps are never re-priced)")
    seen.add(k)
    try:
        float(r["coef"]); float(r["se"])
    except ValueError:
        die(f"non-numeric coef/se in {k}")

def toks(r):
    return {x.strip() for x in (r["switches"] or "").split(";") if x.strip()}

def verdict(r):
    c = r["cell"]
    b, se = float(r["coef"]), float(r["se"])
    pb, _, lo, hi = CI[c]
    if se <= 0:
        return "OUT (se<=0)", None
    t = b / se
    sw = toks(r)
    if "inference_only=1" in sw:
        return "inference-only (never hits)", t
    if r["step"] in REJECTED:
        return "rejected by user (never hits)", t
    if r["window"] not in GATE_WINDOWS:
        return f"window {r['window']} not gated", t
    if REQUIRED_SWITCHES and not REQUIRED_SWITCHES <= sw:
        return f"missing required switch {sorted(REQUIRED_SWITCHES - sw)}", t
    if b * pb <= 0:
        return f"OUT (sign, coef {b:+.5g})", t
    why = []
    if abs(t) < 1.96:
        why.append(f"|t| {abs(t):.2f} < 1.96")
    if not lo <= b <= hi:
        why.append(f"coef {b:.5g} outside CI [{lo:.5g}, {hi:.5g}]")
    if MIN_F is not None:
        try:
            f = float(r["first_stage_F"])
        except ValueError:
            f = None
        if f is None or f < MIN_F:
            why.append(f"first-stage F {r['first_stage_F'] or 'missing'} < {MIN_F}")
    return ("IN" if not why else "OUT (" + "; ".join(why) + ")"), t

g = [r for r in rows if r["cell"] in CI]
print(f"ledger rows: {len(rows)}; g_ steps: {len({r['step'] for r in rows})}")
by, best = {}, {c: None for c in CI}
for r in g:
    v, t = verdict(r)
    by.setdefault((r["step"], r["window"]), {})[r["cell"]] = (v, t, r)
    print(f"{r['step']} win={r['window']} {r['cell']} coef={float(r['coef']):.5g} se={float(r['se']):.5g} "
          f"t={'nan' if t is None else f'{t:.2f}'} n={r['n']}: {v}")
    ranks = t is not None and not v.startswith(("inference-only", "rejected", "window", "missing"))
    if ranks:
        signed = t if CI[r["cell"]][0] > 0 else -t
        if best[r["cell"]] is None or signed > best[r["cell"]][0]:
            best[r["cell"]] = (signed, r["step"], r["window"], v)
for c, b in best.items():
    print(f"BEST {c}: " + ("none" if b is None else f"{b[1]} win={b[2]} signed t={b[0]:.2f} -> {b[3]}"))
hits, most = [], (0, "")
for (s, w), cells in sorted(by.items()):
    nin = sum(v == "IN" for v, _, _ in cells.values())
    if nin > most[0]:
        most = (nin, f"{s} win={w}")
    if len(cells) == len(CI) and nin == len(CI):
        hits.append(f"{s} win={w}: " + "; ".join(f"{c} coef {float(cells[c][2]['coef']):.5g} t {cells[c][1]:.2f}" for c in CI))
print(f"MOST_CELLS_IN: {most[0]} of {len(CI)}" + (f" ({most[1]})" if most[1] else ""))
for h in hits:
    print("HIT", h)
print("DONE" if hits else "NOT DONE")
sys.exit(0 if hits else 1)
PY
