#!/usr/bin/env bun
/**
 * Render SCORES.md as a text-based score trend for Mode 3 decision checkpoints.
 * TypeScript port of render-audit-scores.py.
 *
 * PORT NOTES — the traps here are all Python format-spec semantics, which have no JS equivalent and
 * must be reproduced by hand:
 *   - `{x:.1f}` rounds HALF TO EVEN (banker's rounding): 0.25 -> "0.2", not "0.3". JS toFixed rounds
 *     half away from zero. Only matters when a value lands exactly on a half-ulp, which scores do.
 *   - `{'':>{n}}` with a NEGATIVE computed n RAISES ValueError("Sign not allowed in string format
 *     specifier") — Python parses the leading "-" as a sign. It does NOT pad to zero. This is a
 *     LATENT BUG in the original, reachable with `threshold=10` (a legitimate max score), and it is
 *     reproduced here rather than fixed: silently making the port succeed where the original crashes
 *     is a behavior change disguised as a port. See padSpec().
 *   - `int()` truncates toward zero; Math.floor differs for negatives, which `pos` can be.
 *   - `{gap/19*100:.0f}` is also half-to-even at the integer boundary.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Row = { iteration: string; score: number; notes: string };

/** Python's format(x, ".Nf") — round half to even, unlike JS toFixed. */
function pyFixed(x: number, digits: number): string {
  const m = 10 ** digits;
  const scaled = x * m;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let n: number;
  if (Math.abs(diff - 0.5) < Number.EPSILON * Math.abs(scaled) * 8 || diff === 0.5) {
    n = floor % 2 === 0 ? floor : floor + 1; // exact .5 -> nearest even
  } else {
    n = Math.round(scaled);
  }
  return (n / m).toFixed(digits);
}

/** Python's `f"{x}"` for a FLOAT always shows a decimal: 9.0 -> "9.0", where JS gives "9". */
function pyFloat(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

/** Python's `'x' * n`: a negative count yields an empty string. This one really is lenient. */
function rep(s: string, n: number): string {
  return n > 0 ? s.repeat(n) : "";
}

/**
 * Python's `{'':>{n}}` width spec, which is NOT lenient: a negative n raises
 * ValueError("Sign not allowed in string format specifier").
 *
 * Faithfully reproduced. `render-audit-scores.py --threshold 10` crashes today, and a port that
 * quietly returned a rendered chart instead would be changing behavior while claiming fidelity.
 * Fixing the underlying bug is a separate decision from porting the file.
 */
function padSpec(n: number): string {
  if (n < 0) {
    console.error("ValueError: Sign not allowed in string format specifier");
    process.exit(1);
  }
  return " ".repeat(n);
}
function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export function parseScores(content: string): Row[] {
  const rows: Row[] = [];
  const re = /\|\s*(\d+(?:\s*\([^)]*\))?)\s*\|\s*[\d-]+\s*\|\s*([\d.]+)\s*\|\s*(.*?)\s*\|/g;
  for (const m of content.matchAll(re)) {
    rows.push({ iteration: m[1].trim(), score: parseFloat(m[2]), notes: m[3].trim() });
  }
  return rows;
}

export function renderTrend(rows: Row[], threshold = 9.5, width = 40): string[] {
  const out: string[] = [];
  if (!rows.length) return ["No scores found."];

  const minScore = Math.min(...rows.map((r) => r.score));
  const maxScore = Math.max(...rows.map((r) => r.score));
  const lo = Math.max(0, minScore - 1);
  const hi = Math.min(10, Math.max(maxScore + 0.5, threshold + 0.5));
  const span = hi > lo ? hi - lo : 1;

  out.push("");
  out.push("=".repeat(width + 20));
  out.push(`  Score Trend — Target: ${pyFloat(threshold)}`);
  out.push("=".repeat(width + 20));

  const thresholdCol = Math.trunc(((threshold - lo) / span) * width);

  out.push(`  ${"lo".padStart(4)}${padSpec(thresholdCol - 4)}|${padSpec(width - thresholdCol)}  hi`);
  out.push(
    `  ${pyFixed(lo, 1)}${padSpec(thresholdCol - 4)}${pyFixed(threshold, 1)}${padSpec(width - thresholdCol - 3)}${pyFixed(hi, 1)}`,
  );
  out.push(`  ${"─".repeat(width)}`);

  for (const { iteration, score } of rows) {
    let pos = Math.trunc(((score - lo) / span) * width);
    pos = Math.max(0, Math.min(width - 1, pos));
    const bar = "░".repeat(pos) + "█";
    const marker = score >= threshold ? "✓" : " ";
    const label = `  iter ${padRight(iteration, 12)}`;
    out.push(`${label}${padRight(bar, width + 1)} ${pyFixed(score, 1)} ${marker}`);
  }

  out.push(`  ${"─".repeat(width)}`);

  const current = rows[rows.length - 1].score;
  const gap = threshold - current;
  if (gap > 0) {
    out.push("");
    out.push(`  Gap to ${pyFloat(threshold)}: ${pyFixed(gap, 1)} points (${pyFixed((gap / 19) * 100, 0)}% of principles need +1)`);
    const ptsNeeded = Math.trunc((gap * 19) / 10 + 0.5);
    out.push(`  Approx ${ptsNeeded} principle-point improvements needed`);
  } else {
    out.push("");
    out.push(`  ✓ Threshold ${pyFloat(threshold)} met!`);
  }

  out.push("");
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let scoresPath: string;

  if (!argv.length) {
    const dir = ".planning/wc";
    if (existsSync(dir)) {
      const candidates: string[] = [];
      for (const d of readdirSync(dir)) {
        const p = join(dir, d, "SCORES.md");
        if (existsSync(p)) candidates.push(p);
      }
      if (!candidates.length) {
        console.log("No SCORES.md found in .planning/wc/*/");
        process.exit(1);
      }
      scoresPath = candidates.reduce((a, b) => (statSync(a).mtimeMs >= statSync(b).mtimeMs ? a : b));
    } else {
      console.log("Usage: render-audit-scores.ts <path/to/SCORES.md>");
      process.exit(1);
    }
  } else {
    scoresPath = argv[0];
  }

  if (!existsSync(scoresPath)) {
    console.log(`File not found: ${scoresPath}`);
    process.exit(1);
  }

  const threshold = argv.length > 1 ? parseFloat(argv[1]) : 9.5;
  for (const line of renderTrend(parseScores(readFileSync(scoresPath, "utf8")), threshold)) {
    console.log(line);
  }
}
