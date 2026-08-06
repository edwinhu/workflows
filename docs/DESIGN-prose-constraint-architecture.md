# Prose / AI-writing constraint architecture

Status: **BUILT** (v5.127.0, 2026-08-04). The investigation below is preserved as written; §6
records what shipped and where it differs from the proposal.
Date: 2026-08-04. Motivated by the rule611 comment-letter session, where neither external prose
reviewer (`prose-codex`, `prose-gemini`) gave any evidence it had applied the corpus-gated rules
its prompt told it to load.

---

## 1. What is actually there (verified, not assumed)

Five regex/pattern systems, 238 pattern entries, four loaders, three consumers. Every count and
every wiring claim below was produced by running the code, not by reading it.

### 1.1 The five pattern systems

| # | System | Entries | Lives in |
|---|---|---|---|
| A | **scored-tics** — corpus-gated, `sev1-5` | 13 | `skills/ai-anti-patterns/references/scored-tics-patterns.py` |
| B | **wikipedia-\*** — six files, Wikipedia "Signs of AI writing" | 75 | `skills/ai-anti-patterns/references/wikipedia-*.py` |
| C | **writing-ai-smell-\*** — four constraint pairs | 63 `re.compile` | `references/constraints/writing-ai-smell-{puffery,structure,artifacts,em-dash}.py` |
| D | **domain style** — Strunk / Volokh / McCloskey | 75 | `skills/writing-{general,legal,econ}/references/*.py` |
| E | **diction.yaml** — tiered fancy→plain | 12 always_flag / 29 cluster / 27 density / 26 dropped | `skills/de-ai-revise/references/diction.yaml` |

Plus **stylometrics** (`style_metrics.py`, not a pattern table — a z-scored feature model against a
human corpus) and the **numbered reference prose** `00-…12-…` (model-mediated by construction).

### 1.2 The four loaders

| Loader | Loads | Reached by |
|---|---|---|
| `skills/de-ai-revise/scripts/de_ai_audit.py` | **A + E + stylometrics** | `writing-prose-reviewer` agent (as a *suggested* Bash line), `de-ai-revise` SKILL |
| `scripts/prose-lint.py` | **B + D** | `hooks/writing-prose-check.ts` |
| `references/constraints/check-all.py` | **B + C + D** (auto-discovery) | `writing-prose-check.ts`, `writing-mechanical-gate.ts`, `mechanical-floor-gate.ts`, `workflows/workshop-verify.js` |
| `skills/ai-anti-patterns/scripts/screen.py` | **A + B** | nothing but `tests/test_prose_lint_hook.py` |

### 1.3 Corrections to the working trace

**The wikipedia tables are not dormant. They are the most-run system in the plugin.**
All six carry a `check()` and an `APPLIES_TO`, so `check-all.py`'s Layer-2 auto-discovery executes
them on every writing project — *and* `prose-lint.py` loads the same six tables by explicit path.
`screen.py` is a third, redundant loader, and *that* is what nothing but tests invokes. Verified on
a tic-laden fixture: `prose-lint --only ai-anti-patterns` → 10 hits; `check-all` → 10 hits from the
same six modules; `screen.py` → 11 (it adds the scored-tic layer prose-lint lacks).

**Consequence — a real double-reporting bug.** `hooks/writing-prose-check.ts` runs prose-lint *and*
check-all in the same invocation, and its `PROSE_LINT_SUPERSEDES` set names only the three
`writing-ai-smell-*` constraints. The wikipedia tables are in both engines and are de-duplicated by
neither, so every wikipedia hit inside an edited range is reported to the model twice. The three
non-hook check-all callers de-duplicate nothing at all, so there `writing-ai-smell-puffery` (7 hits
on the fixture) fires alongside `wikipedia-puffery` (2) and `wikipedia-promotional` (3) over
substantially the same spans.

**`de_ai_audit.py` genuinely does not load B, C, or D — confirmed, and it is the consequential
finding.** On the same fixture it returned 9 spans and missed *every* hard-severity artifact:
`As an AI language model`, `I hope this helps`, `turn0search0`, `oaicite`, `stands as a testament`,
`plays a vital role`, `it is important to note`, `Despite these challenges`. Those are exactly the
wikipedia catches. So the one script the prose reviewer is pointed at is blind to the entire
provenance-leak class — the class where a miss is unambiguous and embarrassing.

