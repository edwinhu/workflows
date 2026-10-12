---
name: replicate-paper
description: "Use when a published empirical finance or accounting result has to be reproduced from data — 'replicate Table 2 of X', 'does this paper replicate', 'reproduce their main result', 'can we get their coefficient', 'our estimate doesn't match the paper', 'grind this replication', 'run an in-design search on this paper', 'apply the AGK rule to X', 'search inside their design until it hits or the leads run out', 'is this hit fragile'. Use proactively whenever a task compares our estimate to a printed coefficient, even if the user never says 'replicate'. NEGATIVE ROUTING: packaging code and data for someone else to rerun is replication-package; building a dataset or model with no published target is ds; the bare out-of-session loop mechanics are grind."
user-invocable: true
---

# replicate-paper — locked reproduction, then a fenced, disclosed in-design search

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Templates: `${CLAUDE_SKILL_DIR}/templates/check.sh`, `${CLAUDE_SKILL_DIR}/templates/PROMPT.md`,
`${CLAUDE_SKILL_DIR}/templates/ledger.csv`. Worked example (ADKO not reproduced, Antoniou fragile hit):
`${CLAUDE_SKILL_DIR}/references/worked-example.md`. Scoreboard rows and the appendix paragraph:
`${CLAUDE_SKILL_DIR}/references/closing-and-disclosure.md`.

A replication is a locked reproduction of the paper's printed cells on the paper's own sample. When it
fails, the user may authorise an **in-design search** (the AGK rule): deviations only inside the paper's
own design, every specification priced and ledgered, the count disclosed beside any hit. A hit found that
way is a searched specification, never a locked result.

```
fetch paper ─► cite cells & definitions (page/line) ─► lock predictions + bar (user) ─► md5 the lock
   ─► reproduce on the paper's own window ──pass──► extension rows ─► done
                     │ fail
                     ▼
   AskUserQuestion: in-design search? ──no──► record the non-replication ─► done
                     │ yes
                     ▼
   scaffold grind_<id>/ (check.sh, frozen.md5, ledger, PROMPT.md) ─► check.sh at baseline exits 1
   ─► grind.sh run --gate <leads_exhausted key> --wait-alert 1
        ├─ check exits 0 ─► verify hit vs printed table ─► user: accept as fragile? ─► robustness rows ─► disclose
        │                         └─ second gated cell owed? ─► phase 2 (PROMPT2, new journal)
        └─ leads_exhausted filed ─► grind.sh stop ─► record NOT reproduced, with the count
```

<EXTREMELY-IMPORTANT>
## IRON LAW: NO ESTIMATE BEFORE THE LOCK, AND NO BAR CHANGE AFTER AN ESTIMATE

**The bar — which cells, sign, |t|, CI, window — is written, user-approved and md5-frozen before the
first coefficient is computed. After that, only the user changes it, and their words go verbatim into
`check.sh`'s header.** A bar chosen after seeing estimates is a specification search reported as a
replication: it hands the user a result that the next referee takes apart, which is the opposite of
help. If an estimate makes you want to move the bar, that wish is the finding — report it.
</EXTREMELY-IMPORTANT>

## 1. Obtain the paper and cite it

- Get the version of record through the `fetch-paper` skill; `pdftotext -layout` it to a `.txt` beside
  the PDF so every cite is a line number. Only a working paper on disk → say so in `check.sh`'s header
  ("WP values may differ"). *Prevents: a build from memory of the paper, and a fence nobody can adjudicate.*
- Every cell, filter, variable definition, window and winsorizing rule the build uses is cited by page or
  `.txt` line. *Prevents: an "allowed reading" that the paper never offered.*

## 2. Lock predictions and the pass bar

- Write `prediction_locked.md` (bar cell(s), published sign, p threshold, window(s), class/measure rule,
  pre-specified robustness, any predictions) and get it approved through AskUserQuestion. md5 it into
  `frozen.md5` before estimating. *Prevents: the bar drifting toward the estimate.*
- Derive the published SE: `se = |b|/|t|`; when only p is printed, `se = |b|/z` with `z = Φ⁻¹(1 − p/2)`;
  95% CI = `b ± 1.96·se`. State the derivation and the rounding of the printed coefficient in the
  header. Stars only → the CI is undetermined; ask the user, do not invent one.
