/**
 * THE MEASURED BYPASS MATRIX, AND EVERY EVASION FOUND SINCE, AS EXECUTABLE CASES.
 *
 * The Bash side door was found by hand: eighteen ways to write a project file through the Bash tool,
 * run against all six governed workflows' orchestrator guard. 46 of the 108 cells were ADMITTED —
 * `dev` and `work` had no Bash branch at all and admitted 18/18, `ds` admitted 10/18 because its
 * checks only rejected redirection and a few Python keywords. Only the three allowlist workflows
 * (`writing`, `workshop`, `workflow-creator`) were closed.
 *
 * That measurement lived in a report. Nothing in the repository reproduced it, so nothing would
 * notice it regressing, and nothing pinned the evasions found afterwards either. This file is that
 * missing evidence: the matrix must close 108/108, each evasion must stay closed, and — just as
 * load-bearing — the read-only forms must stay ALLOWED, because a false deny here is ordinary
 * orchestration breaking.
 *
 * SCOPE, AFTER ROUND 8. This file now tests `orchestrator-mutation-guard` + `classifyBashMutation`
 * and NOTHING ELSE. It used to also carry ~270 lines asserting properties of `_bash_allowlist.ts` —
 * FLAG_EVASIONS, ARITY_EVASIONS, UNRECOGNIZED_FLAGS, DENIED_SPELLINGS, a 1286-cell option/arity
 * cross product. Round 8 deleted the allowlist's role: a restricted actor now gets no Bash at all,
 * the gate never reads a command, and those assertions described a module nothing calls. They were
 * removed rather than left green, because a passing assertion about dead code is worse than no
 * assertion — it reads as active enforcement. What replaced them is
 * `tests/restricted-actor-bash.test.mjs`, which asserts the new rule end to end.
 *
 * WHICH OF THESE TWO MODULES IS STILL LIVE, since the answer is not symmetric:
 *   - `_bash_mutation.ts` (this file) IS reachable in production. `orchestrator-mutation-guard` is
 *     wired with a Bash-inclusive matcher by `ds-delegate`, `ds-fix`, `writing`, `writing-draft`,
 *     `writing-revise`, `workshop`, `workshop-revise`, `workflow-creator` and
 *     `workflow-creator-improve`, and it is RECEIPT-BLIND — it fires during PRE-approval work,
 *     where the identity gate is inert. Not dead; do not delete on the strength of round 8.
 *   - `dev` and `work` still wire only `Write|Edit|MultiEdit|NotebookEdit`, so their columns below
 *     remain hypothetical. See the attribution comment at the matrix.
 *
 * Run: bun tests/bash-mutation-matrix.test.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyBashMutation } from "../hooks/_bash_mutation.ts";

const REPO = new URL("..", import.meta.url).pathname;
const GUARD = join(REPO, "hooks", "orchestrator-mutation-guard.ts");
const WORKFLOWS = ["ds", "dev", "work", "writing", "workshop", "workflow-creator"];

/**
 * Measured, then pinned. Of the 26 read-only invocations in READ_ONLY, `dev`/`work` admit all 26
 * (they have no Bash allowlist of their own and the classifier flags none of these); `ds` admits 23
 * against its stricter pre-existing checks; and the three named-command allowlist workflows admit
 * 5 each — only what their own lists name. A workflow that started denying everything would look
 * identical to a correct one on the deny side alone, which is why this exists.
 */
// 5 -> 7 for the three allowlist workflows in `0e5386b3`, which added `ls` and
// `cat|head|tail|wc|stat|file` to the read-only regex so an orchestrator can READ the files it is
// reasoning about. The two newly-admitted corpus entries are exactly `ls -la` and `cat src/a.js`;
// verified command-by-command rather than by adjusting the number until the assertion passed. This
// number is the whole point of the check, so moving it without naming the commit and the commands
// converts the test into a rubber stamp.
const ALLOW_SIDE_EXPECTED = { ds: 26, dev: 26, work: 26, writing: 7, workshop: 7, "workflow-creator": 7 };

/**
 * The eighteen techniques as they were originally attempted, one per row of the matrix. They are
 * deliberately the ORIGINAL forms; the evasions discovered later are a separate list below.
 */
