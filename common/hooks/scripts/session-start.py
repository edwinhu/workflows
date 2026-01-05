#!/usr/bin/env python3
"""
SessionStart hook: Inject awareness of dev/ds workflows at session start.
Also loads environment context (API keys, SSH status, etc.)
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
    # TODO: Implement when central secrets location is established
    # Candidate locations:
    #   ~/.secrets/claude-keys.env
    #   ~/.config/claude/secrets.env
    #   Use a secrets manager (1Password CLI, etc.)
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
    """Get the shared plugin root directory."""
    # Script is at: plugins/shared/hooks/scripts/session-start.py
    # Plugin root is: plugins/shared/
    script_dir = Path(__file__).resolve().parent
    return script_dir.parent.parent


def load_using_skills_content() -> str:
    """Load the using-skills meta-skill content.

    This teaches Claude HOW to use skills, not WHAT skills exist.
    The skill catalog is already in the Skill tool description.
    """
    skill_file = get_plugin_root() / 'skills' / 'using-skills' / 'SKILL.md'
    try:
        return skill_file.read_text()
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


def create_session_marker_dir():
    """Create the session marker directory for workflow state tracking."""
    session_dir = Path(f"/tmp/claude-workflow-{os.getppid()}")
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def main():
    # Read and discard stdin for consistency with hook best practices
    sys.stdin.read()

    # Create session marker directory (used by sandbox-check.py)
    create_session_marker_dir()

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

    # Output the context injection
    # Pattern inspired by obra/superpowers - inject HOW to use skills, not the full catalog
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": env_section + "\n" + using_skills
        }
    }))


if __name__ == '__main__':
    main()
