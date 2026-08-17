#!/usr/bin/env bun
/**
 * validate-skill-write.ts — PostToolUse hook body for workflow-creator.
 *
 * Reads the PostToolUse hook JSON on stdin, takes `tool_input.file_path`, and
 * runs the probe predicates that can catch a silent defect at write time:
 *
 *   SKILL.md          P2 path-resolution, P3 frontmatter, P4 ${CLAUDE_PLUGIN_ROOT}-in-body
 *   agent .md         P2 path-resolution, P4 ${CLAUDE_PLUGIN_ROOT}-in-body
 *   hooks.json        P2 path-resolution
 *   any other source  P2 path-resolution   (SOURCE_EXT_RE — .md/.ts/.js and friends)
 *
 * That last row is the gate's own rule: P2 is ungated there, so it is ungated
 * here. While it was not, a `scripts/*.ts` naming a missing reference got
 * silence at write time and a CRITICAL from the gate long afterwards.
 *
 * P3's key vocabulary is the SKILL.md one, so it is not applied to agent files
 * (their frontmatter is a different schema) or to JSON.
 *
 * The predicates are IMPORTED from wc-probe.ts, never re-implemented: the
 * write-time detector and the gate-time probe must be the same code, or the
 * moment one gains a guard the other lacks they disagree about what is legal.
 *
 * NON-BLOCKING by construction: every path through this file exits 0. Any read
 * or parse failure is a silent exit 0 — a validator that crashes on an
 * unexpected input must not break the user's write.
 */

import { readFileSync } from 'node:fs'
import { dirname, sep } from 'node:path'

import {
  SOURCE_EXT_RE,
  checkAgentFrontmatter,
  checkExemptionVocabulary,
  classifySkillFile,
  checkFrontmatter,
  checkPathResolution,
  type UnresolvedRef,
  checkPluginRootInBody,
  parseExemptions,
  readTextOrNull,
  skillContextFor,
  findPluginRootOrNull,
  type Finding,
} from './wc-probe.ts'

function readStdin(): string {
  try {
    // readFileSync on fd 0 drains the pipe.
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function render(filePath: string, findings: Finding[]): string {
  const lines = [`workflow-creator validate-on-write: ${findings.length} finding(s) in ${filePath}`]
  for (const f of findings) {
    lines.push(`  [${f.severity}] ${f.rule}${f.line ? ` (line ${f.line})` : ''}: ${f.detail}`)
    lines.push(`    remedy: ${f.remedy}`)
  }
  lines.push('  (advisory — the write was not blocked)')
  return lines.join('\n')
}

function run(): void {
  const raw = readStdin()
  if (!raw.trim()) return

  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return // malformed hook JSON: silent no-op
  }

  const filePath: unknown = payload?.tool_input?.file_path
  if (typeof filePath !== 'string' || !filePath) return

  // The SAME classifier the gate uses. Two copies is how the gate came to run P4 on fewer files
  // than the advisory hook did.
  const kind = classifySkillFile(filePath)
  // P2 IS UNGATED HERE TOO. The gate runs `checkPathResolution` on every eligible source file
  // regardless of kind — that is what the ungating was for, so a generated `scripts/*.ts` naming a
  // missing ref is caught. Returning early on `kind === null` left the write-time surface blind to
  // exactly that file, so the author got silence at the moment of the mistake and a CRITICAL from
  // the gate arbitrarily later. The kind-specific rules below still key off `kind`.
  if (kind === null && !SOURCE_EXT_RE.test(filePath)) return

  const text = readTextOrNull(filePath)
  if (text === null) return

  const findings: Finding[] = []
  // `sep` is the walk limit only. The plugin-root fallback is left to skillContextFor, which uses
  // the resolved skill directory — passing `sep` for both once resolved every ${CLAUDE_PLUGIN_ROOT}
  // to "/" and made this hook disagree with the gate about the same file.
  const rawCtx = skillContextFor(filePath, sep)
  // Same narrowing the gate applies: an AGENT is not a plugin, so never invent a plugin root for
  // one. Without this the two surfaces disagreed about an agent body naming ${CLAUDE_PLUGIN_ROOT} —
  // the gate declined to resolve it, the hook resolved it against an invented root and emitted P2.
  const ctx = kind === 'agent' ? { ...rawCtx, pluginRoot: findPluginRootOrNull(dirname(filePath)) } : rawCtx
  // Parsed once here, exactly as the gate does it, and threaded in. The predicates no longer parse
  // their own: write-time and gate-time must not be able to disagree about what is suppressed.
  const exemptions = parseExemptions(filePath, text)
  findings.push(...checkExemptionVocabulary(exemptions))
  // The skips array, THREADED. The gate collects it and prints every NOT CHECKED note; this surface
  // passed nothing and discarded them, so an author writing a file whose references P2 declined to
  // resolve was told the write was clean. The two surfaces must not disagree about what did not run
  // any more than about what failed — that is the whole point of sharing the predicates.
  const skips: UnresolvedRef[] = []
  findings.push(...checkPathResolution(filePath, text, ctx, exemptions, skips))
  if (kind === 'skill') findings.push(...checkFrontmatter(filePath, text))
  // Mirrors runProbe's dispatch. Added to the gate alone, this rule made the two surfaces disagree
  // about an agent .md — the exact divergence the shared-predicate design exists to prevent.
  if (kind === 'agent') findings.push(...checkAgentFrontmatter(filePath, text))
  if (kind === 'skill' || kind === 'agent') findings.push(...checkPluginRootInBody(filePath, text))

  if (findings.length === 0 && skips.length === 0) return
  const msg = [render(filePath, findings)]
  // The probe's own note shape, deliberately: `  note: …`, NOT `  [severity] rule …`. parity-check
  // extracts rule names by that bracketed shape, so a note wearing it reads as a finding the gate
  // did not raise and reports PARITY BROKEN between two surfaces that agree.
  for (const k of skips) msg.push(`  note: rule "${k.rule}" NOT CHECKED for "${k.token}" (line ${k.line}) — ${k.reason}`)
  console.log(JSON.stringify({ systemMessage: msg.filter(Boolean).join('\n') }))
}

try {
  run()
} catch {
  // A validator must never be the reason a write fails.
}
process.exit(0)
