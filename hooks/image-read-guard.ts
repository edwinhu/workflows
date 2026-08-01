#!/usr/bin/env bun
/**
 * PreToolUse hook: Block Read tool on image files, redirect to look-at skill.
 *
 * Reading images directly wastes context tokens. The look-at skill uses
 * Gemini to extract only relevant information, saving 80-95% of tokens.
 *
 * PORT NOTE — the case trap: the Python lowercases `file_path` for the extension test but echoes the
 * ORIGINAL, un-lowered value back into the `--file` argument of the deny message. Reusing the
 * lowered string for both is the obvious port bug and is invisible until a `.PNG` payload arrives.
 */
import { resolve } from "node:path";
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("IMAGE READ GUARD");

const IMAGE_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif",
  ".gif", ".bmp", ".tiff", ".tif", ".ico", ".svg",
];

// A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ. The `catch { exit 0 }` here was
// Python parity, and it is precisely what `denyOnCrash` cannot reach: the handler covers
// throws that ESCAPE, and a local catch means none does. Measured — unparseable stdin, and
// for the raw-`JSON.parse` gates also `null`/`"s"`/`[1,2]`, produced exit 0 with no output,
// i.e. a silent ALLOW on every malformed payload. `parsePayload` denies on a non-object and
// lets a parse error propagate to the handler, which denies too.
const hookInput: Record<string, unknown> = parsePayload(await Bun.stdin.text());

const toolName = String(hookInput?.tool_name ?? "");
const toolInput = (hookInput?.tool_input ?? {}) as Record<string, unknown>;

if (toolName !== "Read") allow();

const rawFilePath = (toolInput.file_path ?? "") as string;
const filePath = rawFilePath.toLowerCase();
if (!filePath) allow();

if (!IMAGE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) allow();

// Block and redirect to look-at. plugin_root mirrors Path(__file__).resolve().parent.parent.
const pluginRoot = resolve(import.meta.dir, "..");
const lookAtScript = `${pluginRoot}/skills/look-at/scripts/look_at.py`;
deny(
  "Use look-at skill instead of Read for images.\n\n" +
    "Reading images directly wastes context tokens. " +
    "Use the look-at skill to extract only relevant information:\n\n" +
    "```bash\n" +
    `uv run --script ${lookAtScript} \\\n` +
    `    --file "${rawFilePath}" \\\n` +
    '    --goal "Describe what is in this image"\n' +
    "```\n\n" +
    "Set Bash description to: look-at: [your goal]",
);