const TECHNIQUES = [
  'echo "payload" > src/a.js',
  'printf "payload" >> src/a.js',
  "cp /etc/hostname src/a.js",
  "mv /tmp/payload src/a.js",
  "rm src/a.js",
  "touch src/a.js",
  "sed -i 's/a/b/' src/a.js",
  "perl -pi -e 's/a/b/' src/a.js",
  "dd if=/dev/zero of=src/a.js",
  "install /etc/hostname src/a.js",
  "truncate -s 0 src/a.js",
  "echo payload | tee src/a.js",
  "chmod +x src/a.js",
  "ln -sf /etc/hostname src/a.js",
  `python3 -c "open('src/a.js','w').write('x')"`,
  'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'x\')"',
  "git checkout -- src/a.js",
  "eval 'cp /etc/hostname src/a.js'",
];

/**
 * Evasions of the CLASSIFIER, each reproduced end to end before it was fixed. Every one of these was
 * a live ALLOW from the approving actor against a governed project with an APPROVED `dev` receipt.
 */
const EVASIONS = [
  // Wrappers whose flag value is a separate token: the old unwrapper stripped `-flag` tokens and
  // stopped at the first non-flag word, handing the classifier the VALUE as the command name.
  ["timeout 5 rm src/a.js", "timeout's mandatory duration operand"],
  ["timeout 5s cp /etc/hosts src/a.js", "duration with a unit suffix"],
  ["nice -n 10 cp /etc/hosts src/a.js", "nice -n takes a separate value"],
  ["ionice -c 2 cp /etc/hosts src/a.js", "ionice -c takes a separate value"],
  ["stdbuf -o L cp /etc/hosts src/a.js", "stdbuf -o takes a separate value"],
  ["timeout -k 1 5 rm src/a.js", "value flag and operand together"],
  // Same defect, but it also defeated interpreter detection: `sh` never became the head word.
  ['timeout 5 sh -c "echo payload > src/a.js"', "wrapped interpreter one-liner"],
  ["nice -n 10 bash -c 'rm src/a.js'", "wrapped shell one-liner"],
  // `exec` replaces the shell with the command and was not treated as a wrapper at all.
  ["exec cp /etc/hosts src/a.js", "exec wrapper"],
  ["exec rm src/a.js", "exec wrapper"],
  // A quoted redirection target was blanked to nothing, and an empty target is how `2>&1` presents.
  ['printf payload >"src/a.js"', "quoted redirection target"],
  ["printf payload > 'src/a.js'", "single-quoted redirection target"],
  ['cat /etc/hosts >"src/a.js"', "quoted redirection target"],
  // Shell spellings of a command name that are not a bare word.
  ["c'p' /etc/hosts src/a.js", "quote concatenation in the command name"],
  ['"cp" /etc/hosts src/a.js', "fully quoted command name"],
  ["r\\m src/a.js", "backslash escape in the command name"],
  // Length-changing masking desynchronized the command splitter from the raw string.
  ["echo a\\ b && rm src/a.js", "escaped character before a chain operator"],
  ["echo a\\ b && cp /etc/hosts src/a.js", "escaped character before a chain operator"],
  // The subshell never becomes a head word.
  ["cat <(touch src/a.js)", "process substitution"],
  ["diff <(rm src/a.js) /dev/null", "process substitution"],
  // Interpreters absent from the list are exactly as opaque as the ones on it.
  [`lua -e "io.open('src/a.js','w')"`, "lua one-liner"],
  ['qjs -e "x"', "quickjs one-liner"],
  ['tsx -e "x"', "tsx one-liner"],
  ["R -e 'writeLines(\"x\", \"src/a.js\")'", "R one-liner"],
  // git subcommands that land bytes in the worktree.
  ["git switch other-branch", "git switch replaces worktree files"],
  ["git submodule update --init", "git submodule materializes trees"],
  ["git worktree add ../wt", "git worktree writes a tree"],
  ["git clone https://example.com/x .", "git clone writes working files"],
];

/**
 * Read-only invocations that MUST stay allowed. The classifier is wired into `dev`/`work`, so every
 * false deny here is ordinary orchestration breaking — these seven were denied when the classifier
 * flagged the command NAME rather than the invocation.
 */
