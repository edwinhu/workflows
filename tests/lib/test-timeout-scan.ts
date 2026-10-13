// Reads a test file and answers, per test, how long its literal child-process timeouts can add up
// to against the timeout bun will give the test: its own third argument (or `{ timeout }`), else
// the file's `setDefaultTimeout`, else bun's 5 s. Spawns made through a file-local helper count at
// every call site in the test body. Strings and comments are masked, as in sync-spawn-scan.
// A timeout resolves from a literal, a file-level numeric constant, one imported from a relative
// file (one hop), a helper parameter's literal default or the literal a call site passes, or a
// file-level options object `{ timeout: N }` spread or passed whole. An async spawn with no
// timeout option is bounded by the test itself and costs nothing. The rest is `unresolved`, with
// the reason in `causes`.

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

  const inSpan = (at: number, s: Span) => at >= s[0] && at <= s[1];
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
      if (v === null) causes.push(cause ?? "unresolved-identifier"); else ms += v;
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
          ms += c.ms;
          causes.push(...c.causes);
        }
      }
    }
    return { ms, causes };
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
      unresolved: c.causes.length,
      causes: c.causes,
      close: sp.close,
      timeoutArg: sp.args.length >= 3 ? [sp.args[2][0], sp.args[2][1]] : null,
    });
  }
  return out;
}
