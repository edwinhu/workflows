# `scoredChecks` — advisory scores computed in JS from agent-returned counts

An optional work parameter for the *advisory* half of a diagnose loop: a weighted 0–10 composite
per item. What makes it worth having is not the number but **who computes it**. The agent returns
RAW COUNTS; `work` computes every score in JS from constants the caller declared. An agent that
reports its own score inflates it; an agent that reports counts cannot, because it never sees the
formula.

It **never gates**. See [S6](#s6--advisory-structurally-on-both-return-paths) and the rationale at
the end.

## S1 — The parameter

```js
scoredChecks: [{key, items, prompt, schema, components, refs, agentType?}]   // optional
```

Absent or `[]` means the phase never opens and **no agent is dispatched**. One agent per `items`
entry, all in parallel, mirroring `mechanicalLeg`.

| field | meaning |
|---|---|
| `key` | name for this check, used in `scores[].key` and in `scoreTable` reporting |
| `items` | the things to score — one dispatched agent each |
| `prompt` | caller text for the agent. `work` appends the standing instruction that only counts are wanted |
| `schema` | the flat count schema the agent returns — see S2 |
| `components` | the declared arithmetic — see S3 |
| `refs` | absolute paths the agent must read |
| `agentType?` | optional pin (e.g. `Explore`); absent passes no key, so the dispatcher default applies |

## S2 — The agent returns counts, never scores, enforced by a WHITELIST

Every key of `schema` must be either `itemsChecked` or a name appearing as a `penalties` key in some
`components` entry, and each must be declared `type: 'number'` or `type: 'integer'` with **no nested
`properties`**. **Any other key throws at arg-validation, whatever its type.**

A blacklist keyed on `type: 'number'` plus a name pattern does not close this: `{compositeScore:
{type: 'integer'}}` is neither `number`-typed nor caught, and the agent then self-reports the very
number this parameter exists to compute.

Additionally, a whitelisted name matching `/score|composite|rating|grade/i` throws, so a count cannot
be smuggled in under a score-shaped name. A schema permitting a score does not weaken the property,
it silently removes it.

## S2a — `passthrough` — evidence a score never reads

The whitelist of S2 admits `itemsChecked` and penalty keys only, and that turned out to be
unusable by the first real caller. Teaching's slide-auditor returns three kinds of field:

| kind | example | role |
|---|---|---|
| penalty count | `missing`, `collapsed`, `redundant`, `mismatches` | feeds a component score |
| **numeric denominator** | `covered`, `totalDQ`, `spotChecks` | what a finding is stated *against* |
| **item list** | `missingItems`, `mismatchItems` | what each finding is *built from* |

Only the first was expressible, so a port would have had to dispatch the auditor twice — once for the
counts and once for the evidence those same counts describe.

`passthrough: ['covered', 'totalDQ', 'spotChecks', 'missingItems']` declares the rest. It stays a
**whitelist**: an undeclared field is still refused, and the alternative of "allow anything
non-numeric" would not have worked anyway, since the denominators *are* numbers.

Passthrough fields **come back** in the entry for their item, under one `evidence` key:

```js
{key, item, components: {…}, composite, itemsChecked, evidence: {covered: 40, missingItems: ['CASE-17']}}
```

Nested rather than spread, so an evidence field can never collide with `key`, `item`, `composite` or
a component name. The key is **absent entirely** when the check declared no `passthrough` or the
agent reported none of it, so an existing caller's entry is byte-identical. `evidence` survives an
item that scored `null` — what the agent looked at is how you read the `null` — but a **dead** agent
reports none, because there is none.

Passthrough fields are never read by any arithmetic. Four rules keep the guarantee:

- an undeclared schema field is refused, exactly as before;
- a field may not be **both** a penalties key and passthrough — it either feeds a score or is
  evidence, never both;
- `passthrough` naming a field the schema does not declare throws;
- **the score-shaped-name check applies to passthrough too.** A field named `qualityComposite` is
  refused whether it is declared as a count or as evidence, because otherwise the new door is exactly
  the way an agent-supplied number gets in.

## S3 — `work` owns the arithmetic, declaratively

Each `components` entry is `{name, weight, base, penalties: {<countField>: <perUnit>}}`, and the JS
computes:

```
score_i    = max(0, base_i − Σ_k penalties_i[k] · counts[k])
composite  = Σ_i weight_i · score_i
```

Scores are computed **per item and never aggregated across items**. For item `j`:

```
score_ij   = max(0, base_i − Σ_k penalties_i[k] · counts_jk)
composite_j = Σ_i weight_i · score_ij
```

`scores[]` holds one entry per (key, item) pair, in dispatch order:

```js
{key, item, components: {<name>: score|null}, composite: composite_j|null, reason?}
```

`work` emits **no cross-item mean, total or rank** — combining items is the caller's business, and an
average taken over a `null` item is exactly the vacuous number S4 forbids.

A `penalties` key naming a count field the schema does not declare **throws**: it would contribute
zero silently, and a penalty that never fires is indistinguishable from one that never applied.

### Worked example — the teaching `slides` SKILL.md block

The `slides` workflow declares, per lecture, in its `scoredChecks` (teaching `skills/slides/SKILL.md`):

```js
scoredChecks: [{
  key: 'slides-audit', agentType: 'slide-auditor',
  items: [   // one {text, inputs} item per lecture in scope; inputs feed the S8 fingerprint
    {text: 'L1 | deck=<deck> | inventory=<inv> | source=<tm> | pptx=<pptx>',
     inputs: ['<deck>', '<inv>', '<tm>', '<pptx>', '<master>']},
  ],
  prompt: '…audit ONE lecture against its inventory and report counts…',
  refs: [VERIFICATION_CHECKS, SLIDES_CHECKS],
  schema: {
    type: 'object', additionalProperties: false,
    required: ['itemsChecked', 'missing', 'collapsed', 'redundant', 'mismatches'],
    properties: {
      itemsChecked: {type: 'integer'},   // 0 ⇒ unreliable (S4)
      missing:      {type: 'integer'},
      collapsed:    {type: 'integer'},
      redundant:    {type: 'integer'},
      mismatches:   {type: 'integer'},
      // evidence no score reads (covered, missingItems, …) rides in `passthrough`
    },
  },
  components: [
    {name: 's1', weight: 0.5, base: 10, penalties: {missing: 1.0, collapsed: 0.5}},  // coverage
    {name: 's2', weight: 0.3, base: 10, penalties: {redundant: 0.5}},                // redundancy
    {name: 'x1', weight: 0.2, base: 10, penalties: {mismatches: 1.5}},               // fidelity
  ],
  passthrough: ['covered', 'totalDQ', 'spotChecks', 'missingItems', 'collapsedItems', 'redundantItems', 'mismatchItems'],
}]
```

Weights are `0.5` / `0.3` / `0.2` on s1 / s2 / x1. On a later round S8 re-audits only the lectures whose
`inputs` fingerprint changed or whose deck a task writes. With an agent returning
`{itemsChecked: 41, missing: 1, collapsed: 2, redundant: 4, mismatches: 0}`:

```
s1        = max(0, 10 − 1·1.0 − 2·0.5) = 8
s2        = max(0, 10 − 4·0.5)         = 8
x1        = max(0, 10 − 0·1.5)         = 10
composite = 0.5·8 + 0.3·8 + 0.2·10     = 8.4
```

The schema is **flat**: nested count objects are refused by S2, so `coverage.missing` becomes
`missing`. The agent never sees `0.5`, `0.3`, `0.2`, `1.0` or `1.5`.

## S3a — A count missing at run time is unreliable, not zero

S3's validation covers penalty keys the *schema* omits; it says nothing about a count the *agent*
fails to return, which is routine for an LLM-populated schema. Before computing, every count field
named by any `penalties` key is checked on the returned object. **Absent, `null`, non-numeric,
negative or non-finite** means that item's component scores and `composite` are `null` with reason:

```
count field <k> was not reported
```

No score is produced from a partially populated count set, and **no computed score may ever be
`NaN`** — `Math.max(0, NaN)` is `NaN`, and a clamp spelled `x < 0 ? 0 : x` silently yields `0`, which
S4 itself calls measured-and-terrible.

## S4 — Unreliable is `null`, never a number

When a returned `itemsChecked` is absent or `0`, that item's scores are `null` with a stated reason —
**never `base`, never `0`**.

A check that measured nothing scoring a perfect 10 by subtracting no penalties is the vacuous pass
`work` exists to prevent; a `0` is equally wrong, reading as measured-and-terrible. The teaching `slides` block follows it: a lecture with `itemsChecked: 0` scores `null`.

## S5 — Fail closed on a dead agent, but do not gate

A `null` agent result yields that item's scores as `null` with reason:

```
agent died or was skipped
```

and `scoresReported < scoresRun` is visible in `scoreTable`. It does **not** flip `overallPass` —
this channel never gates, including when it fails. Silence must be legible without being fatal;
those are separable, and conflating them would turn an advisory channel into a gate by the back door.

## S6 — Advisory, structurally, on BOTH return paths

`overallPass` is computed **without reading any scored value**. The scored keys are built once as a
`scoreScore` object `{scoresRun, scoresReported}` and spread into the gate return, so a dimension is
never `undefined` while every neighbouring one is an explicit `null`.

| situation | `scoresRun` / `scoresReported` | `scores` |
|---|---|---|
| `scoredChecks` present, phase ran | counts | one entry per (key, item) |
| `scoredChecks` absent or `[]` | `null` / `null` | `[]` |

`null` rather than `0`, so an unscored run never reads as scored-and-clean.

## S7 — No new selector channel

Scores add no selector. Task and mechanical failures use `tasksThatFlagged` and
`mechanicalThatFailed`; standing blocking review findings use `lensesThatFlagged: ['lens']`.
The lens routes valid task owners into `tasksThatFlagged` and plan-owned diagnoses or standing
blocking findings into `planFindings`. Scored results choose neither RED/GREEN mode nor owner tasks,
and never enter that routing or the gate, even when an agent dies. `overallPass === false` still
requires at least one non-empty selector from the gating dimensions.

## S8 — Carry-forward by input fingerprint

An item may be `{text, inputs: [paths]}` (string items are never carried; a duplicate `text` within a
key throws). A job is **carried** — not dispatched, its prior entry returned with `carried: true` —
iff all four hold:

1. `priorResults.scores` holds a **measured** entry (`composite` finite) for the same `key` and `text`;
2. its `fingerprint` equals `args.scoredFingerprints["<key>::<text>"]`, a non-null string;
3. no `inputs` path overlaps the `writablePaths` of an active task (the fingerprint predates this
   round's implementers);
4. at GATE, `checks.scored` (re-hashed after the agents) still equals it, else the entry becomes `null`
   with reason "carried score's inputs changed during this round".

`work-dispatch.sh` / `work-redispatch.sh --scored-fingerprints` write `scoredFingerprints` (sha256 over
the check minus `items`, its `refs` bytes, the item text and each input's bytes; null when anything is
unreadable), recomputed every round and never carried; `work-checks.sh` emits `checks.scored`. Fresh
entries are stamped with the post-agents value. `fanOut.scored` counts dispatched jobs only
(`scoredCarried` is reported, not counted); `scoreTable.scoresCarried` is `null` without scoredChecks.
There is no selector argument: the carry is derived from bytes, like M1's proven red. Scores still
never gate.

## Why advisory — and why there is no threshold

There is no threshold and no `blockBelow`, and adding one is not a configuration choice this
parameter left open. The retired teaching `slides-diagnose.js` recorded, on the gate it deliberately did not build:

> Redundancy is a MINOR style signal and the weighted `composite` is an advisory 0-10 LLM proxy;
> neither blocks the gate. (Gating on a >= 9.5 composite chased redundancy minors — **the
> over-enforcement treadmill.** Substrate is the convergent signal.)

A knob whose documented history is that using it made things worse should not exist. The convergent
signal is the substrate: deterministic checks (`mechanicalChecks`) and categorical blocking on
`critical|major` findings from the one review lens. Score the run to read it; gate it on something
that can be wrong in only one direction.

`work` has used the shape before, in an advisory review leg since retired: reported beside the
verdict, never in the gate arithmetic.
