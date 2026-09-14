/**
 * gemini-models — the one place a Gemini model id is chosen (TypeScript half).
 *
 * Mirrors `scripts/lib/gemini_models.py` and reads the SAME `gemini-models.json`, so the two
 * languages cannot drift. Call sites pass a ROLE, never an id:
 *
 *     bulk       cheap high-volume batch / per-item work
 *     judgment   reasoning where accuracy matters
 *     pro        the few sites that need a pro model
 *     vision     multimodal extraction from one file
 *
 * Resolution order, highest wins:
 *   1. `override`            — the script's --model flag
 *   2. $GEMINI_MODEL         — global sweep override; pins EVERY role at once
 *   3. $GEMINI_MODEL_<ROLE>  — e.g. GEMINI_MODEL_JUDGMENT
 *   4. the role's constant in gemini-models.json
 *
 * Because 2 and 3 move every call site without a code edit, the resolved id must be stamped
 * into whatever the caller writes. See `stamp()`.
 */
import table from "./gemini-models.json" with { type: "json" };

export type GeminiRole = "bulk" | "judgment" | "pro" | "vision";

export const ROLE_MODELS: Record<GeminiRole, string> = table.roles as Record<
  GeminiRole,
  string
>;

export const ROLES = Object.keys(ROLE_MODELS).sort() as GeminiRole[];

/**
 * Return the Gemini model id for `role`. Throws on an unknown role rather than falling back to
 * a default — a typo'd role would otherwise bill at a tier the caller never asked for.
 */
export function resolveModel(role: GeminiRole, override?: string): string {
  if (override) return override;
  const sweep = process.env.GEMINI_MODEL;
  if (sweep) return sweep;
  const perRole = process.env[`GEMINI_MODEL_${role.toUpperCase()}`];
  if (perRole) return perRole;
  const model = ROLE_MODELS[role];
  if (!model) {
    throw new Error(
      `unknown Gemini role ${JSON.stringify(role)}; known roles: ${ROLES.join(", ")}`,
    );
  }
  return model;
}

/** The metadata fragment every Gemini-produced artifact must carry. */
export function stamp(model: string): { model: string } {
  return { model };
}
