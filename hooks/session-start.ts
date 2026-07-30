#!/usr/bin/env bun
/**
 * SessionStart hook: Inject environment context and skill guidance at session start.
 * Loads API keys, SSH status, sets CLAUDE_CODE_TASK_LIST_ID for project-scoped tasks.
 *
 * TypeScript port of session-start.py. Behavior-preserving, including the odd bits:
 *   - the env-var loader only sets keys ABSENT from the environment, and an empty string counts
 *     as present (so a neutralized key blocks its own .env value);
 *   - `${CLAUDE_PLUGIN_ROOT}` is substituted by hand because the hook injects raw text;
 *   - every warning goes to stderr and every failure path degrades to "" rather than raising.
 *
 * Output goes through pyJson, never JSON.stringify: json.dumps' separators and ensure_ascii
 * change the bytes of the ⚠️ in the remote-session banner and of every em dash below.
 */
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parsePayload, pyJson } from "./_gate_common.ts";

/** Process-local mirror of os.environ — mutated by the loaders exactly as Python mutates os.environ. */
const env: Record<string, string> = { ...(process.env as Record<string, string>) };

/** Python's str.strip(chars): trim ALL leading/trailing occurrences of the given char. */
function stripChar(s: string, ch: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === ch) start++;
  while (end > start && s[end - 1] === ch) end--;
  return s.slice(start, end);
}

function loadEnvFile(envFile: string): void {
  if (!existsSync(envFile)) return;
  try {
    const text = readFileSync(envFile, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line && !line.startsWith("#") && line.includes("=")) {
        const idx = line.indexOf("=");
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        value = stripChar(value, '"');
        value = stripChar(value, "'");
        if (key && !(key in env)) env[key] = value;
      }
    }
  } catch (e) {
    console.error(`Warning: Failed to load ${envFile}: ${e}`);
  }
}

function loadDotenvIfExists(): void {
  loadEnvFile(join(process.cwd(), ".env"));
}

function loadCentralSecrets(): void {
  loadEnvFile(join(homedir(), ".secrets", "claude-keys.env"));
}

const KEY_VARS = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "WRDS_USERNAME", "WRDS_PASSWORD",
  "LSEG_APP_KEY", "REFINITIV_APP_KEY",
  "HF_TOKEN", "HUGGINGFACE_TOKEN",
  "GITHUB_TOKEN", "GH_TOKEN",
];

type EnvContext = {
  session_type: string;
  ssh_client?: string | null;
  api_keys_available?: Record<string, string>;
  cwd: string;
  direnv_active?: boolean;
  pixi_project?: boolean;
};

function getEnvironmentContext(): EnvContext {
  const isSsh = ["SSH_CLIENT", "SSH_TTY", "SSH_CONNECTION"].some((v) => !!env[v]);
  const context: EnvContext = { session_type: isSsh ? "remote (SSH)" : "local", cwd: process.cwd() };
  if (isSsh) {
    context.ssh_client = env["SSH_CLIENT"] ? (env["SSH_CLIENT"] || "").split(/\s+/)[0] : null;
  }

  const apiKeys: Record<string, string> = {};
  for (const key of KEY_VARS) {
    const val = env[key];
    if (val) {
      // Python's len() counts code points, not UTF-16 units.
      apiKeys[key] = [...val].length > 12 ? `${val.slice(0, 4)}...${val.slice(-4)}` : "***set***";
    }
  }
  if (Object.keys(apiKeys).length) context.api_keys_available = apiKeys;

  if (env["DIRENV_DIR"]) context.direnv_active = true;
  if (existsSync(join(process.cwd(), ".pixi")) || env["PIXI_PROJECT_MANIFEST"]) context.pixi_project = true;

  return context;
}

function getPluginRoot(): string {
  return resolve(import.meta.dir, "..");
}

function loadUsingSkillsContent(): string {
  const skillFile = join(getPluginRoot(), "skills", "using-skills", "SKILL.md");
  try {
    let content = readFileSync(skillFile, "utf8");
    content = content.replaceAll("${CLAUDE_PLUGIN_ROOT}", getPluginRoot());
    return content;
  } catch (e) {
    console.error(`Warning: Failed to load using-skills content: ${e}`);
    return 'Skills available. Use Skill(skill="name") to invoke.';
  }
}

