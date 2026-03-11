#!/usr/bin/env python3
"""
SessionStart hook: Inject environment context and skill guidance at session start.
Loads API keys, SSH status, sets CLAUDE_CODE_TASK_LIST_ID for project-scoped tasks.
"""
import json
import os
import sys
from pathlib import Path


def load_env_file(env_file: Path):
    """Load environment variables from a file."""
    if not env_file.exists():
        return
    try:
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
    except Exception as e:
        print(f"Warning: Failed to load {env_file}: {e}", file=sys.stderr)


def load_dotenv_if_exists():
    """Load .env file from current directory if it exists."""
    load_env_file(Path.cwd() / '.env')


def load_central_secrets():
    """Load user-global secrets from central location.

    Expected location: ~/.secrets/claude-keys.env

    This is for API keys that are user-global (not project-specific),
    e.g., Gemini API key, Readwise key, etc.

    Format: standard .env file (KEY=value, one per line)
    """
    central_secrets = Path.home() / '.secrets' / 'claude-keys.env'
    load_env_file(central_secrets)


def get_environment_context():
    """Gather environment context for Claude.

    NOTE: Assumes load_central_secrets() and load_dotenv_if_exists()
    have already been called to populate os.environ.
    """
    context = {}

    # SSH/Remote detection
    is_ssh = any(os.environ.get(v) for v in ['SSH_CLIENT', 'SSH_TTY', 'SSH_CONNECTION'])
    context['session_type'] = 'remote (SSH)' if is_ssh else 'local'
    if is_ssh:
        context['ssh_client'] = os.environ.get('SSH_CLIENT', '').split()[0] if os.environ.get('SSH_CLIENT') else None

    # API Keys (just note presence, don't expose full values)
    api_keys = {}
    key_vars = [
        'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
        'WRDS_USERNAME', 'WRDS_PASSWORD',
        'LSEG_APP_KEY', 'REFINITIV_APP_KEY',
        'HF_TOKEN', 'HUGGINGFACE_TOKEN',
        'GITHUB_TOKEN', 'GH_TOKEN',
    ]
    for key in key_vars:
        val = os.environ.get(key)
        if val:
            # Show first 4 and last 4 chars for identification
            if len(val) > 12:
                api_keys[key] = f"{val[:4]}...{val[-4:]}"
            else:
                api_keys[key] = "***set***"

    if api_keys:
        context['api_keys_available'] = api_keys

    # Working directory info
    context['cwd'] = os.getcwd()

    # Check for direnv
    if os.environ.get('DIRENV_DIR'):
        context['direnv_active'] = True

    # Check for pixi
    if Path('.pixi').exists() or os.environ.get('PIXI_PROJECT_MANIFEST'):
        context['pixi_project'] = True

    return context


def get_plugin_root() -> Path:
    """Get the plugin root directory."""
    # Script is at: hooks/session-start.py
    # Plugin root is: ./
    script_dir = Path(__file__).resolve().parent
    return script_dir.parent


def load_using_skills_content() -> str:
    """Load the using-skills meta-skill content.

    This teaches Claude HOW to use skills, not WHAT skills exist.
    The skill catalog is already in the Skill tool description.
    """
    skill_file = get_plugin_root() / 'lib' / 'skills' / 'using-skills' / 'SKILL.md'
    try:
        content = skill_file.read_text()
        # Substitute ${CLAUDE_PLUGIN_ROOT} since hook injects as raw text,
        # bypassing Claude Code's normal skill variable substitution
        plugin_root = str(get_plugin_root())
        content = content.replace('${CLAUDE_PLUGIN_ROOT}', plugin_root)
        return content
    except Exception as e:
        # Fallback if file not found
        print(f"Warning: Failed to load using-skills content: {e}", file=sys.stderr)
        return "Skills available. Use Skill(skill=\"name\") to invoke."


