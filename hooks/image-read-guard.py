#!/usr/bin/env python3
"""
PreToolUse hook: Block Read tool on image files, redirect to look-at skill.

Reading images directly wastes context tokens. The look-at skill uses
Gemini to extract only relevant information, saving 80-95% of tokens.
"""

import json
import sys

IMAGE_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
    '.gif', '.bmp', '.tiff', '.tif', '.ico', '.svg'
}


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name != 'Read':
        sys.exit(0)

    file_path = tool_input.get('file_path', '').lower()
    if not file_path:
        sys.exit(0)

    # Check if it's an image file
    is_image = any(file_path.endswith(ext) for ext in IMAGE_EXTENSIONS)
    if not is_image:
        sys.exit(0)

    # Block and redirect to look-at
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "Use look-at skill instead of Read for images.\n\n"
                "Reading images directly wastes context tokens. "
                "Use the look-at skill to extract only relevant information:\n\n"
                "```bash\n"
                "python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \\\n"
                f'    --file "{tool_input.get("file_path", "")}" \\\n'
                '    --goal "Describe what is in this image"\n'
                "```\n\n"
                "Set Bash description to: look-at: [your goal]"
            )
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
