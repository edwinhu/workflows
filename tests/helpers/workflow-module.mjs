// Loads a `workflows/*.js` orchestrator script as a REAL ES module.
//
// WHY THIS EXISTS
//   These suites used to build the script with `new AsyncFunction(...)`. An AsyncFunction body is
//   not a module, so `import.meta.url` is a hard SyntaxError there and every `new URL('./lib/x.ts',
//   import.meta.url).href` specifier had to be string-replaced with an absolute path before the
//   source would even parse. That rewriting is what let a script that could never load in the real
//   Workflow runtime stay green: the test built an environment where the broken code works.
//
//   Here the source is written VERBATIM to a temporary `.mjs` file inside `workflows/`, so its
//   relative `./lib/*.ts` specifiers and its `import.meta.url` resolve exactly as they do on disk.
//   No specifier, identifier, or literal in the script is rewritten.
//
// THE ONE STRUCTURAL ADAPTATION, AND WHY IT IS NOT A REWRITE
//   A workflow script is neither a module nor a plain function body: it opens with a module-scope
//   `export const meta = {...}` and CLOSES with a top-level `return`. `export` is illegal inside a
//   function; top-level `return` is illegal at module scope. So the file is SPLIT at the end of the
//   meta block — the header stays at module scope verbatim, the executable body is wrapped verbatim
//   in an async IIFE whose completion value is re-exported. Both halves are byte-identical to the
//   source; only a prologue and an epilogue are added around them.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const WORKFLOWS = new URL('../../workflows/', import.meta.url).pathname
// Non-greedy to the first column-0 `}` line: the meta object's nested `phases: [{...}]` entries
// close with `},` and never with a bare `\n}\n`.
const META_HEADER = /^export const meta = \{[\s\S]*?\n\}\n/
let counter = 0

/**
 * Execute a workflow script's source as an ES module and return its top-level `return` value.
 * `bindings` supplies the runtime primitives the script closes over (agent, parallel, log, phase,
 * args, ...); each key becomes a `const` in the module's scope.
 */
export async function runWorkflowModule(source, bindings) {
  const header = META_HEADER.exec(source)
  if (!header) throw new Error('workflow script does not open with an `export const meta = {...}` block')
  const body = source.slice(header[0].length)
  const id = `${process.pid}-${++counter}`
  const key = `__workflowModuleHandoff_${id}`
  const names = Object.keys(bindings)
  // Dot-prefixed so no `workflows/*.js` glob (including the purity scanner's) can see it.
  const file = join(WORKFLOWS, `.tmp-workflow-module-${id}.mjs`)
  globalThis[key] = bindings
  writeFileSync(file, `${header[0]}const { ${names.join(', ')} } = globalThis[${JSON.stringify(key)}]
export const result = await (async () => {${body}
})()
`)
  try {
    const module = await import(`${pathToFileURL(file).href}?v=${id}`)
    return module.result
  } finally {
    rmSync(file, { force: true })
    delete globalThis[key]
  }
}
