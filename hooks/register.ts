// The plugin's one hooks module: hooks.json `modules` takes a single path per plugin, so each mod
// exports a registrar and this file calls them in order.
import type { Register } from 'claude-code'
import { register as registerBulkGuard } from './bulk-guard.mjs'
import { registerWatcher } from './watch/watcher.ts'

export const register: Register = (on) => {
  registerBulkGuard(on)
  registerWatcher(on)
}
