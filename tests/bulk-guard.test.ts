import { test, expect, beforeEach, afterAll } from "bun:test";
import { dirname, join } from "path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, lstatSync } from "fs";
import { tmpdir } from "os";
// @ts-ignore — plain ES module
import { register, _reset, DENY_MESSAGE } from "../hooks/bulk-guard.mjs";

const ROOT = dirname(import.meta.dir);
const FIX = join(ROOT, "tests", "fixtures", "bulk-guard");
const SCRATCH = mkdtempSync(join(tmpdir(), "bulk-guard-test-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

type Hook = ($: any, e: any, next: any) => Promise<any>;

/** A fake `$` backed by the real filesystem, and the hooks register() installs. */
function harness(env: Record<string, string> = {}) {
  _reset();
  const hooks: Record<string, Hook> = {};
  register((event: string, _matcher: unknown, hook: Hook) => {
    hooks[event] = hook;
  });
  const sid = `test-${Math.random().toString(36).slice(2, 10)}`;
  const xdg = mkdtempSync(join(SCRATCH, "xdg-"));
  const vars: Record<string, string> = { XDG_RUNTIME_DIR: xdg, HOME: SCRATCH, ...env };
  const $ = {
    env: { get: async (k: string) => vars[k] },
    session: { id: async () => sid, cwd: async () => SCRATCH },
    fs: {
      read: async (p: string) => readFileSync(p, "utf8"),
      write: async (p: string, t: string) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, t);
      },
      stat: async (p: string) => {
        const s = statSync(p);
        return { kind: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other", size: s.size, mtimeMs: s.mtimeMs, isLink: false };
      },
      list: async (p: string) =>
        readdirSync(p).map((name) => {
          const s = lstatSync(join(p, name));
          return { name, kind: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other", size: s.size, isLink: s.isSymbolicLink() };
        }),
    },
    process: {
      run: async (argv: string[], opts: { stdin?: string } = {}) => {
        const r = Bun.spawnSync(argv, { stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : undefined });
        return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
      },
    },
    ui: { invalidate: () => {}, resolve: () => ({ Box: (p: any) => p, Text: (p: any) => p }) },
  };
  let ran = 0;
  /** Fire one tool.call; `answer` is what the tool would return when it runs. */
  const call = async (args: Record<string, unknown>, answer: any = { result: { stdout: "ok", stderr: "", interrupted: false } }) => {
    const e = Object.freeze({ ...args });
    const next = async (ev: any) => {
      ran++;
      return { ref: {}, text: "", ...answer };
    };
    return hooks["tool.call"]($, e, next);
  };
  const events = () => {
    const f = join(xdg, "bulk-guard", "events.jsonl");
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  };
  return { $, hooks, call, events, ran: () => ran, xdg };
}

let docDir: string;
function filings(n: number, bytes = 50_000, ext = "txt", dir = "filings") {
  docDir = mkdtempSync(join(SCRATCH, `${dir}-`));
  return Array.from({ length: n }, (_, i) => {
    const p = join(docDir, `doc${String(i).padStart(2, "0")}.${ext}`);
    writeFileSync(p, `ACME CORP ${i}\n` + "x".repeat(bytes));
    return p;
  });
}

beforeEach(() => _reset());

test("9 distinct documents are read, the 10th is denied with the exact message", async () => {
  const h = harness();
  const docs = filings(12);
  for (const p of docs.slice(0, 9)) expect((await h.call({ tool: "Read", file_path: p })).deny).toBeUndefined();
  const r = await h.call({ tool: "Read", file_path: docs[9] });
  expect(r.deny).toBe(DENY_MESSAGE);
  expect(h.ran()).toBe(9);
  expect(h.events().filter((e) => e.kind === "deny")).toHaveLength(1);
});

test("rereads do not count", async () => {
  const h = harness();
  const docs = filings(9);
  for (const p of docs) await h.call({ tool: "Read", file_path: p });
  for (let i = 0; i < 20; i++) expect((await h.call({ tool: "Read", file_path: docs[i % 9] })).deny).toBeUndefined();
});

test("warns once at 5 documents, through context, naming gemini-batch", async () => {
  const h = harness();
  const docs = filings(7);
  const notes = [];
  for (const p of docs) notes.push((await h.call({ tool: "Read", file_path: p })).context ?? []);
  expect(notes.map((n) => n.length)).toEqual([0, 0, 0, 0, 1, 0, 0]);
  expect(notes[4][0]).toContain("gemini-batch");
  expect(h.events().map((e) => e.kind)).toEqual(["warn"]);
});

test("small files and non-document names are not counted", async () => {
  const h = harness();
  const small = filings(15, 5_000);
  for (const p of small) expect((await h.call({ tool: "Read", file_path: p })).deny).toBeUndefined();
  const code = filings(15, 50_000, "py", "src");
  for (const p of code) expect((await h.call({ tool: "Read", file_path: p })).deny).toBeUndefined();
});

test("a path under edgar/ counts whatever its extension", async () => {
  const h = harness();
  const docs = filings(10, 50_000, "dat", "edgar");
  for (const p of docs.slice(0, 9)) await h.call({ tool: "Read", file_path: p });
  expect((await h.call({ tool: "Read", file_path: docs[9] })).deny).toBe(DENY_MESSAGE);
});

test("cat, sed -n, head, pdftotext and python one-liners count; relative paths resolve", async () => {
  const h = harness();
  const d = filings(12);
  const rel = (p: string) => p.slice(SCRATCH.length + 1);
  const cmds = [
    `cat ${d[0]}`,
    `sed -n '1,40p' "${d[1]}"`,
    `head -c 2000 ${rel(d[2])} | grep ACME`,
    `pdftotext -layout ${d[3]} - | head`,
    `python3 -c "print(open('${d[4]}').read()[:100])"`,
    `tail -n 5 ${d[5]} ${d[6]}`,
    `awk 'NR<3' ${d[7]} > /tmp/out.txt`,
    `strings ${d[8]}`,
  ];
  for (const c of cmds) expect((await h.call({ tool: "Bash", command: c })).deny).toBeUndefined();
  expect((await h.call({ tool: "Bash", command: `less ${d[9]}` })).deny).toBe(DENY_MESSAGE);
});

test("a glob or for-loop over filings counts every file it would open", async () => {
  const h = harness();
  filings(12);
  const r = await h.call({ tool: "Bash", command: `for f in ${docDir}/*.txt; do head -3 "$f"; done` });
  expect(r.deny).toBe(DENY_MESSAGE);
  const h2 = harness();
  expect((await h2.call({ tool: "Bash", command: `head -3 ${docDir}/doc0*.txt` })).deny).toBe(DENY_MESSAGE);
  const h3 = harness();
  expect((await h3.call({ tool: "Bash", command: `ls -la ${docDir}/*.txt && wc -c ${docDir}/*.txt` })).deny).toBeUndefined();
});

const FARM = "bash ~/.claude/skills/workflows/skills/farm-out/scripts/farm.sh";

test("a 6+ row near-identical tasks file is denied; a 6-row different one is allowed", async () => {
  const h = harness();
  const deny = await h.call({ tool: "Bash", command: `${FARM} --provider claude --tasks ${join(FIX, "template-tasks.json")}` });
  expect(deny.deny).toBe(DENY_MESSAGE);
  expect(h.events()[0]).toMatchObject({ kind: "deny", rule: "template-fanout", template_rows: 7 });
  const ok = await h.call({ tool: "Bash", command: `${FARM} --tasks=${join(FIX, "distinct-tasks.json")}` });
  expect(ok.deny).toBeUndefined();
  const team = await h.call({ tool: "Bash", command: `skills/farm-out/scripts/farm-team.sh --tasks ${join(FIX, "template-tasks.json")}` });
  expect(team.deny).toBe(DENY_MESSAGE);
});

test("per-item agent loops are denied; single agent calls are not", async () => {
  const h = harness();
  for (const c of [
    `for f in filings/*.txt; do claude -p "extract the company name from $f"; done`,
    `while read f; do codex exec "summarise $f" >> out; done < list.txt`,
    `ls filings | xargs -I{} claude --print "read {}"`,
    `find . -name '*.txt' -exec gemini -p "code {}" \\;`,
    `for i in 1 2 3; do agy -p "row $i"; done`,
  ])
    expect((await h.call({ tool: "Bash", command: c })).deny).toBe(DENY_MESSAGE);
  for (const c of [
    `claude -p "say hi"`,
    `for f in *.json; do python validate_jsonl.py "$f"; done`,
    `for s in a b; do echo gemini-batch $s; done`,
  ])
    expect((await h.call({ tool: "Bash", command: c })).deny).toBeUndefined();
});

const LOOP_PY = `import anthropic, glob
client = anthropic.Anthropic()
for path in glob.glob("filings/*.txt"):
    text = open(path).read()
    msg = client.messages.create(model="claude-sonnet-5", max_tokens=200,
        messages=[{"role": "user", "content": text}])
    print(path, msg.content[0].text)
`;
const MAPPED_PY = `from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor
client = OpenAI()
def code(row):
    return client.chat.completions.create(model="gpt", messages=[row])
with ThreadPoolExecutor(8) as ex:
    out = list(ex.map(code, rows))
`;

test("agent-written model-API-in-a-loop scripts are denied (Write, Bash heredoc, curl loop)", async () => {
  const h = harness();
  expect((await h.call({ tool: "Write", file_path: join(SCRATCH, "x.py"), content: LOOP_PY })).deny).toBe(DENY_MESSAGE);
  expect((await h.call({ tool: "Write", file_path: join(SCRATCH, "y.py"), content: MAPPED_PY })).deny).toBe(DENY_MESSAGE);
  expect((await h.call({ tool: "Bash", command: `python3 - <<'EOF'\n${LOOP_PY}EOF` })).deny).toBe(DENY_MESSAGE);
  const curl = `for f in filings/*.txt; do curl -s $ANTHROPIC_BASE_URL/v1/messages -d @"$f"; done`;
  expect((await h.call({ tool: "Bash", command: curl })).deny).toBe(DENY_MESSAGE);
  const js = `const client = new Anthropic();\nfor (const f of files) {\n  const r = await client.messages.create({model, messages: [f]});\n}\n`;
  expect((await h.call({ tool: "Write", file_path: join(SCRATCH, "z.ts"), content: js })).deny).toBe(DENY_MESSAGE);
  expect(h.events().every((e) => e.rule === "api-in-loop")).toBe(true);
});

test("one model call, a retry loop, and an Edit that adds the loop", async () => {
  const h = harness();
  const one = `client = anthropic.Anthropic()\nmsg = client.messages.create(model="m", messages=[])\n`;
  expect((await h.call({ tool: "Write", file_path: join(SCRATCH, "one.py"), content: one })).deny).toBeUndefined();
  const retry = `def ask(p):\n    for attempt in range(5):\n        try:\n            return client.messages.create(model="m", messages=[p])\n        except Exception:\n            pass\n`;
  expect((await h.call({ tool: "Write", file_path: join(SCRATCH, "retry.py"), content: retry })).deny).toBeUndefined();
  const p = join(SCRATCH, "grow.py");
  writeFileSync(p, one);
  const edit = { tool: "Edit", file_path: p, old_string: `msg = client`, new_string: `for f in files:\n    msg = client` };
  expect((await h.call(edit)).deny).toBe(DENY_MESSAGE);
});

test("the repo's gemini-batch examples and scripts are allowed", async () => {
  const h = harness();
  const dir = join(ROOT, "skills", "gemini-batch");
  const files = [...new Bun.Glob("**/*.{py,sh,ts,js}").scanSync({ cwd: dir })];
  expect(files.length).toBeGreaterThanOrEqual(6);
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    const r = await h.call({ tool: "Write", file_path: join(SCRATCH, "gb", f.replace(/\//g, "_")), content });
    expect([f, r.deny]).toEqual([f, undefined]);
  }
});

test("editing an existing tool that already loops over a model API stays allowed", async () => {
  const h = harness();
  const p = join(ROOT, "skills", "pincite", "scripts", "pincite.py");
  const r = await h.call({ tool: "Edit", file_path: p, old_string: "def norm(s):", new_string: "def norm(s):  # x" });
  expect(r.deny).toBeUndefined();
});

test("oversized Bash, Read and Grep results are trimmed and saved in full; Edit is untouched", async () => {
  const h = harness();
  const big = Array.from({ length: 12_000 }, (_, i) => `line ${i} ${"y".repeat(20)}`).join("\n");
  const bash = await h.call({ tool: "Bash", command: "seq 1 12000" }, { result: { stdout: big, stderr: "", interrupted: false } });
  const out = bash.result.stdout as string;
  const m = out.match(/\[bulk-guard: trimmed (\d+) tokens; full output at (\S+)\]/);
  expect(m).not.toBeNull();
  expect(readFileSync(m![2], "utf8")).toBe(big);
  expect(out.length / 4).toBeLessThan(8_200);
  expect(out.startsWith("line 0 ")).toBe(true);
  expect(out.trimEnd().endsWith("line 11999 " + "y".repeat(20))).toBe(true);

  const read = await h.call(
    { tool: "Read", file_path: "/x.md" },
    { result: { type: "text", file: { filePath: "/x.md", content: big, numLines: 12000, startLine: 1, totalLines: 12000 } } },
  );
  expect(read.result.file.content).toContain("[bulk-guard: trimmed");
  expect(read.result.file.numLines).toBe(12000);
  const grep = await h.call({ tool: "Grep", pattern: "y" }, { result: { mode: "content", content: big } });
  expect(grep.result.content).toContain("[bulk-guard: trimmed");

  const edit = await h.call({ tool: "Edit", file_path: join(SCRATCH, "a.txt"), old_string: "a", new_string: "b" }, { result: { diff: big } });
  expect(edit.result.diff).toBe(big);
  const small = await h.call({ tool: "Bash", command: "ls" });
  expect(small.result.stdout).toBe("ok");
  expect(h.events().filter((e) => e.kind === "trim")).toHaveLength(3);
});

test("BULK_GUARD_OFF=1 disables every rule; a command may not set it", async () => {
  const h = harness({ BULK_GUARD_OFF: "1" });
  for (const p of filings(12)) expect((await h.call({ tool: "Read", file_path: p })).deny).toBeUndefined();
  expect((await h.call({ tool: "Bash", command: `${FARM} --tasks ${join(FIX, "template-tasks.json")}` })).deny).toBeUndefined();
  const big = "z".repeat(200_000);
  expect((await h.call({ tool: "Bash", command: "x" }, { result: { stdout: big } })).result.stdout).toBe(big);

  const on = harness();
  for (const c of [`BULK_GUARD_OFF=1 cat ${docDir}/doc00.txt`, `export BULK_GUARD_OFF=1`])
    expect((await on.call({ tool: "Bash", command: c })).deny).toContain("BULK_GUARD_OFF");
});

test("thresholds are overridable by env", async () => {
  const h = harness({ BULK_GUARD_DENY_DOCS: "3", BULK_GUARD_DOC_BYTES: "1000" });
  const d = filings(4, 2_000);
  await h.call({ tool: "Read", file_path: d[0] });
  await h.call({ tool: "Read", file_path: d[1] });
  expect((await h.call({ tool: "Read", file_path: d[2] })).deny).toBe(DENY_MESSAGE);
});

test("the AbovePrompt band shows docs read and trims, and yields to a survey", async () => {
  const h = harness();
  const next = async () => "default";
  expect(await h.hooks["ui.render"](h.$, { props: {} }, next)).toBe("default");
  for (const p of filings(2)) await h.call({ tool: "Read", file_path: p });
  const band = await h.hooks["ui.render"](h.$, { props: {} }, next);
  expect(JSON.stringify(band)).toContain("docs read 2/10");
  expect(JSON.stringify(band)).toContain("trimmed 0 results");
  expect(await h.hooks["ui.render"](h.$, { props: { hasSurvey: true } }, next)).toBe("default");
});

test("bulk-guard is registered through the plugin's one hooks module, beside the settings hooks", () => {
  // `modules` takes ONE path per plugin (a second entry is refused), so hooks/register.ts composes
  // bulk-guard with the watcher mod.
  const cfg = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
  expect(cfg.modules).toEqual(["./register.ts"]);
  const entry = readFileSync(join(ROOT, "hooks", "register.ts"), "utf8");
  expect(entry).toContain("from './bulk-guard.mjs'");
  expect(entry).toContain("registerBulkGuard(on)");
  expect(Object.keys(cfg.hooks).length).toBeGreaterThan(3);
});
