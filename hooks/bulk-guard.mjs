// bulk-guard: a Claude Code mod that stops per-document work at scale from billing Claude/Codex
// accounts. Per-document coding or extraction over many files is ONE gemini-batch job on pre-cut
// excerpts, never an agent fan-out or an agent-written model-API script.
//
// Rules (docs/bulk-guard.md): 1 distinct-document tripwire, 2 template fan-out and per-item agent
// loops, 3 model-API calls inside a loop, plus trimming of oversized Read/Bash/Grep results.
// No .catch handlers on purpose: a hook that throws is skipped (fail open). A heuristic guard must
// never cost the user Bash because of its own bug.

// ── thresholds: each overridable by the env var named beside it ──────────────────────────────
const DEFAULTS = {
  warnDocs: 5, //            BULK_GUARD_WARN_DOCS
  denyDocs: 10, //           BULK_GUARD_DENY_DOCS
  docMinBytes: 20480, //     BULK_GUARD_DOC_BYTES
  fanoutRows: 5, //          BULK_GUARD_FANOUT_ROWS
  fanoutSimilarity: 0.8, //  BULK_GUARD_SIMILARITY
  trimTokens: 20000, //      BULK_GUARD_TRIM_TOKENS
  headTokens: 6000, //       BULK_GUARD_HEAD_TOKENS
  tailTokens: 2000, //       BULK_GUARD_TAIL_TOKENS
};

export const DENY_MESSAGE =
  "Per-document reading at scale: route this to ONE gemini-batch job on pre-cut excerpts (Skill workflows:gemini-batch; cost gate applies). Reading more filings here bills Claude/Codex accounts per document. Override only if the user sets BULK_GUARD_OFF=1.";
export const WARN_NOTE =
  "bulk-guard: this session has now read {n} distinct documents one by one. If the task is per-document coding or extraction, stop and route it to ONE gemini-batch job on pre-cut excerpts (Skill workflows:gemini-batch). At {deny} documents further reads are denied.";
export const OFF_MESSAGE =
  "bulk-guard: BULK_GUARD_OFF is the user's override, set in their environment before the session starts; a command may not set it.";

const DOC_EXT = /\.(txt|htm|html|xml|sgml|pdf|nc)$/i;
const DOC_DIR = /(^|[\/_.-])(filings|archives|edgar|raw|prospect)/i;
const READ_VERB = /^(cat|head|tail|less|more|pdftotext|strings|bat|zcat)$/;
const SCRIPT_VERB = /^(python3?|awk|gawk|mawk|perl)$/;
const SCRIPT_EXT = /\.(py|ts|js|mjs|cjs|sh|bash)$/i;
const FANOUT_SCRIPT = /(^|\/)(farm|farm-team|work-dispatch)\.sh$/;

// ── config ───────────────────────────────────────────────────────────────────────────────────
// $.env.get needs a string literal per name, so each override is spelled out.
let configPromise;
async function loadConfig($) {
  const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  const [off, w, d, b, r, s, t, h, tl, xdg] = await Promise.all([
    $.env.get("BULK_GUARD_OFF"),
    $.env.get("BULK_GUARD_WARN_DOCS"),
    $.env.get("BULK_GUARD_DENY_DOCS"),
    $.env.get("BULK_GUARD_DOC_BYTES"),
    $.env.get("BULK_GUARD_FANOUT_ROWS"),
    $.env.get("BULK_GUARD_SIMILARITY"),
    $.env.get("BULK_GUARD_TRIM_TOKENS"),
    $.env.get("BULK_GUARD_HEAD_TOKENS"),
    $.env.get("BULK_GUARD_TAIL_TOKENS"),
    $.env.get("XDG_RUNTIME_DIR"),
  ]);
  return {
    off: off !== undefined && off !== "" && off !== "0",
    warnDocs: num(w, DEFAULTS.warnDocs),
    denyDocs: num(d, DEFAULTS.denyDocs),
    docMinBytes: num(b, DEFAULTS.docMinBytes),
    fanoutRows: num(r, DEFAULTS.fanoutRows),
    fanoutSimilarity: num(s, DEFAULTS.fanoutSimilarity),
    trimTokens: num(t, DEFAULTS.trimTokens),
    headTokens: num(h, DEFAULTS.headTokens),
    tailTokens: num(tl, DEFAULTS.tailTokens),
    dir: `${xdg || "/tmp"}/bulk-guard`,
  };
}
// Read once per load: the model cannot change the engine's environment mid-session.
const config = ($) => (configPromise ??= loadConfig($));

