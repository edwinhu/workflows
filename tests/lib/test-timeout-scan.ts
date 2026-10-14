// Reads a test file and answers, per test, how long its literal child-process timeouts can add up
// to against the timeout bun will give the test: its own third argument (or `{ timeout }`), else
// the file's `setDefaultTimeout`, else bun's 5 s. Spawns made through a file-local helper count at
// every call site in the test body. Strings and comments are masked, as in sync-spawn-scan.
// A timeout resolves from a literal, a file-level numeric constant, one imported from a relative
// file (one hop), a helper parameter's literal default or the literal a call site passes, or a
// file-level options object `{ timeout: N }` spread or passed whole. An async spawn with no
// timeout option is bounded by the test itself and costs nothing. The rest is `unresolved`, with
// the reason in `causes`.
// A spawn inside a `for` / `for-of` loop whose trip count is literal (`i < N`, an array literal, a
// file-level const array literal) is multiplied by it, helper calls included; any other loop
// (`while`, a variable bound) counts once and adds `loop-unknown-count` to the causes.
// `test.each(rows)(name, fn, timeout?)` is one test whose body is summed once, the cost of one row
// invocation; `describe.each` needs nothing special, its inner tests are found like any other.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
  /** Spawn timeouts the scanner could not read. */
  unresolved: number;
  /** Why each unresolved spawn did not resolve, one entry per count in `unresolved`. */
  causes: string[];
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
const NUM = String.raw`\d[\d_]*(?:\s*\*\s*\d[\d_]*)?`;

interface Param { span: Span; index: number; def: number | null }
interface Direct { at: number; ms: number | null; cause: string | null; param?: Param }

interface Scope {
  consts: Map<string, number>;
  /** File-level `const NAME = { ... }` objects: their timeout, or null when they carry none. */
  objs: Map<string, { ms: number | null } | null>;
}

function fileConsts(src: string, mask: boolean[]): Map<string, number> {
  const consts = new Map<string, number>();
  const re = new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::\s*number)?\s*=\s*(${NUM})[ \t]*(?=;|\n|$)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("const")]) continue;
    const v = numeric(m[2], consts);
    if (v !== null) consts.set(m[1], v);
  }
  return consts;
}

function fileObjs(src: string, mask: boolean[], consts: Map<string, number>): Scope["objs"] {
  const objs: Scope["objs"] = new Map();
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("const")]) continue;
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, mask, open);
    if (close === -1) continue;
    let code = "";
    for (let k = open; k <= close; k++) code += mask[k] ? src[k] : " ";
    const t = code.match(/\btimeout\s*:\s*([^,}\n]+)/);
    objs.set(m[1], t ? { ms: numeric(t[1], consts) } : null);
  }
  return objs;
}

const modules = new Map<string, Scope | null>();

/** The constants and options objects a relative module declares, read once per path. */
function moduleScope(path: string): Scope | null {
  if (modules.has(path)) return modules.get(path)!;
  const found = [path, `${path}.ts`, `${path}.js`, join(path, "index.ts")].find((p) => existsSync(p) && statSync(p).isFile());
  let scope: Scope | null = null;
  if (found) {
    try {
      const isrc = readFileSync(found, "utf8");
      const mask = codeMask(isrc);
      const consts = fileConsts(isrc, mask);
      scope = { consts, objs: fileObjs(isrc, mask, consts) };
    } catch { /* unreadable: its names stay unresolved */ }
  }
  modules.set(path, scope);
  return scope;
}

/** Fold what relative `import { A, B as C }` lines bring in (one hop) into the scope. */
function addImports(src: string, mask: boolean[], dir: string, scope: Scope): void {
  const re = /(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("import")]) continue;
    const mod = moduleScope(resolve(dir, m[2]));
    if (!mod) continue;
    for (const item of m[1].split(",")) {
      const [name, alias = name] = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (mod.consts.has(name)) scope.consts.set(alias, mod.consts.get(name)!);
      if (mod.objs.has(name)) scope.objs.set(alias, mod.objs.get(name)!);
    }
  }
}

interface Loop { start: number; body: Span; count: number | null }

/** Elements of a file-level `const NAME = [ ... ]` array literal; null when it holds a spread. */
function fileArrays(src: string, mask: boolean[]): Map<string, number | null> {
  const arrays = new Map<string, number | null>();
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("const")]) continue;
    arrays.set(m[1], arrayCount(src, mask, m.index + m[0].length - 1));
  }
  return arrays;
}

function arrayCount(src: string, mask: boolean[], open: number): number | null {
  const sp = splitArgs(src, mask, open);
  if (!sp) return null;
  let code = "";
  for (let k = open; k <= sp.close; k++) code += mask[k] ? src[k] : " ";
  return /\.\.\./.test(code) ? null : sp.args.length;
}