function persistEnvVarsForBash(): string[] {
  const claudeEnvFile = env["CLAUDE_ENV_FILE"];
  if (!claudeEnvFile) return [];

  const persisted: string[] = [];
  try {
    let buf = "";
    for (const v of KEY_VARS) {
      const val = env[v];
      if (val) {
        const escaped = val.replaceAll("'", "'\\''");
        buf += `export ${v}='${escaped}'\n`;
        persisted.push(v);
      }
    }
    // Python opens the file in append mode unconditionally, creating it even when nothing
    // is written; appendFileSync("") does the same.
    appendFileSync(claudeEnvFile, buf);
    return persisted;
  } catch (e) {
    console.error(`Warning: Failed to persist env vars to ${claudeEnvFile}: ${e}`);
    return [];
  }
}

function buildEnvSection(ctx: EnvContext, persistedVars: string[]): string {
  const isRemote = (ctx.session_type ?? "local") === "remote (SSH)";
  const lines = ["# Session Environment (USE THIS - DO NOT RUN COMMANDS TO CHECK)", ""];

  if (isRemote) {
    lines.push("## ⚠️ REMOTE SESSION (SSH)");
    lines.push("");
    lines.push("You are connected to a **remote machine** via SSH.");
    lines.push("- GUI apps (VSCode, browsers, etc.) run on the REMOTE machine");
    lines.push("- File paths refer to the REMOTE filesystem");
    lines.push("- Do NOT suggest local machine solutions for remote problems");
  } else {
    lines.push("## LOCAL SESSION");
    lines.push("");
    lines.push("You are running on the **local machine**.");
    lines.push("- Full GUI/Hyprland access available");
    lines.push("- File paths refer to local filesystem");
  }

  lines.push("");

  if (ctx.api_keys_available) {
    lines.push(`- **API keys available**: ${Object.keys(ctx.api_keys_available).join(", ")}`);
  }
  if (ctx.direnv_active) lines.push("- **direnv**: active");
  if (ctx.pixi_project) lines.push("- **pixi**: detected");
  if (persistedVars.length) lines.push(`- **Persisted for bash**: ${persistedVars.join(", ")}`);

  lines.push("");
  return lines.join("\n");
}

function extractFirstHeadingAndSummary(content: string, maxLines = 5): string {
  let inFrontmatter = false;
  const bodyLines: string[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    bodyLines.push(line);
  }

  const result: string[] = [];
  for (const line of bodyLines) {
    if (line.trim()) {
      result.push(line);
      if (result.length >= maxLines) break;
    }
  }
  return result.join("\n");
}

/** Simple YAML-like parser for frontmatter: key: value pairs and simple lists. */
function parseYamlSimple(content: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let inFrontmatter = false;
  let currentListKey: string | null = null;

  for (const line of content.split("\n")) {
    const stripped = line.trim();

    if (stripped === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        break;
      }
    }
    if (!inFrontmatter) continue;

    if (!stripped || stripped.startsWith("#")) {
      currentListKey = null;
      continue;
    }

    if (stripped.startsWith("- ") && currentListKey) {
      if (!(currentListKey in result)) result[currentListKey] = [];
      let item = stripped.slice(2).trim();
      item = stripChar(item, '"');
      item = stripChar(item, "'");
      (result[currentListKey] as string[]).push(item);
      continue;
    }

    if (stripped.includes(":")) {
      const idx = stripped.indexOf(":");
      const key = stripped.slice(0, idx).trim();
      let value = stripped.slice(idx + 1).trim();
      value = stripChar(value, '"');
      value = stripChar(value, "'");

      if (!value) {
        currentListKey = key;
        result[key] = [];
      } else {
        currentListKey = null;
        result[key] = value;
      }
    }
  }

  return result;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `.get(key, fallback)` on the parsed frontmatter, rendered the way an f-string would.
 * A bare `key:` parses to a LIST, and Python interpolates that as its repr (`[]`, `['a', 'b']`),
 * so a list value must not collapse to JS's comma-joined String([]).
 */
function str(v: string | string[] | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  if (Array.isArray(v)) return "[" + v.map((x) => `'${x}'`).join(", ") + "]";
  return v;
}

