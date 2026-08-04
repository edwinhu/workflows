/**
 * The adapter registry — the ONLY place a provider is named.
 *
 * `third-party-review.ts` resolves through this by the opaque token the approved plan carries, and a
 * test asserts on that file's source that it contains no provider literal. That separation is not
 * tidiness: it is what makes the claim "the beat never names a provider" checkable instead of
 * asserted. Adding a third adapter is a new file plus one line here, and touches nothing else.
 */
import type { Adapter } from "../third-party-review.ts";
import { codexAdapter } from "./codex.ts";
import { geminiAdapter } from "./gemini.ts";
import { proseCodexAdapter, proseGeminiAdapter } from "./prose.ts";

const ADAPTERS: Record<string, Adapter> = {
  [codexAdapter.name]: codexAdapter,
  [geminiAdapter.name]: geminiAdapter,
  // Prose adapters are separate entries, not a mode of the code ones: a plan naming
  // "codex" for a draft should fail loudly rather than review a diff.
  [proseCodexAdapter.name]: proseCodexAdapter,
  [proseGeminiAdapter.name]: proseGeminiAdapter,
};

export function resolveAdapter(name: string): Adapter | undefined {
  return Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : undefined;
}

export function adapterNames(): string[] {
  return Object.keys(ADAPTERS).sort();
}
