#!/usr/bin/env bun
/**
 * PreToolUse hook: Block reading large files without limits.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";

denyOnCrash("READ GUARD");

const hookInput = parsePayload(await Bun.stdin.text());
const toolName = String(hookInput?.tool_name ?? "");
const toolInput = (hookInput?.tool_input ?? {}) as Record<string, unknown>;

const READ_GUARD_BYTES = parseInt(process.env.READ_GUARD_BYTES ?? "262144", 10);
if (READ_GUARD_BYTES === 0) allow();

function checkFileSize(filePath: string): number {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

if (toolName === "Read") {
  const filePath = (toolInput.file_path ?? "") as string;
  if (!filePath) allow();

  const hasOffset = "offset" in toolInput && toolInput.offset !== null && toolInput.offset !== undefined;
  const hasLimit = "limit" in toolInput && toolInput.limit !== null && toolInput.limit !== undefined;

  if (!hasOffset && !hasLimit) {
    const size = checkFileSize(filePath);
    if (size > READ_GUARD_BYTES) {
      deny(
        `File size (${size} bytes) exceeds READ_GUARD_BYTES (${READ_GUARD_BYTES}).\n\n` +
        `Dumping this whole file will blow out your context budget.\n` +
        `Alternatives:\n` +
        `- Use Read with offset and limit parameters\n` +
        `- Use \`rg -n <pattern> ${filePath}\` to locate what you need first\n` +
        `- Use \`sed -n 'A,Bp' ${filePath}\` to read a specific range of lines`
      );
    }
  }
  allow();
}

if (toolName === "Bash") {
  const command = (toolInput.command ?? "") as string;
  if (!command) allow();

  // Very simplistic check: look for "cat F", "less F", "more F"
  // For Python: "python -c 'open(F).read()'"
  // We need to extract the files from these commands.
  
  // Wait, the prompt says:
  // "A command already bounded — head -n N with N <= 2000, sed -n 'A,Bp' with a range of 2000 lines or fewer, rg, grep -c, wc, jq with a filter, or a pipe into one of these — ALLOWS. Keep the Bash parsing conservative. A missed dump is acceptable; blocking a legitimate bounded command is not."

  const isBounded = (cmd: string) => {
    // Pipeline components
    const parts = cmd.split('|').map(p => p.trim());
    const lastPart = parts[parts.length - 1];

    if (/\brg\b/.test(cmd)) return true;
    if (/\bgrep\s+-c\b/.test(cmd)) return true;
    if (/\bwc\b/.test(cmd)) return true;
    if (/\bjq\b.*\'.+\'/.test(cmd)) return true; // jq with a filter
    if (/\bjq\b.*\".+\"/.test(cmd)) return true; // jq with a filter
    if (/\bjq\s+\./.test(cmd)) return false; // jq . dumps everything

    const headMatch = cmd.match(/\bhead\s+-n\s+(\d+)/);
    if (headMatch) {
      if (parseInt(headMatch[1], 10) <= 2000) return true;
    }
    const headNMatch = cmd.match(/\bhead\s+-(\d+)/);
    if (headNMatch) {
      if (parseInt(headNMatch[1], 10) <= 2000) return true;
    }
    const sedMatch = cmd.match(/\bsed\s+-n\s+[\'\"]?(\d+),(\d+)p/);
    if (sedMatch) {
      if (parseInt(sedMatch[2], 10) - parseInt(sedMatch[1], 10) <= 2000) return true;
    }
    return false;
  };

  if (isBounded(command)) allow();

  // Detect dumps
  // Extract files from cat, less, more
  const extractDumpFile = (cmd: string): string | null => {
    const m1 = cmd.match(/\b(?:cat|less|more)\s+([^\s\|&;]+)/);
    if (m1 && !m1[1].startsWith('-')) {
       // remove quotes
       return m1[1].replace(/['"]/g, '');
    }
    const m2 = cmd.match(/\b(?:head|tail)\s+-c\s+(\d+)\s+([^\s\|&;]+)/);
    if (m2 && parseInt(m2[1], 10) > READ_GUARD_BYTES && !m2[2].startsWith('-')) {
       return m2[2].replace(/['"]/g, '');
    }
    const m3 = cmd.match(/\bpython\s+-c\s+.*open\(['"]([^'"]+)['"]\)\.read\(\)/);
    if (m3) {
       return m3[1];
    }
    return null;
  };

  const dumpedFile = extractDumpFile(command);
  if (dumpedFile) {
    const size = checkFileSize(dumpedFile);
    if (size > READ_GUARD_BYTES) {
      deny(
        `Command attempts to dump file ${dumpedFile} (${size} bytes) which exceeds READ_GUARD_BYTES (${READ_GUARD_BYTES}).\n\n` +
        `Dumping this whole file will blow out your context budget.\n` +
        `Alternatives:\n` +
        `- Use Read with offset and limit parameters\n` +
        `- Use \`rg -n <pattern> ${dumpedFile}\` to locate what you need first\n` +
        `- Use \`sed -n 'A,Bp' ${dumpedFile}\` to read a specific range of lines`
      );
    }
  }

  allow();
}

allow();
