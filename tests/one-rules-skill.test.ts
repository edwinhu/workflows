import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { frontmatterData } from "../skills/workflow-creator/scripts/wc-probe.ts";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const fm = (path: string) => frontmatterData(readFileSync(path, "utf8")) ?? {};

// Each persona that loads rules names ONE rules skill R, identically in `skills: [R]` (subagent
// launch) and `initialPrompt: /R` (main-thread launch), and R is user-invocable.
describe("user-agents name one rules skill", () => {
  const agents = readdirSync(join(ROOT, "user-agents"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f.replace(/\.md$/, ""), data: fm(join(ROOT, "user-agents", f)) }))
    .filter((a) => a.data.skills !== undefined || a.data.initialPrompt !== undefined);

  test("the roster is not empty", () => expect(agents.length).toBeGreaterThan(0));

  for (const { name, data } of agents) {
    const ip = typeof data.initialPrompt === "string" ? data.initialPrompt.trim() : "";
    const cmd = /^\/(\S+)$/.exec(ip)?.[1];
    test(`${name}: skills: is exactly [initialPrompt skill]`, () => {
      expect(cmd, `initialPrompt "${ip}" must be one bare /<skill>`).toBeDefined();
      expect(data.skills).toEqual([cmd!]);
    });
    test(`${name}: the initialPrompt skill is user-invocable`, () => {
      if (!cmd || cmd.includes(":")) {
        console.log(`NOT CHECKED: ${name} -> /${cmd} lives outside this repo`);
        return;
      }
      const file = join(ROOT, "skills", cmd, "SKILL.md");
      expect(existsSync(file), `${file} missing`).toBe(true);
      const s = fm(file);
      expect(s["user-invocable"]).not.toBe(false);
      expect(s["disable-model-invocation"]).not.toBe(true);
    });
  }
});

describe("every rules skill is user-invocable", () => {
  const rules = readdirSync(join(ROOT, "skills")).filter((d) => /(^|-)rules($|-)/.test(d) && existsSync(join(ROOT, "skills", d, "SKILL.md")));
  for (const d of rules) {
    test(d, () => {
      const s = fm(join(ROOT, "skills", d, "SKILL.md"));
      expect(s["user-invocable"]).not.toBe(false);
      expect(s["disable-model-invocation"]).not.toBe(true);
    });
  }
});
