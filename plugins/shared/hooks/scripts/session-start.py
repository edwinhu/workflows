#!/usr/bin/env python3
"""
SessionStart hook: Inject awareness of dev/ds workflows at session start.
Also loads environment context (API keys, SSH status, etc.)
"""
import json
import os
import sys
from pathlib import Path


def load_dotenv_if_exists():
    """Load .env file from current directory if it exists."""
    env_file = Path.cwd() / '.env'
    if env_file.exists():
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


def get_environment_context():
    """Gather environment context for Claude."""
    load_dotenv_if_exists()

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
    """
    claude_env_file = os.environ.get('CLAUDE_ENV_FILE')
    if not claude_env_file:
        return []

    # Load .env if present
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


def main():
    # Persist env vars for bash commands first
    persisted_vars = persist_env_vars_for_bash()

    # Get environment context for Claude's awareness
    env_context = get_environment_context()

    # Build the full context
    skills_summary = get_skills_summary()

    # Add environment section if we have context
    env_section = ""
    if env_context.get('api_keys_available') or env_context.get('session_type') == 'remote (SSH)':
        env_section = "\n\n## Environment Context\n"
        env_section += f"- Session: {env_context.get('session_type', 'local')}\n"
        if env_context.get('api_keys_available'):
            env_section += "- Available API keys: " + ", ".join(env_context['api_keys_available'].keys()) + "\n"
        if env_context.get('direnv_active'):
            env_section += "- direnv: active\n"
        if env_context.get('pixi_project'):
            env_section += "- pixi: detected\n"
        if persisted_vars:
            env_section += f"- Persisted for bash: {', '.join(persisted_vars)}\n"

    # Output the context injection
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "context": skills_summary + env_section
        }
    }))


if __name__ == '__main__':
    main()
