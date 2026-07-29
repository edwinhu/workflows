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
import { allow, deny, parsePayload } from "./_gate_common.ts";

const IMAGE_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif",
  ".gif", ".bmp", ".tiff", ".tif", ".ico", ".svg",
];

let hookInput: Record<string, unknown>;
try {
  hookInput = parsePayload(await Bun.stdin.text());
} catch {
  // Python: `except Exception: sys.exit(0)` around json.load — unparseable stdin is a silent allow.
  process.exit(0);
}

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
