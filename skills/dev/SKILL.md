---
name: dev
description: "Use when the user says \"build this feature\", \"implement X\", \"add support for\", \"add a flag for\", \"fix this bug properly\", \"this is broken, fix it\", \"refactor X\", \"write the tests for this\", \"/dev\", or hands over any code change that should ship with a real failing-then-passing test rather than a quick edit. Use proactively the moment a request implies changing code — before reading the codebase to understand the bug, since that reading is part of the run. NEGATIVE ROUTING: a change whose acceptance cannot be one command that fails now and passes later is /craft; a dataset, table, figure or number is /ds even when code produces it; a skill, workflow, hook or plugin manifest in this repo is skill-creator, workflow-creator or plugin-creator; a typo or one-line fix is done inline."
argument-hint: 'the feature, change, or bug to develop'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# dev — a code change, run through craft with a test-first gate

The lifecycle is [craft](${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md). Read it and follow it.
This file is a **delta**: it supplies the domain — the CLARIFY axes, the task-row shape, the lenses,
the mechanical checks, the refs, the authority text. It ships no `workflow.js` and restates none of
craft's mechanics.

What makes a run `dev` rather than plain craft is one thing: **every implementation task carries a
`redCommand`**, so craft's probes execute the failing test before the implementer and the passing
test after it, and the JS reads both exit codes. A task whose acceptance cannot be expressed as one
command that fails now and passes later is not ready to plan.

## Phase 1 — CLARIFY

Craft's Phase 1, on these axes. Ask them **before any reconnaissance**: code says how the system
works, not what the user wants.

1. **Outcome** — what behaviour exists after this run that does not exist now, and what does done
   look like for one user.
2. **Exclusions** — what must not change: files, interfaces, dependencies, behaviour other callers
   rely on.
3. **Automated test framework and the exact command** — the runner, and the literal command string a
   probe will execute. No framework in the repo means the first task is test infrastructure, decided
   here. **A manual-only test proposal is a blocker**: resolve an automated approach or leave this
   workflow. Never waive it silently.
4. **The user workflow, production protocol and transport the real test must exercise** — the action
   sequence a user performs, the protocol production actually uses, and the observable result. A test
   over an alternate path proves nothing about the one that ships.
5. **The first failing test and what RED looks like** — which test fails first, and the failure
   output that counts. A syntax error, an import error, a broken fixture, a missing dependency or an
   unrelated failure elsewhere in the suite is **not** the RED this workflow accepts. This is
   computed, not asserted: `red_probe_gate` classifies a collection/import error as `could-not-run`
   and refuses to dispatch. **For a surface that does not exist yet, that means a stub** — one that
   exists and raises, so the failure is an assertion rather than an ImportError — and the stub is
   named in the plan's `scaffoldPaths` so the main thread may author it while the run is armed.
6. **Required runtime evidence** — what has to be observed at runtime rather than read in source:
   logs, HTTP/WS exchanges, rendered output, exit codes, screenshots.
7. **Review surface** — working tree, commit range, or PR.
8. **Language and its language server** — the language this change is written in (observed for an
   existing repo, decided here for new code), and the LSP that follows from it. Install it
   **before** reconnaissance, project-scoped, so recon and every implementer navigate by symbol
   rather than by grep.

**Installing the LSP is two things, and the plugin is only one of them.**

```bash
claude plugin install <lang>-lsp@claude-plugins-official --scope project
```

`--scope project` writes `enabledPlugins` into `.claude/settings.json` — a committed file, so it
enables the server for everyone who opens the repo; `--scope local` writes
`.claude/settings.local.json` instead. Official servers: `pyright` (py), `typescript` (ts/js),
`gopls`, `rust-analyzer`, `clangd`, `jdtls`, `kotlin`, `csharp`, `php`, `ruby`, `lua`, `swift`,
`liquid`.

The plugin declares a **command**, never a binary — `pyright-lsp` is just
`{"command": "pyright-langserver"}`. Enabling it while the server is absent registers something
that fails at first use with `ENOENT: Executable not found in $PATH`.

**The binary is global, and that is not a preference.** Claude Code resolves `command` from the
process PATH only — never the plugin root, never `${CLAUDE_PROJECT_DIR}`, never a project
`node_modules/.bin` or pixi env. A project-local language server is unreachable by construction;
install it the way this machine installs system tools (nix here, or the distro package), not with
`pixi add`. What stays project-scoped is the *enablement* above and the server's own config —
`pyrightconfig.json` points a global pyright at the project interpreter, and a global
`typescript-language-server` still loads the project's own `typescript` from `node_modules`.

Registration is separate again: a mid-session install is inert until `/reload-plugins`. Self-send
it rather than asking the user to type it. Then **prove it with one `LSP` call on a real file in
the repo** — `documentSymbol` is enough. The install command's exit code says the plugin was
enabled, not that a server answers.

Craft's remaining axes are taken as craft states them, with one domain binding: craft axis 4
(observable success criteria) is answered with the **target project's own** test, lint and build
commands, and those strings become `mechanicalChecks` verbatim.

Then reconnoitre — a scouting `Explore` or `Plan` subagent, never a read of the whole tree into this
conversation — and return: the entry point and data flow, the integration boundaries, the existing
test harness and the files a new test extends, and the decisions code cannot answer. Re-ask only what
reconnaissance newly raised.

Before planning, present 2–3 feasible architectures with their boundaries, testing implications and
trade-offs, and obtain an explicit choice. A sole viable option still needs its trade-off accepted.

## Phase 2 — PLAN

Craft's Phase 2. Three domain requirements on the table:

- **`redCommand` per implementation task** — one invocation, no shell operators, failing now for the
  intended missing behaviour and passing once the task is done. It goes in the plan's Run sizing
  `Test-first:` block too, because it costs 2 agents against the fan-out ceiling.
- **`refs` per task row and per lens** — required, may be empty. Craft's spine does not validate it;
  `wc-probe` P7 refuses an absent key in THIS file, so a live run assembled from an approved plan is
  unchecked. Write `refs: []` to state "no domain rules" rather than omitting the key.
- **Narrow `writablePaths`** — the probe runs a command that loads code the implementer can edit, so
  a wide writable set lets the implementer reach the thing proving its own RED.
- **`scaffoldPaths` for greenfield only, naming files and not directories** — the test suite needs
  no entry (no task writes it, so the guard already allows it); the stub does, because it is the
  implementer's output *and* a precondition of its own red gate. A scaffold as wide as a task's
  writable surface is `scaffold-swallows-task` at plan-lint, and it is the guard turned off with
  extra steps.

## Phase 3 — GOAL

Craft's Phase 3 unchanged.

## Phase 4 — the craft call

The args go in the plan's `<!-- craft:dispatch -->` arming block, and the dispatch is **craft's own
`craft-dispatch.sh`** — never a hand-written runner line. That script owns the TIER 1 plan-lint
gate, which refuses to dispatch on a `major`/`critical` plan finding and fails CLOSED on a verdict it
cannot count; hand-rolling the invocation silently drops it. Craft owns the wait, the result handling
and the return shape too, and `craft-result.sh` reads the verdict. This run's `projectDir` is the
session repo, so craft's own run directory is already inside it and no `--run-dir` override applies.
There is no built-in `Workflow` call — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies that tool outright.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-dispatch.sh   # armed plan; or pass one
```

```js
{
  projectDir,
  goal: "<one sentence>",

  // The plan's table verbatim. Every implementation task carries redCommand and refs.
  tasks: [
    { id: "T1",
      name: "<task name>",
      work: "<what to build>",
      writablePaths: ["<narrow — see Phase 2>"],
      acceptance: "<the criterion the verifier checks>",
      redCommand: "<the exact command from CLARIFY axis 3, scoped to the first failing test>",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/dev/references/tdd.md"] },
  ],

  // The TARGET project's own commands, collected at CLARIFY. Nothing generic — a check that does
  // not run this repo's suite gates nothing.
  mechanicalChecks: [
    { name: "tests", cmd: "<the project's full test command>" },
    { name: "lint",  cmd: "<the project's lint command>" },
    { name: "build", cmd: "<the project's build command>" },
  ],

  // Judged BEFORE any implementer is dispatched; a surviving critical|major returns FAIL having
  // built nothing. Cheap: a spec defect costs a few read-only agents instead of a whole round.
  // Passing reviewLenses REPLACES craft's defaults, so the two defaults are spelled out here
  // rather than elided — an array of three would silently drop them.
  reviewLenses: [
    { key: "criteria-vs-artifacts",
      agentType: "Explore",
      refs: [],
      prompt: "Judge the deliverable strictly against the success criteria in the plan and goal: for each criterion, is there an artifact in the working tree that satisfies it? Missing or partial satisfaction is a finding." },

    { key: "scope-fidelity",
      agentType: "Explore",
      refs: [],
      prompt: "Judge scope fidelity: did the changes stay inside the plan's task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings." },

    { key: "security",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/dev/references/lens-security.md"],
      prompt: "Judge only the security of the changed code, against the finding classes in the refs. Read them in full first. A finding names a file and line and states the concrete attack vector: the input an attacker controls, the path it travels, and what it reaches. Pre-existing defects this change did not introduce are out of scope." },

    { key: "performance",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/dev/references/lens-performance.md"],
      prompt: "Judge only the runtime cost of the changed code, against the finding classes in the refs. Read them in full first. A finding names a file and line, sits on a path that runs often enough to matter, and states the cost as Big-O over the input that actually grows or as concrete latency/memory. Speculation without a growing input is not a finding." },

    { key: "tests",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/dev/references/lens-tests.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/dev/references/tdd.md"],
      prompt: "Judge only the tests covering this change, against the finding classes in the refs. Read them in full first. Read the tests before claiming a gap. Findings: behaviour that ships unverified, an assertion that would not fail when the behaviour it names breaks, a test that exercises a path production does not use, a fixture whose precondition no production writer can produce, and evidence that reads source or logs where the task required runtime behaviour." },
  ],

  authorityExtra: [
    "TDD RULE — no implementation before a genuine RED observation.",
    "Write the smallest real test that exercises the production path this task names, run it, and read the output. Accept RED only when it fails for the intended MISSING BEHAVIOUR — never a syntax error, an import error, a broken fixture, an unavailable dependency, or an unrelated failure elsewhere in the suite. If you implemented before observing RED, delete the implementation and restart the task; a test written beside its fix passes whether or not it ever exercised the defect.",
    "A test must do what the user does. Exercising an alternate protocol or transport, or inspecting source and logs instead of runtime behaviour, is not evidence for a task whose acceptance names a user-visible result.",
    "Your task's redCommand is executed by probes outside your control, before and after you work. A self-reported RED is not evidence and never was.",
    "Rules: ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/tdd.md governs every task. Browser and web work also follows ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/testing-web.md; desktop and native work also follows ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/testing-desktop.md.",
  ].join("\n"),

  verifierAgentType: "Explore",
}
```

`verifierAgentType` and every lens `agentType` pin `Explore` because it has no Edit and no Write: a
judge that structurally cannot modify the tree beats a prompt asking it not to.

**`implementerAgentType` is deliberately unset here, and that is not the oversight it is in a prose
workflow.** A custom agent is justified only by a custom prompt, hooks or preloaded skills, and its
body REPLACES Claude Code's software-engineering system prompt. This workflow's output is code under
TDD, so that prompt is the correct framing rather than a defect — replacing it would cost the
implementer the tool discipline the tasks depend on and buy nothing back. The sibling prose
workflows (`ds`, `writing`, `workshop`) override for the opposite reason: their deliverable is not
code.

Add `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/testing-web.md` or
`${CLAUDE_PLUGIN_ROOT}/skills/dev/references/testing-desktop.md` to a task's `refs` when that
task's real test drives a browser or a native app. `authorityExtra` names them; `refs` is what makes
an implementer read one in full.

Handle the result per craft's Phase 4 — including that a `red-not-red`, `red-unproven` or
`green-not-green` verdict lands in `tasksThatFlagged` and is fixed as a task, not as a lens.

## Phase 5 — HUMAN REVIEW

Craft's Phase 5 unchanged, on the review surface from CLARIFY axis 7.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Guard denies a pre-dispatch write | `--abandon` to get moving | read the denial: an uncovered path is already writable, and a covered one that must pre-exist goes in `scaffoldPaths`. `--abandon` unguards the rest of the session and silences the Stop nudge with it |
| RED is an ImportError on the module being built | call it red and dispatch | the probe refuses it as `could-not-run`; write the throwing stub, declare it in `scaffoldPaths` |
| LSP enabled, binary never installed | trust the install's exit 0 | one `LSP documentSymbol` on a repo file before recon; `ENOENT` there is the whole failure |
| No test harness in the repo | proceed and test by hand | test infrastructure is the first task, decided at CLARIFY — absence of tests is never a waiver |
| The failing test needs two steps | `redCommand: "build && test"` | craft throws on shell operators; put the steps in a script and name the script |
| Task's real test would drive a browser or an app | assert on source or logs | the runtime references are refs on that task; a screenshot with no assertion is not evidence |
| Adding domain lenses | pass the three and let craft add its own | passing `reviewLenses` REPLACES the defaults — spell all five out |
| RED reported by the implementer | accept it | probes execute `redCommand` on both sides; the verdict is the JS's, never the doer's |
| Something craft does not obviously do | write a `dev/workflow.js` | ask which craft parameter is missing — `redCommand` itself came from exactly this question |
