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
    except Exception:
        pass


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
    """Gather environment context for Claude."""
    load_central_secrets()  # User-global keys first
    load_dotenv_if_exists()  # Project-local keys override

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


def get_skills_summary():
    """Return a summary of available skills."""
    return """# Available Workflow Skills

You have access to structured development and data science workflows.

## Development Workflows (/dev plugin)
- **dev** - Full development workflow (brainstorm → plan → implement → review → verify)
- **dev-brainstorm** - Socratic design exploration before implementation
- **dev-plan** - Codebase exploration and task breakdown
- **dev-implement** - TDD implementation with RED-GREEN-REFACTOR
- **dev-debug** - Systematic debugging with root cause investigation
- **dev-review** - Code review combining spec compliance and quality
- **dev-verify** - Verification gate requiring fresh runtime evidence
- **/dev:exit** - Exit dev mode and disable sandbox

## Data Science Workflows (/ds plugin)
- **ds** - Full data science workflow with output-first verification
- **ds-brainstorm** - Clarify analysis objectives through questioning
- **ds-plan** - Data profiling and analysis task breakdown
- **ds-implement** - Output-first implementation with verification
- **ds-review** - Methodology and statistical validity review
- **ds-verify** - Reproducibility verification before completion
- **/ds:exit** - Exit DS mode and disable sandbox

## Specialized Data Skills
- **marimo** - Marimo reactive Python notebooks
- **jupytext** - Jupyter notebooks as text files
- **gemini-batch** - Google Gemini Batch API for document processing
- **wrds** - WRDS PostgreSQL access (Compustat, CRSP, etc.)
- **lseg-data** - LSEG/Refinitiv market data

## How to Use
- Invoke skills with: Skill(skill="skill-name")
- Or use commands: /dev:start, /ds:start, /ds:marimo, etc.
- When invoking dev/ds workflow, sandbox mode activates (blocks main chat writes)
- Use /dev:exit or /ds:exit to deactivate sandbox

## When to Use Skills
- **Implementation tasks** → dev workflow
- **Bug fixes** → dev-debug
- **Data analysis** → ds workflow
- **Marimo notebooks** → marimo skill
- **WRDS data** → wrds skill

If the user's request matches a skill domain, invoke that skill.

## MANDATORY: Skill Check Before Responding

**STOP. Before answering ANY user question, ask yourself: "Does a skill apply?"**

If the user mentions marimo, jupyter, WRDS, LSEG, debugging, implementation, or data analysis:
1. IMMEDIATELY invoke the relevant skill using Skill(skill="skill-name")
2. THEN answer based on the skill's knowledge

This is NOT optional. Do NOT answer from training data when a skill exists.

Examples of WRONG behavior:
- User asks about marimo → You answer from memory ❌
- User asks about WRDS → You explain without invoking skill ❌

Examples of CORRECT behavior:
- User asks about marimo → Skill(skill="marimo") FIRST, then answer ✓
- User asks about debugging → Skill(skill="dev-debug") FIRST, then investigate ✓"""


def persist_env_vars_for_bash():
    """Persist environment variables to CLAUDE_ENV_FILE for bash commands.

    This makes variables from .env files and direnv available to subsequent
    bash commands in the Claude session.

    CLAUDE_ENV_FILE should be project-local (e.g., $CWD/.claude/env) for
    security isolation between projects.
    """
    claude_env_file = os.environ.get('CLAUDE_ENV_FILE')
    if not claude_env_file:
        return []

    # Load secrets: central first, then project-local (can override)
    load_central_secrets()
    load_dotenv_if_exists()

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
    except Exception:
        return []


def build_env_section(env_context: dict, persisted_vars: list) -> str:
    """Build environment context section - placed FIRST for visibility."""
    session_type = env_context.get('session_type', 'local')
    is_remote = session_type == 'remote (SSH)'

    lines = ["# Session Environment"]
    lines.append("")
    lines.append("**CHECK THIS FIRST** when answering questions about the environment.")
    lines.append("")

    # Session type - prominent for remote sessions
    if is_remote:
        lines.append(f"- **Session**: {session_type} ← YOU ARE ON A REMOTE MACHINE")
    else:
        lines.append(f"- **Session**: {session_type}")

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


def main():
    # Persist env vars for bash commands first
    persisted_vars = persist_env_vars_for_bash()

    # Get environment context for Claude's awareness
    env_context = get_environment_context()

    # Build sections: environment FIRST, then skills
    env_section = build_env_section(env_context, persisted_vars)
    skills_summary = get_skills_summary()

    # Output the context injection
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "context": env_section + "\n" + skills_summary
        }
    }))


if __name__ == '__main__':
    main()
