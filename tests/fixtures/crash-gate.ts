#!/usr/bin/env bun
/**
 * A gate that installs `denyOnCrash` and then throws, so the handler itself is exercised.
 *
 * The real failure was NOT that one function indexed a prototype-bearing object. It was that a
 * throw ANYWHERE in a PreToolUse gate exits non-zero, and Claude Code treats a non-zero hook exit
 * as non-blocking — so every crash was a silent allow. Fixing only the one function that happened
 * to throw would leave the class open, which is why the handler has its own fixture rather than
 * being tested solely through the receipt that first tripped it.
 */
import { denyOnCrash } from "../../hooks/_gate_common.ts";

denyOnCrash("CRASH FIXTURE GATE");

if (process.argv.includes("--reject")) {
  // An unhandled rejection, which exits non-zero exactly like a synchronous throw.
  void Promise.reject(new Error("induced async fault"));
  await new Promise(resolve => setTimeout(resolve, 250));
} else {
  throw new TypeError("induced synchronous fault");
}
