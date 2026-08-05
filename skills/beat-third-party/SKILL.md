---
name: beat-third-party
description: "Shared THIRD-PARTY primitive — farm one advisory second opinion out to a model that is not Claude, with the domain's own rules handed over as data and receipted."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — THIRD-PARTY

`third-party = a different model, advisory, last`

Every review surface in this repo is Claude reviewing Claude. A workflow dispatches a doer and then a
*fresh* verifier — independent in context, identical in model and training. A defect both instances
share is invisible by construction, and adding more Claude verifiers does not touch it. This beat is
the one thing that can.

It is owned here once so that the reading rules below are written once. They were previously spelled
out in three places, which is two places where they could go stale.

## Iron Laws

- **NO THIRD-PARTY REVIEW WITHOUT AN OPT-IN IN THE AUTHENTICATED PLAN.** Default OFF is the *absence*
  of the line, not a line saying off, so a plan approved before this existed still authorises exactly
  what it did.
- **NO READING `findings` BEFORE `status`.** An adapter that failed and an adapter that reviewed
  cleanly both present as `findings: []`.
- **NO GATE MAY CONSULT IT.** Not the verdict, not the findings, not the status.
- **NO RUNNING IT BEFORE CLAUDE'S OWN VERIFIER HAS PASSED.** One that runs first duplicates a pass
  Claude was going to make anyway; one that runs last sees vetted work and can only add.

## Invocation

```bash
echo '{"projectDir":"<abs>","workflow":"<workflow>",
       "planReset":{"planFile":"<plan>","planHash":"<hash>"},
       "scope":{"kind":"working-tree"},
       "skills":["<skill>", "..."]}' \
  | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/third-party-review.ts
```

| key | required | what it is |
|---|---|---|
| `planReset` | yes | plan identity. The runner re-hashes the bytes and refuses a `planReset` that differs from the receipt-selected plan |
| `scope` | no | `{"kind":"working-tree"}` (default), `{"kind":"branch","base":"origin/main"}`, or `{"kind":"document","path":"..."}` |
| `skills` | no | **the domain's own rules**, handed to the reviewer as data — see below |

**Which adapters run comes from the plan, not from here.** The opt-in line names them:

```markdown
- **Third-party review:** prose-codex, prose-gemini
```

Naming several runs all of them, which is usually right rather than extravagant: over three review
rounds of this feature eight findings were raised and only **one** was found by more than one
adapter. The value is in the disagreement, which is why findings carry attribution and why one
adapter failing never suppresses another's.

## `skills` — the rules, handed over rather than asked for

The reviewer is a different model with no reason to know a domain's standards. It used to be *told*
to load two skills; nothing checked whether it had, and after one real review the question turned out
to be unanswerable rather than merely unanswered. So the rules are handed over as data.

Each entry is either a skill name (`ai-anti-patterns` → its `references/third-party-brief.md`, else
its `SKILL.md`) or one skill-relative path (`ai-anti-patterns/references/12-economist-2026-corpus-study.md`).

| caller | typical `skills` |
|---|---|
| writing | `["ai-anti-patterns", "de-ai-revise"]` |
| dev | `["dev"]` |
| ds | `["ds"]` |

**A missing bundle name throws — it does not resolve to zero rules.** A typo that silently supplied
nothing would produce a reviewer judging against nothing and reporting cleanly, which is the same
silent zero `status` exists to prevent, one layer up. Over the 60 KB cap throws too, rather than
truncating a rule set mid-sentence.

**`briefSources` on each review is the receipt** — skill, path, bytes and sha256 of exactly what was
handed over — and it is carried on **every** path, failures included. Read it rather than assuming
the `skills` you passed were applied: an adapter that does not consume bundles reports `[]`, which is
the honest answer that the rules never reached the reviewer.

## Reading the result

**Read `status` before `findings`.** The top-level `status` is the **weakest** claim any adapter
supports; each entry in `reviews[]` also carries its own.

| status | meaning | `findings: []` means |
|---|---|---|
| `reviewed` | the provider ran and its output was understood | genuinely clean |
| `unavailable` | it could not be reached, or threw | **that adapter looked at nothing** |
| `unparseable` | it ran but its output could not be read; raw text preserved | **nothing was parsed** |
| `skipped` | the plan carries no opt-in | the step does not exist for this episode |

This is not hypothetical. One shipped wrapper returns empty text while reporting `is_error:false`,
`subtype:"success"` and billed output tokens, because the harness derives its `result` field from the
last content block and one provider appends an empty `thinking` block. Reading `result` would have
made every such review report "no findings" and read as agreement.

⚠ **An `unparseable` adapter has not necessarily said nothing — RE-READ IT BEFORE DISCARDING IT.**
Measured on v5.131.0: one adapter reported `unparseable` while having produced **seven** real
findings, one of them a truncated sentence that no internal gate had caught. They were lost at the
parse step, not at the reviewer. The selection rule is fixed; the lesson stands. On `unparseable`,
quote `reason` and read:

- `raw` — the assistant text that failed to parse, kept **head and tail** (the cause is at the head;
  the accounting is at the tail);
- `transcript` — the provider stdout, which is the only field where a `tool_use` block can appear, so
  it is the only way to answer "did the reviewer open any files?".

The two reasons are distinct and call for different fixes: *no JSON object* means the reviewer
answered in prose and the prompt needs work; *a JSON object with no `findings` array* means it
answered in the wrong shape and the schema does.

## Advisory, structurally

Convert each finding into one advisory `TaskCreate` bound to the current `planHash`, **naming the
adapter that raised it**, then proceed to the gate regardless of the outcome.

The runner exits 0 when findings exist — including `critical` — and 0 when a provider was
unreachable; only its own contract errors are non-zero. An external model's claims are unverified by
construction: nothing here re-derives them, and the adapters cannot tell a confident hallucination
from a real finding. **A third-party `approve` is not a gate pass and is not user approval**, for the
same reason a peer agent's message is not user approval.

What would have to change for findings to gate is recorded in `docs/DESIGN-third-party-review.md`.
Four prerequisites, all unmet.

## Cost — measured, and this figure has been wrong twice, low both times

| version | claim | what it was |
|---|---|---|
| v5.127 | "$0.12 per adapter" | counted only the ~22k input tokens of system prompt and skill roster — the floor, mistaken for the bill |
| v5.131 | "$1.18 for the pair" | measured, but on a run where both adapters answered in 1–3 turns |
| v5.132 | **$10.35 for the pair** | $4.198 (520s, 9 turns) and $6.152 (144s, 18 turns) on one ~40k document |

Cost is dominated by **turns**, not by the document. Asking the reviewer to open sources is what
moved 3 turns to 9–18, and it moved the bill about 9×. Budget **$5–15 per pair** and read
`usage.totalCostUsd` for the real number — that field exists precisely so no one has to trust a
figure in a document.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Report an adapter as clean because `findings` is empty | `unavailable` and `unparseable` are also empty | Branch on `status` first |
| Discard an `unparseable` adapter as silent | Seven real findings were lost this way | Read `raw` (head and tail) and `transcript` |
| Treat a third-party `approve` as a gate pass | One unverified opinion from a model with no authority here | Run the gate; the third party never satisfies it |
| Run it before the verifier | It reports on work nobody has vetted | Run it only after the verifier PASSes |
| State which rules the reviewer applied from the `skills` you passed | That is the assertion this design replaced | Read `briefSources` |
| Add a domain's rules by editing an adapter | That is what made the adapter single-domain | Pass them in `skills` |
