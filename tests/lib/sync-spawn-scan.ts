// Finds every synchronous child-process call in a JS/TS source and splits its arguments, skipping
// strings, template literals, comments and regex literals. Shared by the spawn-timeout lint and the
// codemod that first applied it, so the two cannot disagree about what counts as a call.

export interface SyncCall {
  /** `spawnSync`, `execSync`, `execFileSync`, or `Bun.spawnSync`. */
  fn: string;
  /** Offset of the opening paren. */
  open: number;
  /** Offset of the matching closing paren. */
  close: number;
  /** Top-level arguments as [start, end) offsets into the source. */
  args: [number, number][];
  line: number;
  /** The call's source with strings, comments and regexes blanked: what a key search may read. */
  code: string;
}

/** A mask: true where the character is code, false inside a string, template text, comment or regex. */
function codeMask(src: string): boolean[] {
  const mask = new Array<boolean>(src.length).fill(true);
  // Each frame is a template literal awaiting its closing backtick, or a `${` awaiting its `}`.
  const stack: ("tpl" | number)[] = [];
  let braceDepth = 0;
  let lastCode = "";
  let i = 0;
  const skipTo = (end: number) => {
    for (let k = i; k < end && k < src.length; k++) mask[k] = false;
    i = end;
  };
  const scanTemplate = () => {
    // i points just after a backtick or a `}` closing an interpolation.
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") { mask[i] = mask[i + 1] = false; i += 2; continue; }
      if (c === "`") { mask[i] = false; i++; stack.pop(); return; }
      if (c === "$" && src[i + 1] === "{") {
        mask[i] = mask[i + 1] = false;
        i += 2;
        stack.push(braceDepth);
        return;
      }
      mask[i] = false;
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") { const e = src.indexOf("\n", i); skipTo(e === -1 ? src.length : e); continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); skipTo(e === -1 ? src.length : e + 2); continue; }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      skipTo(k + 1);
      lastCode = c;
      continue;
    }
    if (c === "`") { mask[i] = false; i++; stack.push("tpl"); scanTemplate(); lastCode = "`"; continue; }
    if (c === "/" && (lastCode === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastCode))) {
      let k = i + 1;
      let cls = false;
      while (k < src.length && src[k] !== "\n") {
        if (src[k] === "\\") { k += 2; continue; }
        if (src[k] === "[") cls = true;
        else if (src[k] === "]") cls = false;
        else if (src[k] === "/" && !cls) break;
        k++;
      }
      skipTo(k + 1);
      lastCode = "/";
      continue;
    }
    if (c === "{") braceDepth++;
    if (c === "}") {
      const top = stack[stack.length - 1];
      if (typeof top === "number" && top === braceDepth) {
        stack.pop();
        mask[i] = false;
        i++;
        scanTemplate();
        lastCode = "`";
        continue;
      }
      braceDepth--;
    }
    if (!/\s/.test(c)) lastCode = c;
    i++;
  }
  return mask;
}

export function findSyncCalls(src: string): SyncCall[] {
  const mask = codeMask(src);
  const out: SyncCall[] = [];
  const re = /(?<![\w$])(Bun\.spawnSync|spawnSync|execSync|execFileSync)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!mask[m.index]) continue;
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s+$/.test(before)) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let start = open + 1;
    const args: [number, number][] = [];
    let close = -1;
    for (let k = open; k < src.length; k++) {
      if (!mask[k]) continue;
      const c = src[k];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) { close = k; break; }
      } else if (c === "," && depth === 1) {
        args.push([start, k]);
        start = k + 1;
      }
    }
    if (close === -1) continue;
    if (src.slice(start, close).trim()) args.push([start, close]);
    let code = "";
    for (let k = open; k <= close; k++) code += mask[k] ? src[k] : " ";
    out.push({ fn: m[1], open, close, args, line: src.slice(0, m.index).split("\n").length, code });
  }
  return out;
}

/** Index of the argument holding the options object, given the call's shape. */
export function optionsArgIndex(call: SyncCall, src: string): number | "ambiguous" | null {
  const text = (a: [number, number]) => src.slice(a[0], a[1]).trim();
  const n = call.args.length;
  if (call.fn === "Bun.spawnSync") {
    if (n === 0) return null;
    return text(call.args[0]).startsWith("{") ? 0 : n >= 2 ? 1 : null;
  }
  if (call.fn === "execSync") return n >= 2 ? 1 : null;
  // spawnSync / execFileSync: (file, args?, options?) — options may sit second when args is omitted.
  if (n >= 3) return 2;
  if (n === 2) {
    const t = text(call.args[1]);
    if (t.startsWith("[") || /^\.\.\./.test(t)) return null;
    if (t.startsWith("{")) return 1;
    return "ambiguous";
  }
  return null;
}

/** Does this call bound its wait? A `timeout` key in its argument CODE counts; a string does not. */
export function hasTimeout(call: SyncCall): boolean {
  return /\btimeout\b/.test(call.code);
}