def persist_env_vars_for_bash():
    """Persist environment variables to CLAUDE_ENV_FILE for bash commands.

    This makes variables from .env files and direnv available to subsequent
    bash commands in the Claude session.

    CLAUDE_ENV_FILE should be project-local (e.g., $CWD/.claude/env) for
    security isolation between projects.

    NOTE: Assumes load_central_secrets() and load_dotenv_if_exists()
    have already been called to populate os.environ.
    """
    claude_env_file = os.environ.get('CLAUDE_ENV_FILE')
    if not claude_env_file:
        return []

    # List of variables to persist for bash commands
    vars_to_persist = [
        # Gemini/Google
        'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
        # OpenAI/Anthropic
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
        # Data services
        'WRDS_USERNAME', 'WRDS_PASSWORD',
        'LSEG_APP_KEY', 'REFINITIV_APP_KEY',
        # ML platforms
        'HF_TOKEN', 'HUGGINGFACE_TOKEN',
        # Git/GitHub
        'GITHUB_TOKEN', 'GH_TOKEN',
    ]

    persisted = []
    try:
        with open(claude_env_file, 'a') as f:
            for var in vars_to_persist:
                val = os.environ.get(var)
                if val:
                    # Escape single quotes in value
                    escaped_val = val.replace("'", "'\\''")
                    f.write(f"export {var}='{escaped_val}'\n")
                    persisted.append(var)
        return persisted
    except Exception as e:
        print(f"Warning: Failed to persist env vars to {claude_env_file}: {e}", file=sys.stderr)
        return []


def build_env_section(env_context: dict, persisted_vars: list) -> str:
    """Build environment context section - placed FIRST for visibility."""
    session_type = env_context.get('session_type', 'local')
    is_remote = session_type == 'remote (SSH)'

    lines = ["# Session Environment (USE THIS - DO NOT RUN COMMANDS TO CHECK)"]
    lines.append("")

    # Session type - make it extremely prominent
    if is_remote:
        lines.append("## ⚠️ REMOTE SESSION (SSH)")
        lines.append("")
        lines.append("You are connected to a **remote machine** via SSH.")
        lines.append("- GUI apps (VSCode, browsers, etc.) run on the REMOTE machine")
        lines.append("- File paths refer to the REMOTE filesystem")
        lines.append("- Do NOT suggest local machine solutions for remote problems")
    else:
        lines.append("## LOCAL SESSION")
        lines.append("")
        lines.append("You are running on the **local machine**.")
        lines.append("- Full GUI/Hyprland access available")
        lines.append("- File paths refer to local filesystem")

    lines.append("")

    # API keys
    if env_context.get('api_keys_available'):
        keys = ", ".join(env_context['api_keys_available'].keys())
        lines.append(f"- **API keys available**: {keys}")

    # Environment tools
    if env_context.get('direnv_active'):
        lines.append("- **direnv**: active")
    if env_context.get('pixi_project'):
        lines.append("- **pixi**: detected")

    # Persisted vars
    if persisted_vars:
        lines.append(f"- **Persisted for bash**: {', '.join(persisted_vars)}")

    lines.append("")
    return "\n".join(lines)


def get_project_task_list_id() -> str:
    """Generate a task list ID based on project directory.

    Uses the project directory name as the task list ID, enabling
    cross-session task persistence via CLAUDE_CODE_TASK_LIST_ID.

    See: https://code.claude.com/docs/en/interactive-mode
    """
    # Use current directory name as task list ID
    cwd = Path.cwd()
    return cwd.name


def check_plan_exists() -> str:
    """Check if PLAN.md exists and return continuation message."""
    plan_path = Path.cwd() / '.claude' / 'PLAN.md'
    if not plan_path.exists():
        return ""

    return """
[PLAN.md DETECTED]

An implementation plan exists at `.claude/PLAN.md`.
Read it to understand the current task state before continuing.
"""