**`prose.ts` discards the success-path stdout.** Confirmed at
`scripts/beat/adapters/prose.ts` — the `unavailable` and `unparseable` returns carry `raw`, the
`reviewed` return does not. So the transcript that would show whether a `Skill` or `Bash` call ever
happened is dropped, along with `total_cost_usd`. Nothing verifies the "FIRST, load these skills"
instruction, and there is no artifact left over from which anyone could.

### 1.4 The full declaration/enforcement surface

Beyond the loaders: `hooks/hooks.json:117` (PostToolUse Edit|Write → `writing-prose-check.ts`, and
only for `drafts/*.md` or non-deck `*.typ` under an **authenticated approved writing plan** — it
exits silently otherwise); `hooks/writing-mechanical-gate.ts` and `hooks/mechanical-floor-gate.ts`
(PreToolUse blocking gates over check-all); `workflows/writing-verify.js:380` (dispatches
`writing-prose-reviewer` with "Read the domain skill, ai-anti-patterns, and prose constraints
first"); `workflows/writing-verify.js:513` (third-party opt-in parsed out of the plan text);
`agents/writing-prose-reviewer.md:82` (the de_ai_audit Bash line, as prose in a markdown file);
`skills/writing-verify/SKILL.md:37` and `skills/writing-revise/SKILL.md:39,65` (load-the-skill
instructions). **Nothing anywhere gates on a `de_ai_audit` result** — grep for `de_ai` across
`hooks/` and `workflows/` returns nothing.

---

## 2. The diagnosis

The design principle in the brief is right, and I'd sharpen it: the problem is not that one system
is model-mediated. It is that **the same class of check is spread across four loaders with
overlapping tables and no single answer to "what did this draft score?"** Three consequences:

1. **No single audit result exists**, so nothing can be injected anywhere. Each consumer assembles
   its own subset. The reviewer agent runs A+E, the hook runs B+C+D, and the external adapters run
   nothing.
2. **Overlap is invisible and un-deduplicated**, which is why the same puffery gets reported two or
   three times with three different labels and three different severities (`soft` in
   `wikipedia-puffery`, `soft` in `writing-ai-smell-puffery`, `sev4` in scored-tics).
3. **Every path to a reviewer is an instruction, not an injection.** `writing-prose-reviewer.md`
   *suggests* a Bash line. `prose.ts` *asks* for a Skill load. Both are suggestions, in a plugin
   whose doctrine is hooks-over-prompt.

### What must stay model-mediated

Be honest about this rather than pretending everything reduces to regex:

- **Reference 12** (Economist 2026 corpus study) — which tells have *decayed*. A regex cannot
  express "em-dash density is no longer a general signal, only a model-specific one."
- **Rhythm and burstiness judgement** — `style_metrics` produces z-scores; deciding whether a flat
  stretch is bad writing or a deliberately hammering passage is a reading call.
- **Whether a flagged span should actually change.** This is the Iron Law of Goodhart in
  `de-ai-revise`, and it is the correct law. The scorers guide; a human-or-model reads.
- **Everything the reviewer is uniquely for** — claims stronger than their evidence, late-arriving
  paragraph points, undefined jargon.

The line a reader should be able to draw: **if it has a span id, it is deterministic; if it does
not, it is judgement.** That is the proposal's organising rule.

---

## 3. Proposed architecture

### 3.1 One entry point: `scripts/prose-audit.py`

A single deterministic audit over a document, loading **A + B + C-as-absorbed + D + E +
stylometrics**, emitting one JSON span list with stable, citable ids.

```
prose-audit.py --json --style legal draft.md
→ { "spans": [ {"id":"S001","line":42,"col":30,"system":"wikipedia-promotional",
                "label":"promotional: 'rich/vibrant tapestry'","severity":"hard",
                "quote":"…","replace_with":"…"} , … ],
    "signals": { "composite_human_likeness": 26.0, "tic_density": 100.0, "advisories":[…] },
    "z": [...], "counts": {...} }
```

Non-negotiables for it:

- **De-duplication is the point.** Overlapping hits on the same (line, span) collapse into one span
  carrying every contributing label, with the *highest* severity. This is the thing no current
  consumer does, and it is why a puffery phrase currently reports three times.
- **Footnote masking on by default**, reusing `scripts/lib/footnote_mask.py` — the rule
  `de_ai_audit` already enforces and the wikipedia tables currently do not.
- **Stable span ids** within a run, so a reviewer can cite `S001` and citing can be checked.
- Existing scripts stay as thin wrappers so nothing in the test suite or the gates breaks: it
  absorbs `screen.py`'s job entirely (delete it — it is a third loader nobody calls), and
  `de_ai_audit.py` becomes `prose-audit.py --profile de-ai` (the tiered-diction rewrite view the
  de-ai-revise skill needs).

### 3.2 Merge `writing-ai-smell-*` into the wikipedia tables

They are the same system built twice — 63 patterns against 75, overlapping on puffery, promotional
superlatives, filler transitions, and artifacts. Keep the *better* implementation of each: the
`writing-ai-smell-puffery` superlative-self-attribution heuristic (60-char window to a
self-contribution noun) is genuinely better than the wikipedia flat superlative match and should
survive; the wikipedia hard-severity artifact tables are the ones the ai-smell family lacks.

This answers the brief's question 3 directly: **yes, `references/constraints/` and the
ai-anti-patterns references should be one system.** The boundary they currently draw is not
semantic — it is an accident of which was written first. What `references/constraints/` should keep
is the checks that are *not* regex over prose: `writing-no-bold-lead`, `writing-topic-sentences`,
`writing-outline-sync`, `writing-anchored-numbers`. Those are structural, they have real logic, and
they belong in the gate.

Net state-file / constraint-file effect: **-4 files** in `references/constraints/` (the ai-smell
pairs), **-1** script (`screen.py`), **+1** script (`prose-audit.py`). The double-report bug and
the `PROSE_LINT_SUPERSEDES` special case both dissolve rather than being patched.

### 3.3 Evidence injection, not instruction

Every reviewer receives the **same audit output in its prompt**:

| Reviewer | Today | Proposed |
|---|---|---|
| `writing-prose-reviewer` | markdown *suggests* a Bash line | `writing-verify.js` runs `prose-audit.py`, injects spans into the agent prompt |
| `prose-codex` | prompt says "FIRST, load these skills" | `prose.ts` runs `prose-audit.py` and injects spans + inlined decay rules |
| `prose-gemini` | same | same |

Concretely for `prose.ts`: the "load these skills" paragraph is **deleted** and replaced by (a) the
audit's span list and (b) the ~15 lines of reference-12 findings that genuinely cannot be
regex-ed, inlined verbatim. The adapter gets the same span ids the other two reviewers got, so
disagreement between them becomes meaningful.

> **Superseded in part, 2026-08-05.** (a) still holds — deterministic spans are per-document and can
> only be computed in the adapter. (b) does not: inlining the decay rules made `prose.ts` a writing
> adapter under a general name, so the only way to give a reviewer another domain's rules was to edit
> it. They are now caller-supplied via `skills` and receipted in `briefSources`; see
> `docs/DESIGN-third-party-review.md`. The invariant this section was protecting — evidence in,
> instruction out, and checkable afterwards — is unchanged and is what the receipt enforces.

### 3.4 Verification, so ignoring the evidence is checkable

- Add `spanIds: string[]` to the prose finding schema. A reviewer handed spans must cite the ids it
  considered; a finding that quotes a span's text without naming its id is a schema violation.
- `prose.ts` keeps `raw` on the **success** path (truncated), so `total_cost_usd` and the tool-use
  record survive. This is the fix that would have answered the rule611 question at the time.
- A reviewer that returns zero `spanIds` while the audit produced hard-severity spans is reported
  as `unreliable` — the same treatment `writing-verify.js` already gives a section reviewer whose
  evidence was missing or fabricated (`writing-verify.js:590`).

### 3.5 What a reader can tell at a glance

- `scripts/prose-audit.py` — deterministic. Everything it emits has a span id and a file:line.
- `skills/ai-anti-patterns/references/*.md` — model-mediated. Prose, read by a model, never gates.
- The gate hooks — run the audit, block only on `hard`.

Three surfaces, one rule for telling them apart.

---

## 4. Build plan

1. `scripts/prose-audit.py` + unit tests (span-id stability, de-dup collapse, footnote masking,
   severity precedence, `--profile de-ai` parity with today's `de_ai_audit` output).
2. Merge the ai-smell heuristics into the wikipedia tables; delete the four constraint pairs and
   `screen.py`; retarget `tests/test_prose_lint_hook.py`.
3. Rewire `writing-prose-check.ts` to the one entry point; delete `PROSE_LINT_SUPERSEDES`.
   Golden-file update in `tests/golden/writing-prose-check.json`.
4. Inject spans in `workflows/writing-verify.js` and `agents/writing-prose-reviewer.md`.
5. Rewrite the `prose.ts` prompt (evidence in, skill-loading instruction out); keep `raw` on
   success; add `spanIds` to the schema and the unreliable-reviewer rule.
6. `scripts/bump-version.sh <minor>` + contract test + annotated `workflows--vX.Y.Z` tag.

Steps 1–3 are self-contained and land the de-duplication and the coverage fix even if 4–6 slip.

---

## 5. Open question for the user — ANSWERED: block on hard

**Severity semantics.** Resolved as proposed: block on `hard`, advisory on everything else.
`check-all.py` now emits a `severity` per `failed[]` entry read from the constraint module's own
`SEVERITY`, and both `mechanical-floor-gate.ts` and `writing-mechanical-gate.ts` deny only when a
hard entry exists, reporting soft ones in the allow payload as context. Before this, check-all
threw the declared severity away and both gates blocked on any failure at all — so advisory
puffery stopped a phase exactly as hard as a provenance leak, which inverted the intent of the
whole `SEVERITY` convention.

---

## 6. What shipped, and where it differs from §3

| §3 said | What was built |
|---|---|
| one entry point, `scripts/prose-audit.py` | as proposed, plus `--profile de-ai` and a `--style` domain gate |
| overlaps collapse | collapse is by **overlapping column range within a line**, not by line: two distinct phrases on one line stay two findings. Line- and document-anchored spans (stylometrics, diction saturation, the per-section em-dash budget) carry `col: 0` and never merge |
| `de_ai_audit.py` becomes a wrapper | as proposed; its public JSON is byte-identical and both of its test files pass unchanged |
| merge the ai-smell tables into wikipedia-\* | as proposed, except **em-dash density**, which is paragraph- and section-level logic and could not become a line-regex table entry. It moved into `prose-audit.py` (`system: em-dash`, thresholds unchanged) rather than into a wikipedia module, so it is no longer a check-all constraint — it is soft either way, so no gate behaviour changed |
| `writing-verify.js` runs `prose-audit.py` | the Workflow runtime forbids the orchestrator from touching the filesystem, so a read-only relay agent runs it and returns the spans under a schema. The relay judges nothing and its output is bound to the section names dispatched, so a garbled relay degrades to "no evidence" rather than to fabricated evidence |
| hard = the ~33 provenance-leak patterns | hard = those tables **plus scored tics at sev>=4** (9 more). Both classes clear the same "no false positives" bar — the scored tics passed a ~0-human-rate gate against 14.3M sentences — and treating a `rich tapestry` as blocking is the same judgement as treating `citeturn0search0` as blocking |

### Two bugs found while wiring, fixed here

1. **`hooks/lib/writing-plan-context.ts` never parsed the plan's Domain.** `planSection`'s
   `(?=^##\s|$)` uses `$` under the `/m` flag, which matches at the first line break, so every
   section came back `""` — meaning `style` was ALWAYS empty and the Volokh / McCloskey guides
   never loaded for any draft `writing-prose-check.ts` linted. Measured on a real approved plan.
   Fixed to `(?![\s\S])`, the idiom `workflows/writing-verify.js` already used.
2. **`prose.ts` discarded the success-path transcript**, so `total_cost_usd` and the tool-use
   record survived only when the provider FAILED. `raw` is now returned on the `reviewed` path too.

## 7. Emphasis and markup — a SIDE CHANNEL, not a sixth pattern table (v5.134.0)

`neutralize_typst_markup` / `neutralize_latex_markup` blank the call head and both delimiters while
keeping the inner text. That was the right fix for the v5.127.0 HARD false positive (`#emph[First],`
matching the `[Name]` placeholder rule), and it stays exactly as it is. But it has a consequence
nobody wrote down at the time: **emphasis is structurally invisible to every scorer on the `.typ`
and `.tex` paths.** Verified —

```
in:  The market saw #strong[546,088 trades] and #emph[substantial] growth.
out: The market saw         546,088 trades  and       substantial  growth.
in:  Rates rose \textbf{sharply} in \emph{2024}.
out: Rates rose         sharply  in       2024 .
```

The neutraliser treats presentational markup and citation plumbing identically, which is correct
for `#cite[]` / `#footnote[]` and wrong for `#strong[]`. So the design here is deliberately NOT
"stop neutralising" and NOT "add a regex table":

- `collect_emphasis(text, suffix)` harvests bold/italic spans from the **raw text, after footnote
  masking and before neutralisation** — the last moment at which emphasis exists at all.
- `extract_lines` carries them as a third return value alongside the masked text. The prose
  scorers see byte-for-byte what they saw before.
- Two new systems read that list and nothing else: `emphasis` (`bold-lead`, `bold-bare-number`,
  `bold-density`) and `formatting` (`emoji`, which reads prose directly rather than the span list).

Emphasis spans use the same 1-based line/col convention as every other hit, so they collapse
against a scored-tic hit on the same words like any other pair. `_find_closer` is shared with the
neutraliser rather than duplicated — one depth-matched bracket walk, two consumers.

**Severity.** All `emphasis` labels are `soft`. They could not clear the bar `hard` denotes in this
script, because the ai-tic FP-hunt corpus is raw `fitz.get_text()` PDF output in which bold and
italic markup is not preserved — a 0-hit result there means the signal is absent, not that the rule
is clean, which is a gate that cannot fail. They were FP-hunted against local Typst/LaTeX sources
instead. `formatting·emoji` is `hard` by construction, not by corpus: an emoji in a law-review
draft is indefensible on its face. Full record:
`docs/investigations/2026-08-05_emphasis-enforcement.md`.

**`writing-no-bold-lead` now delegates.** The constraint kept its `CONSTRAINT` / `APPLIES_TO` /
`SEVERITY` contract and its `drafts/<file>:<line>: …` violation shape, but its `check()` shells out
to `prose-audit.py --json` and filters for `emphasis·bold-lead`. Leaving its own regex in place
would have been System C all over again — the same rule built twice with different semantics — and
would have double-reported on `drafts/*.md`, because `PROSE_ENGINE_PREFIXES` in
`hooks/writing-prose-check.ts` covered `skills/ai-anti-patterns/` and `skills/writing-` but not
`constraints/`. That prefix list now names `constraints/writing-no-bold-lead` explicitly; it is the
one entry under `constraints/` that is no longer structural.

**Scope.** Text formats only (`.md`, `.typ`, `.tex`). `.docx` bold runs are deferred — the em-dash
system already skips docx for the same reason, and a docx paragraph list has no column anchoring.

### A slide deck is not a draft (v5.134.1)

`hooks/writing-prose-check.ts` has always refused to lint a `.typ` slide deck, and that stays: a
deck is fragments and labels, not running prose. But the hook is not the only way in — auditing a
deck deliberately from the CLI is a real thing to want, and there `formatting·emoji` would have
been `hard`, which is wrong. Emoji in teaching slides are the author's choice, not a provenance
leak. So `prose-audit.py` detects the deck itself and drops that one rule to `soft`: the finding
still appears (you asked for the audit) but it cannot block a gate, which is what `hard` is for.

Nothing else is relaxed in a deck. `emphasis·bold-density` and `emphasis·bold-lead` will fire on
most decks, because slides really are bold-heavy and fragmentary; that is a known, deliberate
limit of auditing a deck, not a bug to work around by loosening the rules for drafts.

**The predicate now exists twice, in two languages, and the duplication is pinned rather than
hoped about.** The hook needs it BEFORE it spawns anything — it also skips check-all and the plan
lookup — so it cannot ask the script; the script needs it independently for severity.
`tests/writing-prose-check.test.mjs` runs both over a shared fixture set and asserts they agree,
and asserts the expected answers besides, so "they agree with each other" cannot pass by both
being wrong. It found a divergence the first time it ran: the TypeScript side never checked the
suffix, so a `.md` file containing `#slide(` was a deck there and not here. Harmless at the hook's
one call site, which already guarantees `.typ` — and exactly the kind of drift a duplicated
predicate accumulates when nothing compares the two.
