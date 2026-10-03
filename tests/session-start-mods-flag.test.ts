/**
 * Claude Code 2.1.287 skips every installed plugin's mod when its `tengu_plugin_hooks_modules` rollout
 * switch is served off from a stale disk cache — the guards, bulk-guard, per-edit Jev and the farm
 * watcher all go dark while the settings hooks keep running. session-start says so loudly.
 *
 * The evidence is the watcher's beacon, not the cache: in a Herdr pane started with the cached switch
 * forced false (2026-10-02), the payload rewrote the cache to true 0.11 s after the decision, and the
 * hook read true. A cache read alone stays silent in exactly the failure it exists for.
 *
 * Run: bun test tests/session-start-mods-flag.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildModsSection, cachedModsFlag, interactiveSession, MODS_FLAG, MODS_REMEDY, MODS_STARTUP_WINDOW_MS,
  waitForBeacon, type ModsProbe,
} from "../hooks/session-start.ts";
import { BEACON } from "../hooks/watch/runs.ts";

const HOOK = join(import.meta.dir, "..", "hooks", "session-start.ts");
const TMP = mkdtempSync(join(tmpdir(), "mods-flag-test-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const HEADER = "WORKFLOWS PLUGIN MODS DID NOT LOAD";

/** A freshly started interactive 2.1.287 session; override what the case is about. */
function probe(over: Partial<ModsProbe> = {}): ModsProbe {
  return { interactive: true, version: "2.1.287 (Claude Code)", processAgeMs: 1500, flag: false, beacon: () => false, ...over };
}

describe("buildModsSection", () => {
  test("cached switch false and no beacon: the loud block names the cause, what is off, and the remedy", () => {
    const out = buildModsSection(probe({ flag: false }));
    expect(out.startsWith(`## ⚠ ${HEADER}`)).toBe(true);
    expect(out).toContain(`\`${MODS_FLAG}\` reads **false**`);
    for (const off of ["read-guard", "bulk-guard", "per-edit Jev", "farm watcher", "NO wake"]) expect(out).toContain(off);
    expect(out).toContain(`Remedy: ${MODS_REMEDY}`);
  });

  test("cached switch true and a beacon from this process: silent", () => {
    expect(buildModsSection(probe({ flag: true, beacon: () => true }))).toBe("");
  });

  test("cached switch false but the watcher did write a beacon: the mods loaded, silent", () => {
    expect(buildModsSection(probe({ flag: false, beacon: () => true }))).toBe("");
  });

  test("cached switch true and NO beacon (the payload rewrote the cache after the decision): loud", () => {
    const out = buildModsSection(probe({ flag: true }));
    expect(out).toContain(HEADER);
    expect(out).toContain("reads true now");
    expect(out).toContain("does not show what the process decided");
  });

  test("headless or a farm child: silent, and the beacon is never waited on", () => {
    let waited = false;
    const out = buildModsSection(probe({ interactive: false, beacon: () => (waited = true) }));
    expect(out).toBe("");
    expect(waited).toBe(false);
  });

  test("no Claude Code parent (a test or a hand run), or a process past its startup: silent without waiting", () => {
    for (const processAgeMs of [null, MODS_STARTUP_WINDOW_MS + 1]) {
      let waited = false;
      expect(buildModsSection(probe({ processAgeMs, beacon: () => (waited = true) }))).toBe("");
      expect(waited).toBe(false);
    }
  });

  test("below the floor or an unreadable version: silent (the version section owns the first)", () => {
    for (const version of ["2.1.280 (Claude Code)", "", "garbage"]) expect(buildModsSection(probe({ version }))).toBe("");
  });
});