def parse_yaml_simple(content: str) -> dict:
    """Simple YAML-like parser for ACTIVE_WORKFLOW.md frontmatter.

    Handles basic key: value pairs and simple lists.
    """
    result = {}
    lines = content.split('\n')
    in_frontmatter = False
    current_list_key = None

    for line in lines:
        stripped = line.strip()

        # Handle frontmatter delimiters
        if stripped == '---':
            if not in_frontmatter:
                in_frontmatter = True
                continue
            else:
                break  # End of frontmatter

        if not in_frontmatter:
            continue

        # Skip empty lines and comments
        if not stripped or stripped.startswith('#'):
            current_list_key = None
            continue

        # Handle list items
        if stripped.startswith('- ') and current_list_key:
            if current_list_key not in result:
                result[current_list_key] = []
            result[current_list_key].append(stripped[2:].strip().strip('"').strip("'"))
            continue

        # Handle key: value pairs
        if ':' in stripped:
            key, _, value = stripped.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            # Check if this starts a list (empty value or next line is -)
            if not value:
                current_list_key = key
                result[key] = []
            else:
                current_list_key = None
                result[key] = value

    return result


def check_active_workflow() -> str:
    """Check for active workflow and return context/instructions.

    Reads .claude/ACTIVE_WORKFLOW.md and returns appropriate context
    based on workflow type (dev, ds, or writing).
    """
    workflow_path = Path.cwd() / '.claude' / 'ACTIVE_WORKFLOW.md'
    if not workflow_path.exists():
        return ""

    try:
        content = workflow_path.read_text()
        workflow = parse_yaml_simple(content)
    except Exception as e:
        print(f"Warning: Failed to parse ACTIVE_WORKFLOW.md: {e}", file=sys.stderr)
        return ""

    workflow_type = workflow.get('workflow', '')
    if not workflow_type:
        return ""

    plugin_root = os.environ.get('CLAUDE_PLUGIN_ROOT', '') or str(get_plugin_root())

    if workflow_type == 'writing':
        style = workflow.get('style', 'general')
        phase = workflow.get('phase', 'draft')
        current_part = workflow.get('current_part', '')
        skill_stack = workflow.get('skill_stack', ['writing'])

        # Build skill read instructions (skills are now in lib/)
        skill_reads = []
        for skill in skill_stack:
            if plugin_root:
                skill_reads.append(f'Read("{plugin_root}/lib/skills/{skill}/SKILL.md")')
            else:
                skill_reads.append(f'Read the {skill} skill')

        part_info = f"\n   Current part: {current_part}" if current_part else ""

        return f"""
[ACTIVE WRITING WORKFLOW]

Style: {style}
Phase: {phase}{part_info}

Re-read the writing rules to stay on track:
{chr(10).join('- ' + r for r in skill_reads)}

Commands:
- /writing-revise - Apply review fixes, polish, and complete workflow
"""

    elif workflow_type in ('dev', 'ds'):
        phase_name = workflow.get('phase_name', 'unknown')
        active_skill = workflow.get('active_skill', '')

        # Build read instruction
        if active_skill:
            if '${CLAUDE_PLUGIN_ROOT}' in active_skill and plugin_root:
                active_skill = active_skill.replace('${CLAUDE_PLUGIN_ROOT}', plugin_root)
            read_instruction = f'Read("{active_skill}")'
        else:
            read_instruction = f'Read the {phase_name} phase skill'

        return f"""
[ACTIVE {workflow_type.upper()} WORKFLOW]

Phase: {phase_name}

Re-read the phase constraints:
- {read_instruction}

The workflow state is tracked in .claude/ACTIVE_WORKFLOW.md.
"""

    return ""


def main():
    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
        session_id = hook_input.get('sessionId', 'unknown')
    except (json.JSONDecodeError, KeyError):
        session_id = 'unknown'

    # Load environment variables once: central secrets first, project-local override
    load_central_secrets()
    load_dotenv_if_exists()

    # Persist env vars for bash commands
    persisted_vars = persist_env_vars_for_bash()

    # Get environment context for Claude's awareness
    env_context = get_environment_context()

    # Build sections: environment context + meta-skill about using skills
    env_section = build_env_section(env_context, persisted_vars)
    using_skills = load_using_skills_content()

    # Check for existing PLAN.md
    plan_section = check_plan_exists()

    # Check for active workflow (dev, ds, or writing)
    workflow_section = check_active_workflow()

    # Combine context
    combined_context = env_section + "\n" + workflow_section + "\n" + plan_section + "\n" + using_skills

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": combined_context
        }
    }))


if __name__ == '__main__':
    main()