/** Trip count of a loop header, or null when it is not a literal one. */
function tripCount(src: string, mask: boolean[], kind: string, open: number, close: number,
                   consts: Map<string, number>, arrays: Map<string, number | null>): number | null {
  if (kind !== "for") return null;
  let code = "";
  for (let k = open + 1; k < close; k++) code += mask[k] ? src[k] : " ";
  const of = code.match(/^\s*(?:const|let|var)\s+(?:\w+|\[[^\]]*\]|\{[^}]*\})\s+of\s+/);
  if (of) {
    const exprStart = open + 1 + of[0].length;
    const expr = code.slice(of[0].length).trim();
    if (expr.startsWith("[")) {
      const sp = splitArgs(src, mask, exprStart);
      return sp && sp.close === close - 1 - (code.length - code.trimEnd().length) ? arrayCount(src, mask, exprStart) : null;
    }
    return /^[A-Za-z_]\w*$/.test(expr) ? arrays.get(expr) ?? null : null;
  }
  const parts = code.split(";");
  if (parts.length !== 3) return null;
  const init = parts[0].match(/^\s*(?:let|var|const)\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/s);
  if (!init) return null;
  const v = init[1];
  const from = numeric(init[2], consts);
  const cond = parts[1].match(new RegExp(String.raw`^\s*${v}\s*(<=|<|>=|>)\s*(.+?)\s*$`, "s"));
  const bound = cond ? numeric(cond[2], consts) : null;
  if (from === null || !cond || bound === null) return null;
  const up = new RegExp(String.raw`^\s*(?:${v}\s*\+\+|\+\+\s*${v}|${v}\s*\+=\s*(\d+))\s*$`).exec(parts[2]);
  const down = new RegExp(String.raw`^\s*(?:${v}\s*--|--\s*${v}|${v}\s*-=\s*(\d+))\s*$`).exec(parts[2]);
  if (up && (cond[1] === "<" || cond[1] === "<=")) {
    const step = Number(up[1] ?? 1);
    return step > 0 ? Math.max(0, Math.ceil((bound - from + (cond[1] === "<=" ? 1 : 0)) / step)) : null;
  }
  if (down && (cond[1] === ">" || cond[1] === ">=")) {
    const step = Number(down[1] ?? 1);
    return step > 0 ? Math.max(0, Math.ceil((from - bound + (cond[1] === ">=" ? 1 : 0)) / step)) : null;
  }
  return null;
}

function findLoops(src: string, mask: boolean[], consts: Map<string, number>): Loop[] {
  const arrays = fileArrays(src, mask);
  const out: Loop[] = [];
  const re = /(?<![\w$.])(for|while)\s*(?:await\s*)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, mask, open);
    if (close === -1) continue;
    let b = close + 1;
    while (b < src.length && /\s/.test(src[b])) b++;
    let end = -1;
    if (src[b] === "{") end = matchClose(src, mask, b); // else a one-statement body, ended by `;` or the line
    else {
      let depth = 0;
      for (let k = b; k < src.length; k++) {
        if (!mask[k]) continue;
        const c = src[k];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { depth--; if (depth === 0 && c === "}") { end = k; break; } if (depth < 0) { end = k; break; } }
        else if ((c === ";" || c === "\n") && depth === 0) { end = k; break; }
      }
    }
    if (end === -1) continue;
    out.push({ start: m.index, body: [b, end], count: tripCount(src, mask, m[1], open, close, consts, arrays) });
  }
  return out;
}

interface Helper { name: string; span: Span; params: string }

function findHelpers(src: string, mask: boolean[]): Helper[] {
  const out: Helper[] = [];
  const fn = /(?<![\w$.])(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = fn.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const open = m.index + m[0].length - 1;
    const pc = matchClose(src, mask, open);
    if (pc === -1) continue;
    const b = src.indexOf("{", pc);
    if (b === -1) continue;
    const e = matchClose(src, mask, b);
    if (e !== -1) out.push({ name: m[1], span: [b, e], params: src.slice(open + 1, pc) });
  }
  const arrow = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(\([^)]*\)|[A-Za-z_]\w*)\s*(?::\s*[^=\n]+?)?=>\s*/g;
  while ((m = arrow.exec(src)) !== null) {
    if (!mask[m.index + m[0].indexOf("const")]) continue;
    const bodyStart = m.index + m[0].length;
    const params = m[2].replace(/^\(|\)$/g, "");
    if (src[bodyStart] === "{") {
      const e = matchClose(src, mask, bodyStart);
      if (e !== -1) out.push({ name: m[1], span: [bodyStart, e], params });
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
      out.push({ name: m[1], span: [bodyStart, k], params });
    }
  }
  return out;
}