/** Python truthiness of a frontmatter value: "" and [] are false, everything else true. */
function truthy(v: string | string[] | undefined): boolean {
  if (v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : v !== "";
}

function buildInProgressSection(): string {
  const planningDir = join(process.cwd(), ".planning");
  const legacyDir = join(process.cwd(), ".claude");

  let stateDir: string;
  let statePrefix: string;
  if (existsSync(planningDir) && isDir(planningDir) && readdirSync(planningDir).length > 0) {
    stateDir = planningDir;
    statePrefix = ".planning";
  } else if (existsSync(legacyDir) && existsSync(join(legacyDir, "PLAN.md"))) {
    stateDir = legacyDir;
    statePrefix = ".claude";
  } else {
    return "";
  }

  const stateFiles: string[] = [];
  const keyFiles = ["PLAN.md", "WORK.md", "ACTIVE_WORKFLOW.md", "HANDOFF.md", "PRECIS.md", "OUTLINE.md",
    "VALIDATION.md", "REVIEW.md", "REVIEW_STATE.md", "PHASE_SUMMARY.md"];
  for (const name of keyFiles) {
    if (existsSync(join(stateDir, name))) stateFiles.push(name);
  }

  const subdirs: string[] = [];
  for (const subdirName of ["outlines", "drafts"]) {
    const subdir = join(stateDir, subdirName);
    if (existsSync(subdir) && isDir(subdir)) {
      const files = readdirSync(subdir).filter((f) => f.endsWith(".md"));
      if (files.length) subdirs.push(`${subdirName}/ (${files.length} files)`);
    }
  }

  if (!stateFiles.length && !subdirs.length) return "";

  const lines = ["## IN-PROGRESS WORK DETECTED", ""];
  lines.push(`State directory: \`${statePrefix}/\``);
  lines.push(`Files: ${stateFiles.join(", ")}`);
  if (subdirs.length) lines.push(`Subdirs: ${subdirs.join(", ")}`);
  lines.push("");

  // --- Handoff (highest priority — explicit pause point) ---
  const handoffPath = join(stateDir, "HANDOFF.md");
  if (existsSync(handoffPath)) {
    try {
      const content = readFileSync(handoffPath, "utf8");
      const fm = parseYamlSimple(content);
      const phaseName = str(fm["stage"] ?? fm["phase_name"], "unknown");
      const task = str(fm["task"], "?");
      const totalTasks = str(fm["open_tasks"] ?? fm["total_tasks"], "?");
      const lastUpdated = str(fm["last_updated"], "unknown");

      let nextAction = "";
      let inNext = false;
      for (const line of content.split("\n")) {
        if (line.trim().startsWith("## Next Action")) {
          inNext = true;
          continue;
        }
        if (inNext) {
          const s = line.trim();
          if (s && !s.startsWith("#")) {
            nextAction = s;
            break;
          }
        }
      }

      lines.push("### Handoff from previous session");
      lines.push(`- Phase: **${phaseName}** | Task ${task}/${totalTasks} | Updated: ${lastUpdated}`);
      if (nextAction) lines.push(`- Next action: ${nextAction}`);
      lines.push(`- Full context: \`${statePrefix}/HANDOFF.md\``);
      lines.push("");
    } catch {
      // pass
    }
  }

  // --- Active Workflow ---
  const workflowPath = join(stateDir, "ACTIVE_WORKFLOW.md");
  if (existsSync(workflowPath)) {
    try {
      const content = readFileSync(workflowPath, "utf8");
      const wf = parseYamlSimple(content);
      const wfTypeRaw = wf["workflow"] ?? "";
      const wfType = str(wfTypeRaw, "");
      const phaseName = wf["phase_name"] !== undefined ? str(wf["phase_name"], "unknown") : str(wf["phase"], "unknown");

      if (truthy(wfTypeRaw)) {
        lines.push(`### Active workflow: **${wfType}** — phase: **${phaseName}**`);

        if (wfType === "writing") {
          const style = str(wf["style"], "general");
          const currentPart = str(wf["current_part"], "");
          lines.push(`- Style: ${style}`);
          if (truthy(wf["current_part"] ?? "")) lines.push(`- Current part: ${currentPart}`);
          if (str(wf["lifecycle"], "") !== "shared-v1") lines.push("- Resume: incompatible legacy state; restart or manually align through `/writing`");
          else if (["human-review", "review", "human_review"].includes(phaseName)) lines.push("- Resume: reload the shared `beat-review` skill");
          else lines.push(["draft", "implement", "implementation", "verify", "verification", "revise", "revision"].includes(phaseName) ? "- Resume: `/writing-revise`" : "- Resume: `/writing`");
        } else if (wfType === "workshop") {
          if (str(wf["lifecycle"], "") !== "shared-v1") lines.push("- Resume: incompatible legacy state; restart or manually align through `/workshop`");
          else if (["human-review", "review", "human_review"].includes(phaseName)) lines.push("- Resume: reload the shared `beat-review` skill");
          else lines.push(["generate", "implement", "implementation", "verify", "verification", "revise", "revision"].includes(phaseName) ? "- Resume: `/workshop-revise`" : "- Resume: `/workshop`");
        } else if (wfType === "work") {
          lines.push("- State: `.planning/WORK.md`");
          lines.push("- Resume: `/work`");
        } else if (wfType === "dev" || wfType === "ds") {
          lines.push(`- Resume: \`/${wfType}\` or \`/${wfType}-debug\``);
        }

        lines.push("");
      }
    } catch {
      // pass
    }
  }

  // --- Approved native plan summary ---
  // PLAN.md is the exact ExitPlanMode hook copy. It is immutable, so never infer progress from checkboxes.
  const planPath = join(stateDir, "PLAN.md");
  if (existsSync(planPath)) {
    try {
      const content = readFileSync(planPath, "utf8");
      const summary = extractFirstHeadingAndSummary(content, 3);
      lines.push("### Approved native plan");
      if (summary) lines.push("```\n" + summary + "\n```");
      lines.push("- Progress is in TaskList; the copied plan is immutable.");
      lines.push(`- Full plan: \`${statePrefix}/PLAN.md\``);
      lines.push("");
    } catch {
      // pass
    }
  }

  lines.push("**Read the full state files before taking action.** Do not ask the user to summarize — the context is in the files.");
  lines.push("");

  return lines.join("\n");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildCalendarSection(): string {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);

  let output: string;
  try {
    const proc = Bun.spawnSync(
      [join(homedir(), ".local", "bin", "morgen-events"), "--start", isoDate(tomorrow), "--end", isoDate(dayAfter)],
      { stdout: "pipe", stderr: "pipe" },
    );
    output = new TextDecoder().decode(proc.stdout).trim();
  } catch {
    return "";
  }

  if (!output) return "";

  // strftime('%a %b %-d') — no zero padding on the day.
  const stamp = `${WEEKDAYS[tomorrow.getDay()]} ${MONTHS[tomorrow.getMonth()]} ${tomorrow.getDate()}`;
  const lines = [`## Tomorrow's Calendar (${stamp})`, ""];
  lines.push(output);
  lines.push("");
  return lines.join("\n");
}

function checkPendingPatterns(): string {
  const projectSlug = process.cwd().replaceAll("/", "-");
  const pendingFile = join(homedir(), ".claude", "projects", projectSlug, "pending-patterns.json");
  if (!existsSync(pendingFile)) return "";

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(pendingFile, "utf8"));
    unlinkSync(pendingFile); // Consume: one-shot
  } catch (e) {
    console.error(`Warning: Failed to read pending patterns: ${e}`);
    try {
      unlinkSync(pendingFile);
    } catch {
      // pass
    }
    return "";
  }

  const count = (data["correction_count"] as number) ?? 0;
  if (count < 2) return "";

  const samples = (data["samples"] as Array<Record<string, unknown>>) ?? [];
  const sampleLines: string[] = [];
  for (const s of samples.slice(0, 3)) {
    const text = String(s["text"] ?? "").slice(0, 100);
    sampleLines.push(`  - "${text}"`);
  }

  return `
[PATTERN CAPTURE SUGGESTION]

Previous session had ${count} user corrections detected. Samples:
${sampleLines.join("\n")}

Consider running \`/pattern-capture\` to classify these and create appropriate enforcement artifacts.
`;
}

async function main(): Promise<void> {
  try {
    parsePayload(await Bun.stdin.text());
  } catch {
    // session_id defaults to 'unknown' — never used downstream, kept for parity.
  }

  loadCentralSecrets();
  loadDotenvIfExists();

  const persistedVars = persistEnvVarsForBash();
  const envContext = getEnvironmentContext();

  const envSection = buildEnvSection(envContext, persistedVars);
  const usingSkills = loadUsingSkillsContent();
  const inProgressSection = buildInProgressSection();
  const patternSection = checkPendingPatterns();
  const calendarSection = buildCalendarSection();

  const combinedContext =
    envSection + "\n" + calendarSection + "\n" + inProgressSection + "\n" + patternSection + "\n" + usingSkills;

  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: combinedContext,
      },
    }),
  );
}

await main();
