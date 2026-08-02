#!/usr/bin/env bun
/**
 * Decide HOW a plan's implementation should be dispatched: inline, one subagent, several subagents,
 * or a generated workflow script.
 *
 * WHY THIS IS A DECISION AND NOT A DEFAULT
 *   beat-implement exists so implementation never runs in main chat — the orchestrator's context
 *   must hold the outcome, not the work. But "always generate a workflow" is the wrong reading of
 *   that. The Claude Code docs put it as a question of WHO HOLDS THE PLAN:
 *
 *     Subagents  — a worker Claude spawns; Claude decides what runs next, turn by turn;
 *                  intermediate results live in Claude's context window; a few tasks per turn.
 *     Workflows  — a script the runtime executes; THE SCRIPT decides what runs next;
 *                  intermediate results live in SCRIPT VARIABLES; dozens to hundreds of agents.
 *
 *   "A workflow moves the plan into code ... so Claude's context holds only the final answer."
 *   That sentence is the whole reason to prefer a workflow, and it is also the reason not to reach
 *   for one when there is nothing to hold: a single task dispatched to a single subagent already
 *   keeps its work out of main chat. Generating a script for it buys nothing and costs a runtime,
 *   an approval prompt, and a file to maintain.
 *
 * THRESHOLDS ARE THE DOCUMENTED ONES, NOT INVENTED
 *   Size guidelines: small = fewer than 5 agents, medium = fewer than 15, large = fewer than 50.
 *   Claude Code shows a "Large workflow" warning above 25 agents or 1.5M projected tokens.
 *   Runtime caps: 16 concurrent agents, 1000 total per run.
 *   Anything here that is NOT from the docs is marked as a judgement call with its reasoning.
 *
 * THE CONSTRAINT THAT DECIDES THE HARD CASES
 *   "No direct filesystem or shell access from the workflow itself. Agents read, write, and run
 *   commands. The script coordinates the agents." A generated workflow is therefore pure control
 *   flow BY CONSTRUCTION — every plan-specific value is baked in as a literal at generation time,
 *   and the generator (an ordinary script with full fs access) does the authentication, path
 *   resolution and hashing that the script may not do at runtime.
 */

export type RoutableTask = {
  id: string;
  dependsOn?: readonly string[];
  /** Rough size signal for context pressure; the generator supplies it from the plan row. */
  outputs?: readonly string[];
};

export type Route = "inline" | "single-subagent" | "subagents" | "workflow";

export type RoutingDecision = {
  route: Route;
  /** Agents the chosen shape will spawn, for the size guideline and the cost warning. */
  agentCount: number;
  /** Widest set of tasks with no unmet dependency on each other — the fan-out the plan admits. */
  maxParallelWidth: number;
  sizeGuideline: "small" | "medium" | "large" | "unrestricted";
  reason: string;
  /** Surfaced to the user before a large run, per the docs' 25-agent advisory threshold. */
  warnLarge: boolean;
};

/** Longest dependency chain; a plan that is one long chain cannot fan out no matter how many tasks. */
function waveWidths(tasks: readonly RoutableTask[]): number[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const done = new Set<string>();
  const widths: number[] = [];
  let remaining = tasks.slice();
  while (remaining.length) {
    const ready = remaining.filter(task => (task.dependsOn ?? []).every(id => done.has(id) || !byId.has(id)));
    // A dependency cycle leaves nothing ready. Report the remainder as one wave rather than looping
    // forever; the compiler rejects cycles upstream, and a router that hangs is worse than one that
    // over-estimates.
    if (!ready.length) { widths.push(remaining.length); break; }
    widths.push(ready.length);
    ready.forEach(task => done.add(task.id));
    remaining = remaining.filter(task => !done.has(task.id));
  }
  return widths;
}

export function routeImplementation(tasks: readonly RoutableTask[]): RoutingDecision {
  const count = tasks.length;
  const widths = waveWidths(tasks);
  const maxParallelWidth = widths.length ? Math.max(...widths) : 0;

  if (count === 0) {
    return { route: "inline", agentCount: 0, maxParallelWidth: 0, sizeGuideline: "small",
      reason: "The plan declares no implementation tasks; there is nothing to dispatch.", warnLarge: false };
  }

  // ONE TASK -> ONE SUBAGENT. The docs' distinction is where intermediate results live, and with a
  // single task there are no intermediates to keep out of context: the subagent's result IS the
  // final answer. A workflow here adds a runtime and an approval prompt to buy nothing.
  if (count === 1) {
    return { route: "single-subagent", agentCount: 1, maxParallelWidth: 1, sizeGuideline: "small",
      reason: "One task: a single subagent already keeps the work out of main chat, and there are no intermediate results for a script to hold.", warnLarge: false };
  }

  // JUDGEMENT CALL, not from the docs: a short strictly-sequential plan stays with subagents.
  // "Scale: a few delegated tasks per turn" is the documented subagent range, and a chain has no
  // fan-out for a script to coordinate — the script would be a for-loop whose only gain is keeping
  // <5 results out of context. The threshold matches the documented `small` guideline (<5 agents).
  if (count < 5 && maxParallelWidth === 1) {
    return { route: "subagents", agentCount: count, maxParallelWidth, sizeGuideline: "small",
      reason: `${count} strictly sequential tasks: within the documented "a few delegated tasks per turn" range for subagents, with no fan-out for a script to coordinate.`, warnLarge: false };
  }

  // EVERYTHING ELSE -> WORKFLOW. Either the plan fans out (the script coordinates what Claude would
  // otherwise sequence by hand), or it is long enough that its intermediate results become the
  // context problem beat-implement exists to prevent.
  const sizeGuideline = count < 5 ? "small" : count < 15 ? "medium" : count < 50 ? "large" : "unrestricted";
  const reason = maxParallelWidth > 1
    ? `${count} tasks with up to ${maxParallelWidth} runnable in parallel: the script holds the fan-out and the intermediate results, so main chat receives only the outcome.`
    : `${count} tasks: long enough that per-task results in the orchestrator's context are the problem, which is exactly what moving the plan into a script solves.`;
  return {
    route: "workflow",
    agentCount: count,
    maxParallelWidth,
    sizeGuideline,
    reason,
    // Advisory only, matching Claude Code's own behaviour: it warns, it does not cap.
    warnLarge: count > 25,
  };
}

if (import.meta.main) {
  const raw = await new Response(Bun.stdin.stream()).text();
  const tasks = JSON.parse(raw) as RoutableTask[];
  console.log(JSON.stringify(routeImplementation(tasks), null, 2));
}
