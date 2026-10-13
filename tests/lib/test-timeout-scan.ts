// Reads a test file and answers, per test, how long its literal child-process timeouts can add up
// to against the timeout bun will give the test: its own third argument (or `{ timeout }`), else
// the file's `setDefaultTimeout`, else bun's 5 s. Spawns made through a file-local helper count at
// every call site in the test body. Strings and comments are masked, as in sync-spawn-scan.

import { codeMask } from "./sync-spawn-scan.ts";

export const BUN_DEFAULT_MS = 5_000;

export interface TestCost {
  name: string;
  line: number;
  /** Timeout bun enforces on the test. */
  effectiveMs: number;
  /** Where it came from: a per-test argument, the file default, or bun's own. */
  source: "test" | "file" | "bun";
  /** Sum of the literal spawn timeouts the body reaches, helper calls included. */
  spawnMs: number;
  /** Spawn timeouts that are not a literal or a file-level numeric constant. */
  unresolved: number;
  /** Offsets for a rewrite: the call's closing paren, and the third argument when there is one. */
  close: number;
  timeoutArg: [number, number] | null;
}

type Span = [number, number];

function splitArgs(src: string, mask: boolean[], open: number): { args: Span[]; close: number } | null {
  let depth = 0;
  let start = open + 1;
  const args: Span[] = [];
  for (let k = open; k < src.length; k++) {
    if (!mask[k]) continue;
    const c = src[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        if (src.slice(start, k).trim()) args.push([start, k]);
        return { args, close: k };
      }
    } else if (c === "," && depth === 1) {
      args.push([start, k]);
      start = k + 1;
    }
  }
  return null;
}

function matchClose(src: string, mask: boolean[], open: number): number {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (!mask[k]) continue;
    const c = src[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

function numeric(text: string, consts: Map<string, number>): number | null {
  const t = text.trim();
  if (/^\d[\d_]*$/.test(t)) return Number(t.replace(/_/g, ""));
  if (/^[A-Za-z_]\w*$/.test(t)) return consts.get(t) ?? null;
  const prod = t.match(/^(\d[\d_]*|[A-Za-z_]\w*)\s*\*\s*(\d[\d_]*|[A-Za-z_]\w*)$/);
  if (prod) {
    const a = numeric(prod[1], consts);
    const b = numeric(prod[2], consts);
    return a !== null && b !== null ? a * b : null;
  }
  return null;
}

const SPAWN_RE = /(?<![\w$.])(?:Bun\.spawnSync|Bun\.spawn|spawnSync|execSync|execFileSync|spawn)\s*\(/g;

interface Direct { at: number; ms: number | null }

/** Every spawn call's timeout in the file: `ms` is null when the option is absent or not resolvable. */
function directSpawns(src: string, mask: boolean[], consts: Map<string, number>): Direct[] {
  const out: Direct[] = [];
  SPAWN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAWN_RE.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, mask, open);
    if (close === -1) continue;
    let code = "";
    for (let k = open; k <= close; k++) code += mask[k] ? src[k] : " ";
    const t = code.match(/\btimeout\s*:\s*([^,}\n]+)/);
    out.push({ at: m.index, ms: t ? numeric(t[1], consts) : null });
  }
  return out;
}

function fileConsts(src: string, mask: boolean[]): Map<string, number> {
  const consts = new Map<string, number>();
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::\s*number)?\s*=\s*(\d[\d_]*(?:\s*\*\s*\d[\d_]*)?)\s*(?:;|\n)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("const")]) continue;
    const v = numeric(m[2], consts);
    if (v !== null) consts.set(m[1], v);
  }
  return consts;
}

interface Helper { name: string; span: Span }

function findHelpers(src: string, mask: boolean[]): Helper[] {
  const out: Helper[] = [];
  const fn = /(?<![\w$.])(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = fn.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const pc = matchClose(src, mask, m.index + m[0].length - 1);
    if (pc === -1) continue;
    const b = src.indexOf("{", pc);
    if (b === -1) continue;
    const e = matchClose(src, mask, b);
    if (e !== -1) out.push({ name: m[1], span: [b, e] });
  }
  const arrow = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(\([^)]*\)|[A-Za-z_]\w*)\s*(?::\s*[^=\n]+?)?=>\s*/g;
  while ((m = arrow.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("const")]) continue;
    const bodyStart = m.index + m[0].length;
    if (src[bodyStart] === "{") {
      const e = matchClose(src, mask, bodyStart);
      if (e !== -1) out.push({ name: m[1], span: [bodyStart, e] });
    } else {
      let depth = 0;
      let k = bodyStart;
      for (; k < src.length; k++) {
        if (!mask[k]) continue;
        const c = src[k];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
        else if (c === "\n" && depth === 0) break;
      }
      out.push({ name: m[1], span: [bodyStart, k] });
    }
  }
  return out;
}

export function scanTestCosts(src: string): TestCost[] {
  const mask = codeMask(src);
  const consts = fileConsts(src, mask);
  const directs = directSpawns(src, mask, consts);
  const helpers = findHelpers(src, mask);

  const inSpan = (at: number, s: Span) => at >= s[0] && at <= s[1];
  const costIn = (span: Span, depth = 0): { ms: number; unresolved: number } => {
    let ms = 0;
    let unresolved = 0;
    for (const d of directs) {
      if (!inSpan(d.at, span)) continue;
      if (helpers.some((h) => inSpan(d.at, h.span) && !inSpan(h.span[0], span))) continue;
      if (d.ms === null) unresolved++; else ms += d.ms;
    }
    if (depth < 4) {
      for (const h of helpers) {
        if (inSpan(h.span[0], span)) continue;
        const re = new RegExp(`(?<![\\w$.])${h.name}\\s*\\(`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(src.slice(span[0], span[1] + 1))) !== null) {
          if (!mask[span[0] + m.index]) continue;
          const c = costIn(h.span, depth + 1);
          ms += c.ms;
          unresolved += c.unresolved;
        }
      }
    }
    return { ms, unresolved };
  };

  const dm = [...src.matchAll(/setDefaultTimeout\s*\(\s*([^)]+?)\s*\)/g)].find((m) => mask[m.index!]);
  const fileDefault = dm ? numeric(dm[1], consts) : null;

  const out: TestCost[] = [];
  const re = /(?<![\w$.])(?:test|it)(?:\.(?:only|skip|serial|concurrent))?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const open = m.index + m[0].length - 1;
    const sp = splitArgs(src, mask, open);
    if (!sp || sp.args.length < 2) continue;
    const body = sp.args[1];
    const nameText = src.slice(sp.args[0][0], sp.args[0][1]).trim();
    let perTest: number | null = null;
    if (sp.args.length >= 3) {
      const t = src.slice(sp.args[2][0], sp.args[2][1]);
      const opt = t.match(/timeout\s*:\s*([^,}\n]+)/);
      perTest = numeric(opt ? opt[1] : t, consts);
    }
    const c = costIn([body[0], body[1]]);
    out.push({
      name: nameText.replace(/^['"`]|['"`]$/g, "").slice(0, 90),
      line: src.slice(0, m.index).split("\n").length,
      effectiveMs: perTest ?? fileDefault ?? BUN_DEFAULT_MS,
      source: perTest !== null ? "test" : fileDefault !== null ? "file" : "bun",
      spawnMs: c.ms,
      unresolved: c.unresolved,
      close: sp.close,
      timeoutArg: sp.args.length >= 3 ? [sp.args[2][0], sp.args[2][1]] : null,
    });
  }
  return out;
}
