// PreToolUse(Read): block Read on image files and redirect to the look-at skill.
//
// The case trap: the extension test lowercases `file_path`, but the deny echoes the ORIGINAL value
// into `--file`. Reusing the lowered string is invisible until a `.PNG` payload arrives.
import type { Guard } from './core.ts'

const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.gif', '.bmp', '.tiff', '.tif', '.ico', '.svg',
]

export const imageReadGuard: Guard = async (payload, io) => {
  const toolName = String(payload?.tool_name ?? '')
  const toolInput = (payload?.tool_input ?? {}) as Record<string, unknown>
  if (toolName !== 'Read') return {}

  // look_at.sh sets this in the child it spawns. That child's whole job is to Read the image, and
  // denying it would point it back at look_at.sh, which spawns another child: unbounded recursion.
  if (io.env('LOOK_AT_NESTED')) return {}

  const rawFilePath = (toolInput.file_path ?? '') as string
  const filePath = rawFilePath.toLowerCase()
  if (!filePath) return {}
  if (!IMAGE_EXTENSIONS.some(ext => filePath.endsWith(ext))) return {}

  const lookAtScript = `${io.pluginRoot}/skills/look-at/scripts/look_at.sh`
  return {
    deny:
      'Use look-at skill instead of Read for images.\n\n' +
      'Reading images directly wastes context tokens. ' +
      'Use the look-at skill to extract only relevant information:\n\n' +
      '```bash\n' +
      `${lookAtScript} \\\n` +
      `    --file "${rawFilePath}" \\\n` +
      '    --goal "Describe what is in this image"\n' +
      '```\n\n' +
      'Set Bash description to: look-at: [your goal]',
  }
}