/** Position and literal default of parameter `name` among a helper's top-level parameters. */
function paramOf(h: Helper, name: string, scope: Scope): Param | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k <= h.params.length; k++) {
    const c = h.params[k];
    if (k === h.params.length || (c === "," && depth === 0)) {
      parts.push(h.params.slice(start, k));
      start = k + 1;
    } else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c) && !(c === ">" && h.params[k - 1] === "=")) depth--;
  }
  const index = parts.findIndex((p) => new RegExp(String.raw`^\s*${name}\s*\??\s*(?::|=|$)`).test(p));
  if (index === -1) return null;
  const d = parts[index].match(/=\s*([^=].*)$/s);
  return { span: h.span, index, def: d ? numeric(d[1], scope.consts) : null };
}

/** Every spawn call's timeout in the file; `cause` names why `ms` is null when it could not be read. */
function directSpawns(src: string, mask: boolean[], scope: Scope, helpers: Helper[]): Direct[] {
  const out: Direct[] = [];
  SPAWN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAWN_RE.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    const at = m.index;
    const open = at + m[0].length - 1;
    const sp = splitArgs(src, mask, open);
    if (!sp) continue;
    let code = "";
    for (let k = open; k <= sp.close; k++) code += mask[k] ? src[k] : " ";
    const isSync = /Sync|exec/.test(m[0]);
    const inner = helpers
      .filter((h) => at >= h.span[0] && at <= h.span[1])
      .sort((a, b) => (a.span[1] - a.span[0]) - (b.span[1] - b.span[0]))[0];
    const byName = (name: string): Direct => {
      const v = scope.consts.get(name);
      if (v !== undefined) return { at, ms: v, cause: null };
      const p = inner ? paramOf(inner, name, scope) : null;
      return p ? { at, ms: p.def, cause: null, param: p } : { at, ms: null, cause: "unresolved-identifier" };
    };
    const fromObj = (name: string): Direct | null => {
      const o = scope.objs.get(name);
      if (!o) return null;
      return o.ms === null ? { at, ms: null, cause: "computed" } : { at, ms: o.ms, cause: null };
    };

    const inline = code.match(/\btimeout\s*:\s*([^,}\n]+)/);
    if (inline) {
      const x = inline[1].trim();
      const v = numeric(x, scope.consts);
      if (v !== null) out.push({ at, ms: v, cause: null });
      else out.push(/^[A-Za-z_]\w*$/.test(x) ? byName(x) : { at, ms: null, cause: "computed" });
      continue;
    }
    if (/[{,]\s*timeout\s*(?=[,}])/.test(code)) { out.push(byName("timeout")); continue; }
    let hit: Direct | null = null;
    for (const sm of code.matchAll(/\.\.\.\s*([A-Za-z_]\w*)\b(?!\s*[.(\[])/g)) {
      hit = fromObj(sm[1]);
      if (hit) break;
    }
    const lastArg = sp.args.length >= 2 ? sp.args[sp.args.length - 1] : null;
    const last = lastArg ? src.slice(lastArg[0], lastArg[1]).trim() : "";
    if (!hit && /^[A-Za-z_]\w*$/.test(last)) {
      hit = fromObj(last);
      if (!hit && !scope.objs.has(last)) {
        out.push(isSync ? { at, ms: null, cause: "options-variable" } : { at, ms: 0, cause: null });
        continue;
      }
    }
    if (hit) out.push(hit);
    else out.push(isSync ? { at, ms: null, cause: "sync-no-timeout" } : { at, ms: 0, cause: null });
  }
  return out;
}

export function unresolvedCauses(t: TestCost): string[] {
  return t.causes;
}