const READ_ONLY = [
  "curl -I https://example.com",
  "curl -sS https://example.com",
  "wget --spider https://example.com",
  "wget -O - https://example.com",
  "tar -tf archive.tar",
  "tar --list -f archive.tar",
  "unzip -l archive.zip",
  "gzip -cd file.gz",
  "gunzip -t file.gz",
  "mktemp -u",
  "rsync -n src/ dst/",
  "git status",
  "git diff --stat",
  "git log --oneline -5",
  "git commit -m 'record already-gated bytes'",
  "bun test tests/x.test.ts",
  "bun test 2>&1",
  "npm test > /dev/null",
  "rg foo -n",
  "ls -la",
  "cat src/a.js",
  "timeout 30 bun test",
  "nice -n 10 bun test",
  "awk '{print $1}' file",
  "sed 's/a/b/' file",
  "sha256sum .planning/plan.md",
];

const cwd = mkdtempSync(join(tmpdir(), "bash-mutation-matrix-"));
try {
  mkdirSync(join(cwd, "src"), { recursive: true });

  function guardVerdict(workflow, command) {
    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
      permission_mode: "default",
      cwd,
    };
    const result = spawnSync("bun", [GUARD, "--workflow", workflow], { cwd, env: process.env, input: JSON.stringify(payload), encoding: "utf8" });
    assert.equal(result.status, 0, `${workflow} / ${command}: exit ${result.status} ${result.stderr}`);
    return { denied: /"permissionDecision": "deny"/.test(result.stdout), stdout: result.stdout };
  }
  const runGuard = (workflow, command) => guardVerdict(workflow, command).denied;

  /**
   * WHICH MECHANISM DENIED THE CELL — because "108/108 denied" was not the claim it looked like.
   *
   * The three allowlist workflows plus `ds`'s stricter pre-existing checks account for most of the
   * matrix on their own. Those cells were ALREADY closed before `classifyBashMutation` existed and
   * would stay green if it were deleted tomorrow, so counting them as evidence for the classifier
   * inflated its apparent coverage roughly threefold. The deny reasons are distinguishable, so each
   * cell is attributed to the mechanism that actually produced it.
   */
  function mechanism(stdout) {
    if (/permits only named read-only checks|rejects chaining, redirection, and substitution|permits only explicit read-only Git|permits only the named read-only DS check|no analysis code in main chat/.test(stdout)) return "pre-existing allowlist";
    // The reason arrives JSON-encoded, so the em dash is `—` and must not be matched literally.
    if (/may not mutate project files through Bash/.test(stdout)) return "classifier";
    return "unattributed";
  }

  // -----------------------------------------------------------------------------------------------
  // THE MATRIX: 6 workflows x 18 techniques. Was 46 admitted; must now be 0.
  // -----------------------------------------------------------------------------------------------

  assert.equal(WORKFLOWS.length * TECHNIQUES.length, 108, "the matrix is 108 cells");
  const admitted = [];
  const byMechanism = { "pre-existing allowlist": 0, classifier: 0, unattributed: 0 };
  const classifierOnly = new Set();
  for (const workflow of WORKFLOWS) {
    for (const command of TECHNIQUES) {
      const { denied, stdout } = guardVerdict(workflow, command);
      if (!denied) { admitted.push(`${workflow}: ${command}`); continue; }
      const source = mechanism(stdout);
      byMechanism[source] += 1;
      if (source === "classifier") classifierOnly.add(`${workflow}: ${command}`);
    }
  }
  assert.deepEqual(admitted, [], `admitted ${admitted.length}/108 mutation techniques:\n${admitted.join("\n")}`);
  assert.equal(byMechanism.unattributed, 0, "every denial must be attributable to a named mechanism");
  // The classifier is load-bearing for `dev` and `work` and for nothing else: those two columns have
  // no allowlist of their own. If this number ever climbs, the matrix has started crediting the
  // classifier for cells some other mechanism closed.
  assert.equal(classifierOnly.size, byMechanism.classifier, "attribution must not double-count");
  // Pinned as EXACT counts, not floors. The honest reading of this matrix is that 59 of its 108
  // cells would stay green with `classifyBashMutation` deleted — they close on the `writing`,
  // `workshop` and `workflow-creator` named-command allowlists and on `ds`'s stricter pre-existing
  // checks. Only 49 are the classifier's own work. A floor would let that ratio drift unnoticed,
  // which is how "108/108" came to read as evidence for a mechanism responsible for under half.
  assert.equal(byMechanism.classifier, 53, `classifier-attributed cells: ${byMechanism.classifier}`);
  assert.equal(byMechanism["pre-existing allowlist"], 55, `allowlist-attributed cells: ${byMechanism["pre-existing allowlist"]}`);
  console.log(`  matrix attribution: ${byMechanism.classifier} classifier, ${byMechanism["pre-existing allowlist"]} pre-existing allowlist`);

  // -----------------------------------------------------------------------------------------------
  // WHAT THE `dev` AND `work` COLUMNS ARE AND ARE NOT EVIDENCE OF.
  //
  // The 49 classifier-attributed cells are all in the `dev` and `work` columns, and BOTH of those
  // columns exercise a code path Claude Code never invokes in production. Verified by grep against
  // this repository:
  //   - no `skills/dev*/SKILL.md` wires `orchestrator-mutation-guard` with a Bash-inclusive
  //     matcher; every dev wiring is `matcher: "Write|Edit|MultiEdit|NotebookEdit"`, and a matcher
  //     of only letters/digits/`_`/`-`/spaces/`,`/`|` is an EXACT string list, so `Bash` never
  //     reaches the guard under `--workflow dev`
  //   - `--workflow work` appears in NO skill file at all, so nothing ever passes it
  // So these cells prove that `classifyBashMutation` WOULD close those techniques if the guard were
  // ever wired that way. They do not prove that anything is closed in production. What actually
  // closes Bash for a restricted actor is the plugin-wide `implementer-identity-gate` exercised in
  // the inversion section below — which is why that section, not this matrix, carries the evasions.
  // Do not wire `dev`/`work` to make this comment go away; the identity gate is the real backstop
  // and duplicating it into a skill-scoped hook would add a second thing to keep in sync.
  // -----------------------------------------------------------------------------------------------

  // -----------------------------------------------------------------------------------------------
  // ALLOW-SIDE COVERAGE FOR EVERY COLUMN, NOT JUST `dev`/`work`.
  //
  // The deny side was measured for all six workflows and the allow side for two, which is how a
  // workflow that denies EVERYTHING would have looked identical to a correct one. Pinned as exact
  // per-workflow counts over the same READ_ONLY corpus: the three named-command allowlist workflows
  // admit only the handful of commands their own lists name, and that number moving is a change in
  // what an orchestrator can do.
  // -----------------------------------------------------------------------------------------------

  const ALLOW_SIDE = { ds: 0, dev: 0, work: 0, writing: 0, workshop: 0, "workflow-creator": 0 };
  for (const workflow of WORKFLOWS) {
    for (const command of READ_ONLY) if (!runGuard(workflow, command)) ALLOW_SIDE[workflow] += 1;
  }
  console.log(`  allow-side: ${JSON.stringify(ALLOW_SIDE)}`);
  assert.deepEqual(ALLOW_SIDE, ALLOW_SIDE_EXPECTED, "per-workflow allow-side coverage changed");

  // -----------------------------------------------------------------------------------------------
  // EVASIONS. Checked at the classifier for a precise failure message, then end to end through the
  // two workflows that rely on the classifier rather than on a named-command allowlist.
  // -----------------------------------------------------------------------------------------------

  for (const [command, why] of EVASIONS) {
    assert.ok(classifyBashMutation(command).mutating, `classifier missed ${why}: ${command}`);
    for (const workflow of ["dev", "work"]) {
      assert.ok(runGuard(workflow, command), `${workflow} admitted ${why}: ${command}`);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // FALSE DENIES. Read-only work must survive; a gate nobody can work under gets turned off.
  // -----------------------------------------------------------------------------------------------

  for (const command of READ_ONLY) {
    const verdict = classifyBashMutation(command);
    assert.ok(!verdict.mutating, `read-only command denied: ${command} (${verdict.reason})`);
    for (const workflow of ["dev", "work"]) {
      assert.ok(!runGuard(workflow, command), `${workflow} denied read-only command: ${command}`);
    }
  }

  // The mutating forms of the very same commands must NOT have been reopened by the read-only forms.
  for (const command of [
    "curl -o out.txt https://example.com",
    "curl -sO https://example.com",
    "curl --output-dir dist -O https://example.com",
    "wget https://example.com",
    "wget -O out.html https://example.com",
    "tar -xzf archive.tar.gz",
    "tar czf out.tar dir",
    "unzip archive.zip",
    "unzip -o archive.zip",
    "gzip file",
    "gunzip file.gz",
    "mktemp",
    "rsync -a src/ dst/",
  ]) {
    assert.ok(classifyBashMutation(command).mutating, `read-only form reopened a mutation: ${command}`);
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log("bash-mutation-matrix tests passed");
