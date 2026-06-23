"""Subprocess wrappers for the two local model CLIs used in elicitation.

  copilot -p "<prompt>" --allow-all-tools   → GitHub Copilot (GPT family)
  agy -p "<prompt>"                          → Antigravity (Gemini family)

Both are best-effort: they can rate-limit, time out, or print UI chrome around
the answer. `run_model` returns a ModelResult with cleaned text and never
raises — callers inspect `.ok` / `.error`. copilot appends an ANSI-colored
footer ("Changes / AI Credits / Tokens"); `_clean` strips ANSI and that footer.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass

# Models are referenced by short id everywhere (cache paths, tallies).
MODELS = ("copilot", "gemini")

_CMD = {
    "copilot": lambda prompt: ["copilot", "-p", prompt, "--allow-all-tools"],
    "gemini": lambda prompt: ["agy", "-p", prompt],
}

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
# copilot footer lines emitted after the answer (post ANSI strip).
_FOOTER_RE = re.compile(r"^\s*(Changes|AI Credits|Tokens)\b")
# Shell-reset noise some wrappers echo on the last line.
_RESET_RE = re.compile(r"^Shell cwd was reset")


def _clean(raw: str) -> str:
    """Strip ANSI codes and trailing CLI chrome, return the answer text."""
    text = _ANSI_RE.sub("", raw)
    lines = text.splitlines()
    # Drop trailing footer/reset lines (and the blank run before them).
    cut = len(lines)
    for i in range(len(lines) - 1, -1, -1):
        s = lines[i].strip()
        if not s or _FOOTER_RE.match(s) or _RESET_RE.match(s):
            cut = i
        else:
            break
    return "\n".join(lines[:cut]).strip()


@dataclass
class ModelResult:
    model: str
    ok: bool
    text: str = ""
    error: str = ""


def run_model(model: str, prompt: str, timeout: int = 180) -> ModelResult:
    """Run one model CLI once. Never raises; rate-limits/timeouts → ok=False."""
    if model not in _CMD:
        return ModelResult(model, False, error=f"unknown model {model!r}")
    try:
        proc = subprocess.run(
            _CMD[model](prompt),
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return ModelResult(model, False, error="timeout")
    except FileNotFoundError as e:
        return ModelResult(model, False, error=f"CLI not found: {e}")
    except Exception as e:  # pragma: no cover - defensive
        return ModelResult(model, False, error=str(e))

    text = _clean(proc.stdout or "")
    if proc.returncode != 0 and not text:
        err = (_clean(proc.stderr or "") or f"exit {proc.returncode}")[:300]
        return ModelResult(model, False, error=err)
    if not text:
        return ModelResult(model, False, error="empty output")
    # Heuristic rate-limit detection so the caller can back off / skip.
    low = text.lower()
    if any(k in low for k in ("rate limit", "quota exceeded", "too many requests")):
        return ModelResult(model, False, error="rate-limited", text=text)
    return ModelResult(model, True, text=text)
