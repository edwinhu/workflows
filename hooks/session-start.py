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
    skill_file = get_plugin_root() / 'skills' / 'using-skills' / 'SKILL.md'
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


def extract_plan_progress(content: str) -> dict:
    """Extract task progress from PLAN.md by counting checkboxes.

    Returns dict with completed, total, current_task (first unchecked), and
    a list of recent completed tasks for context.
    """
    completed = 0
    total = 0
    current_task = None
    recent_completed = []

    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('- [x]') or stripped.startswith('- [X]'):
            total += 1
            completed += 1
            # Keep last 2 completed for context
            task_text = stripped[5:].strip()
            recent_completed.append(task_text)
            recent_completed = recent_completed[-2:]
        elif stripped.startswith('- [ ]'):
            total += 1
            if current_task is None:
                current_task = stripped[5:].strip()

    return {
        'completed': completed,
        'total': total,
        'current_task': current_task,
        'recent_completed': recent_completed,
    }


def extract_first_heading_and_summary(content: str, max_lines: int = 5) -> str:
    """Extract the first heading and a few lines of content for a brief summary."""
    lines = content.split('\n')
    # Skip frontmatter
    in_frontmatter = False
    body_lines = []
    for line in lines:
        if line.strip() == '---':
            if not in_frontmatter:
                in_frontmatter = True
                continue
            else:
                in_frontmatter = False
                continue
        if in_frontmatter:
            continue
        body_lines.append(line)

    # Return first max_lines non-empty lines
    result = []
    for line in body_lines:
        if line.strip():
            result.append(line)
            if len(result) >= max_lines:
                break
    return '\n'.join(result)


def build_in_progress_section() -> str:
    """Build a consolidated in-progress work briefing from .planning/ state.

    Instead of separate thin notifications, this inlines enough context
    for Claude to orient immediately without extra tool calls.
    Inspired by GSD's approach: inline state into dispatch prompt.
    """
    # Discover all planning files
    planning_dir = Path.cwd() / '.planning'
    legacy_dir = Path.cwd() / '.claude'

    # Check which directory has state
    if planning_dir.exists() and any(planning_dir.iterdir()):
        state_dir = planning_dir
        state_prefix = '.planning'
    elif legacy_dir.exists() and (legacy_dir / 'PLAN.md').exists():
        state_dir = legacy_dir
        state_prefix = '.claude'
    else:
        return ""

    # Inventory: what state files exist?
    state_files = []
    key_files = ['PLAN.md', 'SPEC.md', 'ACTIVE_WORKFLOW.md', 'HANDOFF.md',
                 'PRECIS.md', 'OUTLINE.md', 'VALIDATION.md', 'REVIEW.md',
                 'REVIEW_STATE.md', 'PHASE_SUMMARY.md']
    for name in key_files:
        path = state_dir / name
        if path.exists():
            state_files.append(name)

    # Also check for subdirectories (outlines/, drafts/)
    subdirs = []
    for subdir_name in ['outlines', 'drafts']:
        subdir = state_dir / subdir_name
        if subdir.exists() and subdir.is_dir():
            files = list(subdir.glob('*.md'))
            if files:
                subdirs.append(f"{subdir_name}/ ({len(files)} files)")

    if not state_files and not subdirs:
        return ""

    lines = ["## IN-PROGRESS WORK DETECTED", ""]
    lines.append(f"State directory: `{state_prefix}/`")
    lines.append(f"Files: {', '.join(state_files)}")
    if subdirs:
        lines.append(f"Subdirs: {', '.join(subdirs)}")
    lines.append("")

    # --- Handoff (highest priority — explicit pause point) ---
    handoff_path = state_dir / 'HANDOFF.md'
    if handoff_path.exists():
        try:
            content = handoff_path.read_text()
            fm = parse_yaml_simple(content)
            phase_name = fm.get('phase_name', 'unknown')
            task = fm.get('task', '?')
            total_tasks = fm.get('total_tasks', '?')
            last_updated = fm.get('last_updated', 'unknown')

            # Extract Next Action section
            next_action = ""
            in_next = False
            for line in content.split('\n'):
                if line.strip().startswith('## Next Action'):
                    in_next = True
                    continue
                if in_next:
                    s = line.strip()
                    if s and not s.startswith('#'):
                        next_action = s
                        break

            lines.append("### Handoff from previous session")
            lines.append(f"- Phase: **{phase_name}** | Task {task}/{total_tasks} | Updated: {last_updated}")
            if next_action:
                lines.append(f"- Next action: {next_action}")
            lines.append(f"- Full context: `{state_prefix}/HANDOFF.md`")
            lines.append("")
        except Exception:
            pass

    # --- Active Workflow ---
    workflow_path = state_dir / 'ACTIVE_WORKFLOW.md'
    if workflow_path.exists():
        try:
            content = workflow_path.read_text()
            wf = parse_yaml_simple(content)
            wf_type = wf.get('workflow', '')
            phase_name = wf.get('phase_name', wf.get('phase', 'unknown'))

            if wf_type:
                lines.append(f"### Active workflow: **{wf_type}** — phase: **{phase_name}**")

                if wf_type == 'writing':
                    style = wf.get('style', 'general')
                    current_part = wf.get('current_part', '')
                    lines.append(f"- Style: {style}")
                    if current_part:
                        lines.append(f"- Current part: {current_part}")
                    lines.append("- Resume: `/writing-revise`")
                elif wf_type in ('dev', 'ds'):
                    lines.append(f"- Resume: `/{wf_type}` or `/{wf_type}-debug`")

                lines.append("")
        except Exception:
            pass

    # --- Plan progress ---
    plan_path = state_dir / 'PLAN.md'
    if plan_path.exists():
        try:
            content = plan_path.read_text()
            progress = extract_plan_progress(content)

            if progress['total'] > 0:
                pct = int(100 * progress['completed'] / progress['total'])
                lines.append(f"### Plan progress: {progress['completed']}/{progress['total']} tasks ({pct}%)")
                if progress['recent_completed']:
                    lines.append(f"- Last completed: {progress['recent_completed'][-1]}")
                if progress['current_task']:
                    lines.append(f"- **Next task: {progress['current_task']}**")
                else:
                    lines.append("- All tasks completed")
            else:
                # Plan exists but no checkboxes — show first few lines
                summary = extract_first_heading_and_summary(content, max_lines=3)
                lines.append("### Plan exists (no checkbox tasks)")
                if summary:
                    lines.append(f"```\n{summary}\n```")

            lines.append(f"- Full plan: `{state_prefix}/PLAN.md`")
            lines.append("")
        except Exception:
            pass

    # --- Spec summary ---
    spec_path = state_dir / 'SPEC.md'
    if spec_path.exists():
        try:
            content = spec_path.read_text()
            summary = extract_first_heading_and_summary(content, max_lines=3)
            if summary:
                lines.append("### Spec")
                lines.append(f"```\n{summary}\n```")
                lines.append(f"- Full spec: `{state_prefix}/SPEC.md`")
                lines.append("")
        except Exception:
            pass

    # --- Action guidance ---
    lines.append("**Read the full state files before taking action.** Do not ask the user to summarize — the context is in the files.")
    lines.append("")

    return "\n".join(lines)


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