// ── per-session state (subagents share their parent's count) ──────────────────────────────────
const sessions = new Map();
async function stateFor($) {
  const id = await $.session.id();
  if (!sessions.has(id)) sessions.set(id, { id, docs: new Set(), warned: false, trimmed: 0 });
  return sessions.get(id);
}

// ── shell parsing ────────────────────────────────────────────────────────────────────────────
/** Quote-aware split of a shell command into segments (on ; & | newline) of words. */
export function shellSegments(cmd) {
  const segs = [];
  let words = [];
  let cur = "";
  let had = false;
  let q = null;
  const endWord = () => {
    if (had) words.push(cur);
    cur = "";
    had = false;
  };
  const endSeg = () => {
    endWord();
    if (words.length) segs.push(words);
    words = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < cmd.length) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      had = true;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[++i];
      had = true;
    } else if (c === ";" || c === "&" || c === "|" || c === "\n" || c === "(" || c === ")" || c === "`") {
      endSeg();
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      cur += c;
      had = true;
    }
  }
  endSeg();
  return segs;
}

/** The command word of a segment: skips env assignments and wrappers like sudo/xargs/do/then. */
function commandWord(seg) {
  let i = 0;
  while (i < seg.length) {
    const w = seg[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || /^(sudo|env|nice|time|command|exec|do|then|else|xargs|nohup)$/.test(w)) {
      i++;
      while (i < seg.length && seg[i - 1] === "xargs" && seg[i].startsWith("-")) i++;
      continue;
    }
    if (seg[i - 1] === "xargs" || (i > 0 && /^-/.test(w) && seg[i - 1] && /^xargs$/.test(seg[i - 1]))) {
      i++;
      continue;
    }
    return { word: w.replace(/^.*\//, ""), full: w, rest: seg.slice(i + 1) };
  }
  return null;
}

const literals = (s) => [...s.matchAll(/["']([^"'\n]{1,400})["']/g)].map((m) => m[1]);

/**
 * Paths and globs a Bash command reads with a reader verb or a script one-liner.
 * Redirect targets (> file) are writes and do not count.
 */
export function readerCandidates(cmd) {
  const segs = shellSegments(cmd);
  const out = new Set();
  let reads = false;
  let scripts = false;
  for (const seg of segs) {
    const cw = commandWord(seg);
    if (!cw) continue;
    const isRead = READ_VERB.test(cw.word) || (cw.word === "sed" && cw.rest.some((w) => /^-[a-zA-Z]*n/.test(w)));
    const isScript = SCRIPT_VERB.test(cw.word);
    if (!isRead && !isScript) continue;
    reads ||= isRead;
    scripts ||= isScript;
    for (let i = 0; i < cw.rest.length; i++) {
      const w = cw.rest[i];
      if (/^>>?$/.test(w) || /^\d?>/.test(w)) {
        i++;
        continue;
      }
      if (w.startsWith("-")) continue;
      out.add(w);
      if (isScript) for (const l of literals(w)) out.add(l);
    }
  }
  if (scripts) for (const l of literals(cmd)) out.add(l); // heredoc bodies and -c code
  if (reads || scripts) {
    // for f in a/*.txt b.txt; do head "$f"; done — the list feeds the reader
    for (const m of cmd.matchAll(/\bfor\s+\w+\s+in\s+([^;\n]*?)\s*(;|\n)\s*do\b/g)) {
      for (const seg of shellSegments(m[1])) for (const w of seg) out.add(w);
    }
  }
  return [...out].filter((p) => p && !p.includes("$") && !/^\d+$/.test(p) && /[\/.]/.test(p));
}

/** A path is a document candidate by its name; size is checked separately. */
export const looksLikeDocument = (p) => DOC_EXT.test(p) || DOC_DIR.test(p);

const AGENT_CALL =
  /(^|[\s;&|(`"'])((\S*\/)?claude\s+([^\n;|&]*\s)?(-p|--print)\b|(\S*\/)?codex\s+exec\b|(\S*\/)?gemini(\s|$|["'])|(\S*\/)?agy\s+([^\n;|&]*\s)?-p\b|(\S*\/)?(farm|farm-team|work-dispatch)\.sh\b)/;

/** Loop bodies of a shell command: for/while/until … do … done, xargs/parallel args, find -exec. */
export function shellLoopBodies(cmd) {
  const bodies = [];
  for (const m of cmd.matchAll(/\b(for|while|until)\b[\s\S]*?\bdo\b([\s\S]*?)\bdone\b/g)) bodies.push(m[2]);
  for (const m of cmd.matchAll(/\b(xargs|parallel)\b([^|;\n]*)/g)) bodies.push(" " + m[2]);
  for (const m of cmd.matchAll(/\s-exec(dir)?\s([^;\n]*?)(\\;|\+)/g)) bodies.push(" " + m[2]);
  return bodies;
}

/** Rule 2b: a loop that starts a model agent once per item. */
export const agentLoop = (cmd) => shellLoopBodies(cmd).some((b) => AGENT_CALL.test(b));

// ── rule 3: model API inside a loop ─────────────────────────────────────────────────────────
const PROVIDER =
  /\/v1\/messages|ANTHROPIC_BASE_URL|\banthropic\.|Anthropic\(|\bopenai\.|OpenAI\(|chat\.completions|generateContent|generate_content|\bgenai\b|google\.genai|GoogleGenAI|\/v1\/chat\/completions|api\.openai\.com|api\.anthropic\.com/;
const CALL =
  /\/v1\/messages|\/v1\/chat\/completions|messages\.create\(|messages\.stream\(|completions\.create\(|responses\.create\(|generateContent|generate_content\b|generate_content_stream|models\.generate|ANTHROPIC_BASE_URL.*(curl|fetch|requests|post)|(curl|fetch|requests\.post|httpx\.post).*(api\.anthropic\.com|api\.openai\.com|generativelanguage|aiplatform)/;
const GENAI_GENERATE = /generateContent|generate_content|models\.generate/;
const BATCH_FLOW = /batches\.create|batchPredictionJobs|batch_prediction|BatchPredictionJob|batches\.create_embeddings/;
const RETRY_HEADER = /range\(\s*\d{1,2}\s*\)|attempt|retr(y|ies)|backoff|while\s+True\b|while\s*\(\s*true\s*\)|tries/i;
const JSONL_WRITE = /["']url["']\s*:|["']method["']\s*:|json\.dumps|JSON\.stringify|\.write\(|writelines|jsonl/i;

const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;

/** Python: the loop headers enclosing line i (by indentation), plus same-line comprehensions. */
function pyEnclosing(lines, i) {
  const loops = [];
  let fn = null;
  if (/\bfor\s+\S.*\bin\b/.test(lines[i])) loops.push(lines[i]);
  let ind = indentOf(lines[i]);
  for (let j = i - 1; j >= 0 && ind > 0; j--) {
    const l = lines[j];
    if (!l.trim() || l.trim().startsWith("#")) continue;
    const k = indentOf(l);
    if (k < ind) {
      ind = k;
      if (/^\s*(async\s+)?(for|while)\b/.test(l)) loops.push(l);
      const d = l.match(/^\s*(async\s+)?def\s+(\w+)/);
      if (d && !fn) fn = d[2];
    }
  }
  return { loops, fn };
}

/** JS/TS: the lines opening the braces that enclose line i, and the enclosing function's name. */
function jsEnclosing(lines, i) {
  const loops = [];
  let fn = null;
  if (/\bfor\s*\(|\.(map|forEach|flatMap)\(/.test(lines[i])) loops.push(lines[i]);
  let depth = 0;
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    for (let c = l.length - 1; c >= 0; c--) {
      if (l[c] === "}") depth++;
      else if (l[c] === "{") {
        if (depth === 0) {
          if (/\b(for|while)\s*\(|\bfor\s+await\b|\.(map|forEach|flatMap)\(/.test(l)) loops.push(l);
          const d = l.match(/function\s*\*?\s*(\w+)|(?:const|let|var)\s+(\w+)\s*=|^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/);
          if (d && !fn) fn = d[1] || d[2] || d[3];
        } else depth--;
      }
    }
  }
  return { loops, fn };
}

const dataLoop = (headers) => headers.some((h) => !RETRY_HEADER.test(h));

function inLoop(lines, i, lang, depth = 0) {
  const { loops, fn } = (lang === "py" ? pyEnclosing : jsEnclosing)(lines, i);
  if (dataLoop(loops)) return true;
  if (!fn || depth >= 2) return false;
  // indirection: the enclosing function is mapped over items or called inside a loop
  const name = fn.replace(/[$]/g, "\\$");
  const mapped = new RegExp(`\\b(map|imap|imap_unordered|starmap|submit|apply_async|run_in_executor|gather)\\([^)]*\\b${name}\\b|\\.(map|forEach|flatMap)\\(\\s*${name}\\b`);
  const call = new RegExp(`\\b${name}\\s*\\(`);
  for (let j = 0; j < lines.length; j++) {
    if (j === i) continue;
    const l = lines[j];
    if (mapped.test(l)) return true;
    if (call.test(l) && !/^\s*(async\s+)?(def|function)\b/.test(l) && inLoop(lines, j, lang, depth + 1)) return true;
  }
  return false;
}

/**
 * Rule 3. True when `text` calls a model API inside a loop over items. `lang` is py, js or sh
 * (a Bash command is checked as sh and as py, so heredoc'd scripts are covered).
 */
export function apiInLoop(text, lang) {
  if (!PROVIDER.test(text) && !CALL.test(text)) return false;
  const batch = BATCH_FLOW.test(text);
  const isCall = (l) => CALL.test(l) && !/batch/i.test(l) && !JSONL_WRITE.test(l) && !(batch && GENAI_GENERATE.test(l));
  if (lang === "sh") return shellLoopBodies(text).some((b) => b.split("\n").some(isCall));
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(#|\/\/|\*)/.test(lines[i])) continue;
    if (isCall(lines[i]) && inLoop(lines, i, lang)) return true;
  }
  return false;
}

export const langOf = (path) =>
  /\.py$/i.test(path) ? "py" : /\.(sh|bash)$/i.test(path) ? "sh" : SCRIPT_EXT.test(path) ? "js" : null;

// ── rule 2: template fan-out ─────────────────────────────────────────────────────────────────
/** Mask what varies per item in a templated prompt: paths, accession numbers, CIKs, numbers. */
export function maskPrompt(s) {
  return s
    .replace(/\b\d{10}-\d{2}-\d{6}\b/g, " ACC ")
    .replace(/(~|\.{0,2})?\/?[\w.~-]+(\/[\w.~@%+-]+)+\/?/g, " PATH ")
    .replace(/\b[\w-]+\.(txt|htm|html|xml|sgml|pdf|nc|json|csv|md|py|typ|bib)\b/gi, " FILE ")
    .replace(/\bCIK\s*[:#]?\s*\d+/gi, " CIK ")
    .replace(/\d+([.,]\d+)*/g, " N ");
}

const tokens = (s) => s.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Similarity of two masked prompts: the larger of token Jaccard and normalised Levenshtein. */
export function similarity(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const jac = union ? inter / union : 1;
  // Levenshtein is quadratic; only for short prompts, where a token set is too coarse.
  const lev = a.length <= 1500 && b.length <= 1500 ? 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1) : 0;
  return Math.max(jac, lev);
}

/** Rows (row 0 included) that are near-identical to the row-0 template after masking. */
export function templateRows(rows, threshold) {
  if (!Array.isArray(rows) || rows.length < 2) return rows?.length ?? 0;
  const text = (r) => (typeof r?.prompt === "string" ? r.prompt : JSON.stringify(r));
  const t0 = maskPrompt(text(rows[0]));
  let n = 1;
  for (let i = 1; i < rows.length; i++) if (similarity(t0, maskPrompt(text(rows[i]))) >= threshold) n++;
  return n;
}

/** The --tasks files of farm.sh / farm-team.sh / work-dispatch.sh calls in a Bash command. */
export function fanoutTaskFiles(cmd) {
  const files = [];
  for (const seg of shellSegments(cmd)) {
    if (!seg.some((w) => FANOUT_SCRIPT.test(w))) continue;
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] === "--tasks" && seg[i + 1]) files.push(seg[i + 1]);
      else if (seg[i].startsWith("--tasks=")) files.push(seg[i].slice(8));
    }
  }
  return files;
}

export const setsOverride = (cmd) => /\bBULK_GUARD_OFF\s*=|\bexport\s+BULK_GUARD_OFF\b|\bunset\s+BULK_GUARD_OFF\b/.test(cmd);

// ── result trimming ──────────────────────────────────────────────────────────────────────────
export const estTokens = (s) => Math.ceil(s.length / 4);

/** Head + marker + tail, or null when `text` is under the limit. */
export function trimText(text, cfg, path) {
  const n = estTokens(text);
  if (n <= cfg.trimTokens) return null;
  let head = text.slice(0, cfg.headTokens * 4);
  let tail = text.slice(text.length - cfg.tailTokens * 4);
  const hb = head.lastIndexOf("\n");
  if (hb > head.length * 0.9) head = head.slice(0, hb + 1);
  const tb = tail.indexOf("\n");
  if (tb >= 0 && tb < tail.length * 0.1) tail = tail.slice(tb + 1);
  const cut = n - estTokens(head) - estTokens(tail);
  return { text: `${head}\n[bulk-guard: trimmed ${cut} tokens; full output at ${path}]\n${tail}`, cut };
}

// ── side effects ─────────────────────────────────────────────────────────────────────────────
async function logEvent($, cfg, rec) {
  const line = JSON.stringify({ ts: new Date().toISOString(), session: (await $.session.id()) ?? null, ...rec });
  try {
    // >> append is atomic per line across the sessions and children sharing the file
    await $.process.run(["sh", "-c", 'mkdir -p "$1" && printf "%s\\n" "$2" >> "$1/events.jsonl"', "sh", cfg.dir, line]);
  } catch {
    /* the log is visibility, never a gate */
  }
}

function redraw($) {
  try {
    $.ui.invalidate("ui.render");
  } catch {
    /* headless */
  }
}

async function absolute($, p) {
  if (p.startsWith("/")) return p;
  if (p.startsWith("~/")) return `${(await $.env.get("HOME")) ?? ""}/${p.slice(2)}`;
  return `${await $.session.cwd()}/${p.replace(/^\.\//, "")}`;
}

const globRe = (g) =>
  new RegExp("^" + g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");

/** Distinct documents (absolute path ≥ docMinBytes, document-shaped name) a call would read. */
export async function documentsRead($, cfg, candidates) {
  const docs = new Set();
  for (const raw of candidates) {
    if (!looksLikeDocument(raw)) continue;
    const p = await absolute($, raw);
    if (/[*?]/.test(p)) {
      const slash = p.lastIndexOf("/");
      const dir = p.slice(0, slash) || "/";
      if (/[*?[]/.test(dir)) continue;
      const re = globRe(p.slice(slash + 1));
      let entries = [];
      try {
        entries = await $.fs.list(dir);
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (!re.test(ent.name)) continue;
        const full = `${dir}/${ent.name}`;
        let size = ent.size;
        if (ent.isLink) size = (await $.fs.stat(full, { resolve: true }).catch(() => null))?.size ?? 0;
        else if (ent.kind !== "file") continue;
        if (size >= cfg.docMinBytes) docs.add(full);
      }
      continue;
    }
    const st = await $.fs.stat(p, { resolve: true }).catch(() => null);
    if (st && st.kind === "file" && st.size >= cfg.docMinBytes) docs.add(p);
  }
  return docs;
}

// ── the guard ────────────────────────────────────────────────────────────────────────────────
async function deny($, cfg, rule, e, detail) {
  await logEvent($, cfg, { kind: "deny", rule, tool: e.tool, agent: e.agentId ?? null, ...detail });
  return { deny: rule === "override" ? OFF_MESSAGE : DENY_MESSAGE };
}

/** Rules 1-3 before the call; a deny result, or the documents this call would add. */
async function precheck($, e, cfg, st) {
  let candidates = [];
  if (e.tool === "Bash") {
    const cmd = String(e.command ?? "");
    if (setsOverride(cmd)) return deny($, cfg, "override", e, { command: cmd.slice(0, 300) });
    if (agentLoop(cmd)) return deny($, cfg, "agent-loop", e, { command: cmd.slice(0, 300) });
    for (const f of fanoutTaskFiles(cmd)) {
      let rows;
      try {
        rows = JSON.parse(await $.fs.read(await absolute($, f)));
      } catch {
        continue; // farm.sh refuses a missing or malformed file itself
      }
      const n = templateRows(rows, cfg.fanoutSimilarity);
      if (n >= cfg.fanoutRows) return deny($, cfg, "template-fanout", e, { tasks: f, rows: rows.length, template_rows: n });
    }
    if (apiInLoop(cmd, "sh") || apiInLoop(cmd, "py") || apiInLoop(cmd, "js"))
      return deny($, cfg, "api-in-loop", e, { command: cmd.slice(0, 300) });
    candidates = readerCandidates(cmd);
  } else if (e.tool === "Read") {
    candidates = [String(e.file_path ?? "")];
  } else if (e.tool === "Write" || e.tool === "Edit") {
    const path = String(e.file_path ?? "");
    const lang = langOf(path);
    if (!lang) return { add: new Set() };
    const old = await $.fs.read(path).catch(() => "");
    let text = String(e.content ?? "");
    if (e.tool === "Edit") {
      const from = String(e.old_string ?? "");
      const to = String(e.new_string ?? "");
      text = from ? (e.replace_all ? old.split(from).join(to) : old.replace(from, () => to)) : to;
    }
    // Only a change that introduces the pattern: existing tools (pincite.py) stay editable.
    if (apiInLoop(text, lang) && !apiInLoop(old, lang)) return deny($, cfg, "api-in-loop", e, { file: path });
    return { add: new Set() };
  }
  const docs = await documentsRead($, cfg, candidates);
  const add = new Set([...docs].filter((d) => !st.docs.has(d)));
  if (add.size && st.docs.size + add.size >= cfg.denyDocs) {
    return deny($, cfg, "documents", e, { read: st.docs.size, would_add: [...add].slice(0, 20) });
  }
  return { add };
}

async function guard($, e, next) {
  const cfg = await config($);
  if (cfg.off) return next(e);
  const st = await stateFor($);
  const pre = await precheck($, e, cfg, st);
  if (pre.deny) return pre;

  const before = st.docs.size;
  for (const d of pre.add) st.docs.add(d);
  const r = await next(e);
  let out = r;
  if (!r.deny && !r.isError && ["Read", "Bash", "Grep"].includes(e.tool)) out = await trim($, e, cfg, st, r);
  if (st.docs.size !== before) redraw($);
  if (!st.warned && st.docs.size >= cfg.warnDocs && before < cfg.warnDocs) {
    st.warned = true;
    await logEvent($, cfg, { kind: "warn", rule: "documents", tool: e.tool, read: st.docs.size });
    const note = WARN_NOTE.replace("{n}", st.docs.size).replace("{deny}", cfg.denyDocs);
    out = { ...out, context: [...(out.context ?? []), note] };
  }
  return out;
}

/** The secondary rule: Read/Bash/Grep results over trimTokens keep head + tail; the rest is saved. */
async function trim($, e, cfg, st, r) {
  const res = r.result;
  let field = null;
  if (e.tool === "Bash" && typeof res?.stdout === "string") field = ["stdout"];
  else if (e.tool === "Read" && res?.type === "text" && typeof res.file?.content === "string") field = ["file", "content"];
  else if (e.tool === "Grep" && typeof res?.content === "string") field = ["content"];
  if (!field) return r;
  const text = field.length === 1 ? res[field[0]] : res.file.content;
  if (estTokens(text) <= cfg.trimTokens) return r;
  const path = `${cfg.dir}/${(await $.session.id()).slice(0, 8)}-${Date.now()}-${e.tool.toLowerCase()}.txt`;
  try {
    await $.fs.write(path, text);
  } catch {
    await $.process.run(["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path], { stdin: text });
  }
  const t = trimText(text, cfg, path);
  const result = field.length === 1 ? { ...res, [field[0]]: t.text } : { ...res, file: { ...res.file, content: t.text } };
  st.trimmed++;
  redraw($);
  await logEvent($, cfg, { kind: "trim", tool: e.tool, tokens: estTokens(text), cut: t.cut, path });
  return r.context ? { result, context: r.context } : { result };
}

export function register(on) {
  on("tool.call", { tool: ["Read", "Bash", "Grep", "Write", "Edit"] }, guard);

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const cfg = await config($);
    const st = sessions.get(await $.session.id());
    if (cfg.off || e.props?.hasSurvey || !st || (st.docs.size === 0 && st.trimmed === 0)) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const hot = st.docs.size >= cfg.warnDocs;
    return Box({
      paddingX: 1,
      children: [
        Text({ color: hot ? "yellow" : undefined, dimColor: !hot, children: `docs read ${st.docs.size}/${cfg.denyDocs}` }),
        Text({ dimColor: true, children: ` · trimmed ${st.trimmed} results` }),
      ],
    });
  });
}

/** Test seam: forget per-session state and the cached config. */
export function _reset() {
  sessions.clear();
  configPromise = undefined;
}
