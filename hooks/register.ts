// The plugin's one hooks module: hooks.json `modules` takes a single path per plugin, so each mod
// exports a registrar and this file calls them in order.
import type { Register } from 'claude-code'
import { register as registerBulkGuard } from './bulk-guard.mjs'
import { registerGuards } from './guards/mod.ts'
import { registerJevForecast } from './jev/forecast-mod.ts'
import { registerJevEdit } from './jev/mod.ts'
import { registerWatcher } from './watch/watcher.ts'

export const register: Register = (on) => {
  // First, so outermost: its AbovePrompt band stacks on bulk-guard's rather than being hidden by it.
  registerJevForecast(on)
  registerBulkGuard(on)
  registerWatcher(on)
  // Above the guards: an edit they deny never reaches it.
  registerJevEdit(on)
  // Last, so innermost: the guards sit where the hooks.json settings hooks they replace ran.
  registerGuards(on)
}