def check_pending_patterns() -> str:
    """Check for pending pattern-capture suggestions from previous session.

    Reads ~/.claude/pending-patterns.json written by the SessionEnd
    pattern-scan hook. Deletes the file after reading (one-shot).
    """
    # Project-scoped: matches the path convention used by pattern-scan.py
    cwd = str(Path.cwd())
    project_slug = cwd.replace('/', '-')
    pending_file = Path.home() / '.claude' / 'projects' / project_slug / 'pending-patterns.json'
    if not pending_file.exists():
        return ""

    try:
        data = json.loads(pending_file.read_text())
        pending_file.unlink()  # Consume: one-shot
    except (json.JSONDecodeError, OSError) as e:
        print(f"Warning: Failed to read pending patterns: {e}", file=sys.stderr)
        try:
            pending_file.unlink()
        except OSError:
            pass
        return ""

    count = data.get('correction_count', 0)
    if count < 2:
        return ""

    samples = data.get('samples', [])
    sample_lines = []
    for s in samples[:3]:
        text = s.get('text', '')[:100]
        sample_lines.append(f'  - "{text}"')

    return f"""
[PATTERN CAPTURE SUGGESTION]

Previous session had {count} user corrections detected. Samples:
{chr(10).join(sample_lines)}

Consider running `/pattern-capture` to classify these and create appropriate enforcement artifacts.
"""


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

    # Check for in-progress work (.planning/ state files)
    # Consolidates plan, workflow, and handoff detection into one briefing
    in_progress_section = build_in_progress_section()

    # Check for pending pattern-capture suggestions from previous session
    pattern_section = check_pending_patterns()

    # Combine context
    combined_context = env_section + "\n" + in_progress_section + "\n" + pattern_section + "\n" + using_skills

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": combined_context
        }
    }))


if __name__ == '__main__':
    main()