export function scanTestCosts(src: string, opts: { dir?: string } = {}): TestCost[] {
  const mask = codeMask(src);
  const consts = fileConsts(src, mask);
  const scope: Scope = { consts, objs: fileObjs(src, mask, consts) };
  if (opts.dir) addImports(src, mask, opts.dir, scope);
  const helpers = findHelpers(src, mask);
  const directs = directSpawns(src, mask, scope, helpers);
  const loops = findLoops(src, mask, consts);

  const inSpan = (at: number, s: Span) => at >= s[0] && at <= s[1];
  /** The trip-count product of the loops around `at` that lie inside `span`; `unknown` when one has no literal count. */
  const around = (at: number, span: Span): { mult: number; unknown: boolean } => {
    let mult = 1;
    let unknown = false;
    for (const l of loops) {
      if (l.start < span[0] || l.body[1] > span[1] || !inSpan(at, l.body)) continue;
      if (l.count === null) unknown = true; else mult *= l.count;
    }
    return { mult, unknown };
  };
  /** `args`: what the call site passed for each parameter: a literal, null when unreadable, absent when omitted. */
  const costIn = (span: Span, depth = 0, args: (number | null)[] = []): { ms: number; causes: string[] } => {
    let ms = 0;
    const causes: string[] = [];
    for (const d of directs) {
      if (!inSpan(d.at, span)) continue;
      if (helpers.some((h) => inSpan(d.at, h.span) && !inSpan(h.span[0], span))) continue;
      let v = d.ms;
      let cause = d.cause;
      if (d.param && d.param.span[0] === span[0]) {
        const passed = args[d.param.index];
        if (passed !== undefined) v = passed;
      }
      const loop = around(d.at, span);
      if (v === null) causes.push(cause ?? "unresolved-identifier");
      else {
        ms += v * loop.mult;
        if (loop.unknown && v > 0) causes.push("loop-unknown-count");
      }
    }
    if (depth < 4) {
      for (const h of helpers) {
        if (inSpan(h.span[0], span)) continue;
        const re = new RegExp(`(?<![\\w$.])${h.name}\\s*\\(`, "g");
        const text = src.slice(span[0], span[1] + 1);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (!mask[span[0] + m.index]) continue;
          const call = splitArgs(src, mask, span[0] + m.index + m[0].length - 1);
          const passed = (call?.args ?? []).map((a) => numeric(src.slice(a[0], a[1]), consts));
          const c = costIn(h.span, depth + 1, passed);
          const loop = around(span[0] + m.index, span);
          ms += c.ms * loop.mult;
          causes.push(...c.causes);
          if (loop.unknown && c.ms > 0) causes.push("loop-unknown-count");
        }
      }
    }
    return { ms, causes };
  };

  const dm = [...src.matchAll(/setDefaultTimeout\s*\(\s*([^)]+?)\s*\)/g)].find((m) => mask[m.index!]);
  const fileDefault = dm ? numeric(dm[1], consts) : null;

  const out: { at: number; cost: TestCost }[] = [];
  const emit = (at: number, name: Span, body: Span, timeoutArg: Span | undefined, close: number): void => {
    let perTest: number | null = null;
    if (timeoutArg) {
      const t = src.slice(timeoutArg[0], timeoutArg[1]);
      const opt = t.match(/timeout\s*:\s*([^,}\n]+)/);
      perTest = numeric(opt ? opt[1] : t, consts);
    }
    const c = costIn([body[0], body[1]]);
    out.push({
      at,
      cost: {
        name: src.slice(name[0], name[1]).trim().replace(/^['"`]|['"`]$/g, "").slice(0, 90),
        line: src.slice(0, at).split("\n").length,
        effectiveMs: perTest ?? fileDefault ?? BUN_DEFAULT_MS,
        source: perTest !== null ? "test" : fileDefault !== null ? "file" : "bun",
        spawnMs: c.ms,
        unresolved: c.causes.length,
        causes: c.causes,
        close,
        timeoutArg: timeoutArg ? [timeoutArg[0], timeoutArg[1]] : null,
      },
    });
  };

  let m: RegExpExecArray | null;
  const re = /(?<![\w$.])(?:test|it)(?:\.(?:only|skip|serial|concurrent))?\s*\(/g;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const sp = splitArgs(src, mask, m.index + m[0].length - 1);
    if (!sp || sp.args.length < 2) continue;
    emit(m.index, sp.args[0], sp.args[1], sp.args[2], sp.close);
  }
  // test.each(rows)(name, fn, timeout?): the second call is the test; one row invocation is one body.
  const each = /(?<![\w$.])(?:test|it)(?:\.(?:only|skip|serial|concurrent))?\.each\s*\(/g;
  while ((m = each.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const rows = splitArgs(src, mask, m.index + m[0].length - 1);
    if (!rows) continue;
    let o = rows.close + 1;
    while (o < src.length && /\s/.test(src[o])) o++;
    if (src[o] !== "(") continue;
    const sp = splitArgs(src, mask, o);
    if (!sp || sp.args.length < 2) continue;
    emit(m.index, sp.args[0], sp.args[1], sp.args[2], sp.close);
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.cost);
}

/** Line of a `setDefaultTimeout(` call that follows the first top-level `test(` / `describe(` call, else null. */
export function lateDefaultTimeout(src: string): number | null {
  const mask = codeMask(src);
  const at = (re: RegExp): number | null => {
    for (const m of src.matchAll(re)) if (mask[m.index!]) return m.index!;
    return null;
  };
  const dt = at(/\bsetDefaultTimeout\s*\(/g);
  const first = at(/^[ \t]*(?:test|describe|it)(?:\.\w+)*\s*\(/gm);
  if (dt === null || first === null || dt < first) return null;
  return src.slice(0, dt).split("\n").length;
}
