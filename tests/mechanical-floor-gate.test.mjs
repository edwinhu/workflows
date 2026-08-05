// mechanical-floor-gate: which tool each FLOOR gates, and that it fails open on a broken harness.
//
// PORTED FROM tests/test_mechanical_floor_gate.py, WHICH HAD BEEN QUARANTINED for opening
// `hooks/mechanical-floor-gate.py` after the hook became `.ts`. The behavioural half ports directly
// — it always drove the hook as a subprocess, and a subprocess does not care what language it is.
// The source-invariant half was pinned to Python SYNTAX (`'floor == "ds"' in src`), which is why
// those assertions could never have survived the port unchanged; they are re-expressed against the
// TypeScript spellings below.
//
// Run: bun tests/mechanical-floor-gate.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const HOOK = join(ROOT, 'hooks', 'mechanical-floor-gate.ts')

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

async function run(payload, floor) {
  const proc = Bun.spawn(['bun', HOOK], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, FLOOR: floor },
  })
  proc.stdin.write(typeof payload === 'string' ? payload : JSON.stringify(payload))
  proc.stdin.end()
  const code = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  let out = null
  if (stdout.trim()) { try { out = JSON.parse(stdout) } catch { out = { _raw: stdout } } }
  return { code, out }
}

// ── FLOOR=dev: gates Agent only ──────────────────────────────────────────────
{
  const { code, out } = await run({ tool_name: 'Workflow', tool_input: { name: 'anything' } }, 'dev')
  ok('dev + Workflow is a no-op (gating Workflow is ds\'s job)', code === 0 && out === null, `code=${code} out=${JSON.stringify(out)}`)
}
{
  const { code, out } = await run({ tool_name: 'Write', tool_input: { file_path: 'x' } }, 'dev')
  ok('dev + Write is a no-op', code === 0 && out === null, `code=${code}`)
}

// ── FLOOR=ds: gates Workflow only — Agent MUST stay free ─────────────────────
// THE invariant: a failing floor is repaired by a fix SUBAGENT, so gating Agent here would wall off
// the only route out of a red floor. This is deadlock avoidance, not an oversight.
{
  const { code, out } = await run({ tool_name: 'Agent', tool_input: { subagent_type: 'ds-engineer' } }, 'ds')
  ok('ds + Agent is a no-op (the fix subagent must be able to run)', code === 0 && out === null, `code=${code} out=${JSON.stringify(out)}`)
}
{
  const { code, out } = await run({ tool_name: 'Write', tool_input: { file_path: 'x' } }, 'ds')
  ok('ds + Write is a no-op', code === 0 && out === null, `code=${code}`)
}

// MALFORMED STDIN DENIES. THIS IS A DELIBERATE REVERSAL, NOT A PORTING ACCIDENT.
//
// The Python suite asserted "malformed stdin fails open", and the TypeScript hook does the opposite:
// `denyOnCrash("MECHANICAL FLOOR GATE")` at hooks/mechanical-floor-gate.ts:30. That is correct for
// THIS hook and the old assertion was wrong for it. The distinction the repo draws is between
// observers and gates: work-implement-observation fails OPEN because a non-zero PreToolUse exit is a
// silent allow and a broken observer must not block real work, while a GATE that cannot decide must
// deny — a crash that read as "carry on" would silently permit precisely the call it exists to stop.
// So this assertion is inverted on purpose, with the hook's own reason text as the evidence.
{
  const { code, out } = await run('not json', 'ds')
  const decision = out?.hookSpecificOutput?.permissionDecision
  ok('malformed stdin DENIES — a gate that cannot decide does not permit', decision === 'deny', `code=${code} out=${JSON.stringify(out)}`)
  ok('the denial explains that the gate crashed rather than judged',
     /could not decide|crashed/i.test(out?.hookSpecificOutput?.permissionDecisionReason ?? ''),
     JSON.stringify(out))
  // Exit 0 matters as much as the payload: a non-zero exit is treated as non-blocking, so a gate
  // that "denied" by dying would have permitted the call it meant to refuse.
  ok('the denial is delivered by payload, not by a non-zero exit', code === 0, `code=${code}`)
}

// ── Source invariants, re-expressed for TypeScript ───────────────────────────
const src = readFileSync(HOOK, 'utf8')
ok('dev branch runs check-all.py with --with lxml', src.includes('"--with", "lxml"') && src.includes('CHECK_ALL_PY'))
ok('ds branch runs check-all-ds.sh', src.includes('CHECK_ALL_DS') && src.includes('check-all-ds.sh'))
ok('ds gates Workflow only, never Agent', src.includes('floor === "ds"') && src.includes('toolName !== "Workflow"'))
ok('dev gates Agent only', src.includes('toolName !== "Agent"'))
ok('the ds path names the fix-subagent escape (no deadlock)', /fix subagents? (must|stay)/i.test(src))
ok('only failures block; tooling errors do not', src.includes('failed.length === 0') && src.includes('NOT blocking'))
// SEVERITY IS THE CONSTRAINT'S TO DECLARE. check-all.py emits a per-entry `severity` and this gate
// must deny only on `hard`; blocking on every failure equally is what made advisory puffery as
// fatal as a provenance leak. Pinned so it cannot silently revert to "any failure blocks".
ok('dev denies on HARD failures only', src.includes('function isHard') && /severity/.test(src))
ok('soft failures are reported rather than dropped', /advisory, NOT blocking/.test(src))

// A LAUNCH FAILURE IS NOT A PASS. runDs used to return ok:true when check-all-ds.sh could not be
// spawned at all — the one condition under which the floor learns nothing was the one that let
// everything through. Pinned here so it cannot quietly revert to fail-open.
ok('a check-all-ds.sh that cannot be launched FAILS the floor',
   /could not run[\s\S]{0,80}ok: false|ok: false[\s\S]{0,120}could not run/.test(src),
   'runDs catch branch must not return ok:true')

console.log(`\n${PASS}/${PASS + FAIL} passed`)
if (FAIL) process.exit(1)
