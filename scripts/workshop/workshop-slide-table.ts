#!/usr/bin/env bun
import { buildIndex } from "../../hooks/_workshop_slide_table.ts";

const argv = Bun.argv.slice(2);
const json = argv.includes("--json");
const target = argv.find(value => value !== "--json");
if (!target) {
  console.error("usage: bun scripts/workshop/workshop-slide-table.ts <project-root> [--json]");
  process.exit(2);
}
const index = buildIndex(target);
if (json) {
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
} else {
  for (const violation of index.violations) console.error(`ERROR: ${violation}`);
  console.log(`${index.slides.length} slides; ${index.sectionOrder.length} sections; form=${index.form}; plan=${index.planFile}; hash=${index.planHash}`);
}
process.exit(index.violations.length ? 1 : 0);