- **Gate only cells significant in print.** A published null is scored by the matched-null rule (ours
  insignificant at 5% passes), never as a hit. *Prevents: AGK 2019 Table 4 — a "done" inside a null's CI,
  rejected by the user because a null's CI admits almost anything.*
- **Joint rule over every printed-significant cell the user gates.** One step must carry them all IN;
  hits on different steps never combine. Ask which cells are gated before the loop starts.
  *Prevents: CHL `g_34`, DROA IN with BHAR OUT on the same row.*

## 3. Reproduce on the paper's own sample and window first

- The locked reproduction runs on the paper's sample and window before any extension; extension windows
  are separate rows with their own predictions. Data that do not reach the paper's window → the first
  job is the pull, not a different gated window. *Prevents: gating a window the paper never estimated;
  the Antoniou hit came from restoring 2003-2016, not from any construction switch.*
- WRDS through the `wrds` skill: SAS on the SGE grid via qsub only, never Postgres; a one-year test job,
  inspected, then **one pull per source over the whole window**, split by year locally. *Prevents: 18
  serial per-year queries plus count probes, which the user stopped by hand.*

## 4. The in-design grind

Only after the user picks "in-design search" through AskUserQuestion. One loop per paper, under
`scratch/grind_<id>/`, ledger at `data/output/<id>_grind.csv`.

| Piece | Rule | Prevents |
|---|---|---|
| `check.sh` (from the template) | Exit code is the verdict: 0 hit, 1 not yet, 2 integrity. Per cell: published sign, \|t\| ≥ 1.96 on our coef/se, coef inside the published CI. Joint over the gated cells. Prints `BEST`/`MOST_CELLS_IN` progress lines. Run it at baseline; it must exit 1 on the committed run, not 0. | a loop that grades itself; a check that passes on nothing |
| Integrity → exit 2 | frozen files changed, ledger header changed, a `(step, cell, window)` priced twice, non-numeric coef/se, a gated cell that is a published null | silent edits to the locked build; re-pricing until it hits |
| `frozen.md5` | md5 of the committed run's outputs, scripts, tests, note, the lock file and `check.sh` itself | an iteration editing the baseline or the gate |
| Ledger | Append-only CSV, `step,cell,window,class_rule,coef,se,t,p,n,first_stage_F,switches,sample_n`; `g_NN_<slug>`; a corrected build gets a new number | a deleted row the count no longer discloses |
| Declared switches | Every switch vs the committed run, `;`-joined `key=value`, declared in the log before estimating, with the fence reason and the paper's page/line | a hit whose deviations nobody can list |
| `inference_only=1` | Set in `switches` for a step that changes only SEs/clustering; `check.sh` reads the field, never the slug; such a row is priced but never ranks or hits | clustering passed off as a replication |
| No threshold tuning | Median splits, winsor percentiles, bandwidths, size cuts stay at the paper's values; an alternative enters only as a named reading of the text, before its row is priced; N and treated shares are reported, never targeted | tuning a cutoff on the outcome |
| Fence | Allowed: choices the paper leaves open or defensible readings of its text. Forbidden: controls/estimators the paper lacks, selecting on the outcome or residuals, raw-value edits, windows outside the paper's | a "replication" of a model the paper did not run |
| Rejected steps | A step the user later rules out of fence stays in the ledger and the count, and is listed verbatim in `check.sh`'s `REJECTED` set so it cannot hit | BY17 `g_13`, controls in a column that prints none |
| User decisions | Quoted verbatim, dated, in `check.sh`'s header | an operator's paraphrase widening the bar |
| `PROMPT.md` (from the template) | One `g_` row per iteration; ranked leads, each citing the paper's page/line and the code line it would change; stack only switches named before pricing | an iteration re-diagnosing from scratch, or stacking on t |

**Launch through the `grind` skill**, detached, with the gate on the FILED key:

```bash
G=/abs/scratch/grind_<id>; J=$G/<id>.jsonl
setsid nohup bash ${CLAUDE_PLUGIN_ROOT}/skills/grind/scripts/grind.sh run \
  --journal "$J" --prompt-file "$G/PROMPT.md" --check "bash $G/check.sh" \
  --gate "jq -R 'fromjson? | select((.kind==\"floor\" or .kind==\"note\") and .key==\"leads_exhausted\")' $J | grep -q . && { echo 'leads_exhausted filed: operator stop due'; exit 1; } || exit 0" \
  --wait-alert 1 --stall-after 8 --max-iters 40 >"$G/grind.log" 2>&1 </dev/null &
```

