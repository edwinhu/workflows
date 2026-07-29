---
name: beat-clarify
description: "Shared CLARIFY primitive — AskUserQuestion then a criteria table where every row names its own evidence. Read by any phase that opens work with the user."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — CLARIFY

`clarify = ASK + criteria`

The opening beat of any workflow phase that starts with the user rather than with the code. Read by
`ds` (brainstorm), `dev-clarify`, `writing-setup`, `workshop`, and `mini` beat 1, so the shape is
written once instead of five times drifting apart.

**The caller supplies:** the question axes for its domain, and the artifact path to write
(`.planning/SPEC.md`, `.planning/MINI.md`, …). Everything below is domain-agnostic.

<EXTREMELY-IMPORTANT>
## Ask before you look

**No grep, no file read, no draft, no proposed approach until `AskUserQuestion` has run and the user
has answered.**

Looking first feels efficient and is not. What already exists anchors the questions you ask — you
stop asking *what the user wants* and start asking *which of these existing shapes they want*. The
questions narrow, the user ratifies a framing they never chose, and you build the wrong thing
quickly. **Speed toward the wrong deliverable is not helpfulness; it is rework you authored on the
user's behalf.**

Loading your own procedure files is exempt. This bans reconnaissance into the task, not reading your
own instructions.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Every criterion names its own evidence

**A criterion you cannot check is not a criterion. It is a wish.**

Each row carries the *specific* thing that will prove it — a command and its expected exit, a file
that must contain a string, a rendered page someone looks at, a source that must be quotable, a
question only the user can answer.

"Works correctly," "reads well," "is clean," "is done" are unfalsifiable, which lets a verifier agree
with you about nothing. A verdict on an unfalsifiable criterion is an unverified claim presented as
fact.
</EXTREMELY-IMPORTANT>

## Procedure

1. **Ask first.** One `AskUserQuestion` call, up to four questions, 2–4 options each. Target the axes
   where different answers produce *materially different work*:

   | Axis | Ask when |
   |---|---|
   | **Outcome** | More than one plausible end state exists |
   | **Scope** | The boundary between "this" and "also this" is unclear |
   | **Constraint** | Format, tool, location, or style is unstated and not obvious |
   | **Done-ness** | You cannot yet name what would prove it finished |

   Always ask the done-ness question in some form — it becomes the criteria table, and it is the one
   users most reliably have an opinion about once asked.

   Do **not** ask what a careful colleague would decide themselves, or what sits in a file you may
   read after this beat. Ambiguity you can resolve is not a question; it is a decision you are
   avoiding.

2. **Write the artifact** the caller named: intent in the user's terms, what is explicitly out of
   scope, and the criteria table with a non-empty Evidence cell on every row.

3. **Deferred evidence is allowed, and must be marked.** Some domains genuinely cannot name evidence
   yet — a DS spec cannot state actual row coverage before the profiling phase, which the brainstorm
   phase is forbidden to run. Write `TBD (<phase that will fill it>)` rather than inventing a
   number. An unmarked TBD is a missing criterion; a marked one is a scheduled one.

## Gate

The artifact exists, intent is written, and every criterion row has a non-empty Evidence cell —
either concrete or an explicitly marked deferral. Missing evidence means go back and ask, never
invent one.

## Red flags

| Action | Why wrong | Do instead |
|---|---|---|
| About to read a task file before the first question | Existing shapes anchor the questions; the user ratifies a framing they never chose | Ask first |
| About to skip asking because the task "is obvious" | Obvious tasks are where unstated scope hides; the ask took 30 seconds | Ask anyway — one question is a valid clarify |
| About to write "works correctly" as evidence | Unfalsifiable; the verifier can only agree with nothing | Name the command, file, or observation |
| About to hand-write an "Other" option | `AskUserQuestion` appends one automatically; you just burned a scarce option slot | Use the four slots for real alternatives |

## Facts

- `AskUserQuestion` appends an "Other" option to every question automatically.
- Batch questions into ONE call **unless** an answer changes which questions follow — a dataset
  choice that determines the available variables must be asked before the variable question, not
  beside it.