describe("interactiveSession", () => {
  test("cli is attended; -p (sdk-cli), the SDKs and a farm child are not", () => {
    expect(interactiveSession({ CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe(true);
    for (const e of ["sdk-cli", "sdk-ts", "sdk-py", "mcp"]) expect(interactiveSession({ CLAUDE_CODE_ENTRYPOINT: e })).toBe(false);
    expect(interactiveSession({ CLAUDE_CODE_ENTRYPOINT: "cli", FARM_OUT_CHILD: "1" })).toBe(false);
  });
});

describe("cachedModsFlag", () => {
  /** A config dir whose .claude.json holds `body`. */
  function configDir(name: string, body: string): string {
    const dir = join(TMP, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".claude.json"), body);
    return dir;
  }

  test("reads the switch from CLAUDE_CONFIG_DIR/.claude.json, the file Claude Code itself uses", () => {
    const off = configDir("off", JSON.stringify({ cachedGrowthBookFeatures: { [MODS_FLAG]: false } }));
    const on = configDir("on", JSON.stringify({ cachedGrowthBookFeatures: { [MODS_FLAG]: true } }));
    expect(cachedModsFlag({ CLAUDE_CONFIG_DIR: off })).toBe(false);
    expect(cachedModsFlag({ CLAUDE_CONFIG_DIR: on })).toBe(true);
  });

  test("absent, non-boolean, unparseable or missing: undefined, never a throw", () => {
    const none = configDir("none", JSON.stringify({ cachedGrowthBookFeatures: {} }));
    const str = configDir("str", JSON.stringify({ cachedGrowthBookFeatures: { [MODS_FLAG]: "false" } }));
    const bad = configDir("bad", "{ not json");
    for (const dir of [none, str, bad, join(TMP, "missing")]) expect(cachedModsFlag({ CLAUDE_CONFIG_DIR: dir })).toBeUndefined();
  });
});

describe("waitForBeacon", () => {
  function beaconAt(root: string, session: string, mtimeMs?: number): void {
    const dir = join(root, "farm-events", session);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BEACON), String(Math.floor(Date.now() / 1000)));
    if (mtimeMs !== undefined) utimesSync(join(dir, BEACON), mtimeMs / 1000, mtimeMs / 1000);
  }

  test("a beacon written since the process started counts", () => {
    const root = join(TMP, "fresh");
    beaconAt(root, "s1");
    expect(waitForBeacon("s1", Date.now() - 2000, 0, [root])).toBe(true);
  });

  test("a beacon older than the process (an earlier process on a resumed id) does not", () => {
    const root = join(TMP, "old");
    beaconAt(root, "s2", Date.now() - 30_000);
    expect(waitForBeacon("s2", Date.now() - 2000, 300, [root])).toBe(false);
  });

  test("a beacon that lands while the hook waits counts — it arrives ~50 ms after the hook would return", () => {
    const root = join(TMP, "late");
    const file = join(root, "farm-events", "s3", BEACON);
    mkdirSync(join(root, "farm-events", "s3"), { recursive: true });
    const writer = Bun.spawn(["sh", "-c", `sleep 0.4; echo 1 > '${file}'`]);
    const t0 = Date.now();
    expect(waitForBeacon("s3", t0 - 1000, 3000, [root])).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2500);
    writer.kill();
  });

  test("no beacon at all: false once the wait runs out", () => {
    const t0 = Date.now();
    expect(waitForBeacon("nobody", t0, 300, [join(TMP, "empty")])).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
  });
});

describe("session-start hook", () => {
  /** Run the hook as a test runner does: its parent is bun, not Claude Code. */
  function runHook(env: Record<string, string>): { out: any; ms: number; stderr: string } {
    const t0 = Date.now();
    const r = Bun.spawnSync(["bun", HOOK], {
      timeout: 120_000,
      cwd: TMP,
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "mods-t", hook_event_name: "SessionStart", source: "startup" })),
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    return { out: JSON.parse(new TextDecoder().decode(r.stdout)), ms: Date.now() - t0, stderr: new TextDecoder().decode(r.stderr) };
  }

  const off = join(TMP, "hook-off");
  mkdirSync(off, { recursive: true });
  writeFileSync(join(off, ".claude.json"), JSON.stringify({ cachedGrowthBookFeatures: { [MODS_FLAG]: false } }));

  test("headless (-p runs as sdk-cli) or a farm child, cached switch false: silent", () => {
    for (const env of [
      { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CONFIG_DIR: off },
      { CLAUDE_CODE_ENTRYPOINT: "cli", FARM_OUT_CHILD: "1", CLAUDE_CONFIG_DIR: off },
    ]) {
      const { out, stderr } = runHook(env);
      expect(out.systemMessage).toBeUndefined();
      expect(out.hookSpecificOutput.additionalContext).not.toContain(HEADER);
      expect(stderr).not.toContain(HEADER);
    }
  });

  test("interactive but not spawned by Claude Code (tests, goldens, a hand run): silent and no wait", () => {
    const { out, ms } = runHook({ CLAUDE_CODE_ENTRYPOINT: "cli", FARM_OUT_CHILD: "", CLAUDE_CONFIG_DIR: off });
    expect(out.hookSpecificOutput.additionalContext).not.toContain(HEADER);
    expect(ms).toBeLessThan(4000);
  });
});