The first `wait` after the floor is filed alerts you; answer it with `grind.sh stop`, never by waiting
for the stall count. *Prevents: 3-8 empty iterations after `leads_exhausted` (BKL 10 of 20); and a
`grep -c leads_exhausted` that counted prose mentions as filings.*

**Phase 2 re-arm** — a first hit accepted, another gated cell owed, or the user adds a gate: copy
`PROMPT.md` to `PROMPT1.md`; write `PROMPT2.md` = a `# PHASE 2` header (what phase 1 found, next step
number, the new ranked leads, what not to re-price) + `PROMPT1.md`; a new `check2.sh` when the bar
changes (user's words verbatim); launch with a **new journal** `<id>_p2.jsonl`, same ledger. The phase-1 journal, `PROMPT1.md` and the
superseded check are retired: add them to `frozen.md5`, never resume them, one live journal per loop.
*Prevents: phase-1 floors and the stall count carrying into a different objective.*

## 5. Closing

1. **Verify a hit against the printed table yourself** — re-read the published cells, rerun the hit step
   from its script, confirm `check.sh` exit 0 and the ledger row match. *Prevents: relaying an iteration's
   claim.*
2. **Ask the user (AskUserQuestion) to accept it as fragile, or reject it** — fragile hits are the norm.
   Record the answer verbatim. *Prevents: a search hit promoted to a result by the operator.*
3. **Price robustness rows** the user asks for on the hit build (another window, alternative
   construction, singletons): disclosed, never counted as a second hit even when `check.sh` prints HIT.
4. **Disclose every searched step**: the `g_` count, pulls, rejected and inference-only rows, the
   switches the hit stacks, and what it does not survive.
5. **Scoreboard**: hit rows are appended after the main rows, tagged `in-design search hit:`, with
   `lock_status` `searched` and `n_specs_searched`; the locked verdicts and the main tally do not move.
   Details in `references/closing-and-disclosure.md`. *Prevents: a search silently rewriting the bar's
   pass count.*
6. **Not reproduced** is a result: record the best row per cell, why the fence was exhausted, and the count.

## 6. Composition — use these, do not restate them

| Need | Skill |
|---|---|
| the PDF | `fetch-paper` |
| the loop, journal, floors, stop/status | `grind` |
| SAS/SGE pulls, CCM/link tables | `wrds` |
| delegating a heavy pricing or build step | `farm-out` — the result-deciding fix as its own short row, cleanup as separate rows |
| the estimation code itself | `ds` conventions |

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Compute a coefficient with no `prediction_locked.md` in `frozen.md5` | every later bar is post hoc | lock, get approval, md5, then estimate |
| Gate a cell the paper prints as insignificant | a null's CI admits almost anything | matched-null rule; gate printed-significant cells |
| Count two cells IN on different steps as a joint hit | the paper's result is one coding | joint rule: one step, all gated cells |
| Edit `check.sh`, a threshold or the window after seeing estimates | the gate moves to the estimate | ask the user; new `check2.sh`, their words verbatim |
| Re-price a ledger row or delete one | the disclosed count lies | new step number stating the correction |
| Name a row `_cl`/`_hc` and let the slug decide | the check never sees it | `inference_only=1` in `switches` |
| Gate the loop on a prose grep for `leads_exhausted` | it matches notes about the key | `jq` on `.key=="leads_exhausted"` |
| Let the loop run after `leads_exhausted` is filed | each pass is an empty model call | `grind.sh stop` on the first alert |
| Arm a session hold beside the grind on the same objective | each waits on the other | one driver: the grind |
| Loop a WRDS pull by year, or query Postgres | the user stopped exactly this | one SGE pull per source, one-year test first |
| Report a hit without the `g_` count and the stacked switches | a searched row read as a replication | disclose the count beside the hit |
| Move a main-row verdict because a search hit landed | the locked bar stops meaning anything | append a tagged hit row; main tally unchanged |
