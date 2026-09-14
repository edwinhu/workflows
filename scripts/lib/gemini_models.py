"""gemini_models — the one place a Gemini model id is chosen.

Call sites pass a ROLE, never an id. Roles exist because the plugin's Gemini calls do three
different jobs and a single global default would silently promote every cheap batch job onto a
reasoning model:

    bulk                cheap high-volume batch / per-item work
    judgment            reasoning where accuracy matters
    pro                 the few sites that need a pro model
    vision              multimodal extraction from one file (OCR, charts, tables)
    vision_antigravity  the same job through the `agy` CLI, whose ids carry a reasoning
                        suffix and are not interchangeable with the API ids

Resolution order, highest wins:

    1. `override`                  — the script's --model flag, when the caller passed one
    2. $GEMINI_MODEL               — global sweep override; pins EVERY role at once
    3. $GEMINI_MODEL_<ROLE>        — e.g. GEMINI_MODEL_BULK
    4. the role's constant in gemini-models.json

Because 2 and 3 let an operator move every call site without editing code, the resolved id MUST
be stamped into whatever the script writes — an audit finding is only traceable to the model
that produced it if the output records the id. See `stamp()`.

Usage:

    from gemini_models import resolve_model, stamp
    model = resolve_model('bulk', args.model)     # args.model default MUST be None
    payload = {**stamp(model), 'findings': ...}

Shell call sites use the CLI form so they read this same table rather than hardcoding an id:

    python3 scripts/lib/gemini_models.py vision_antigravity
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_TABLE_PATH = Path(__file__).resolve().parent / "gemini-models.json"

_TABLE: dict = json.loads(_TABLE_PATH.read_text())
ROLE_MODELS: dict[str, str] = dict(_TABLE["roles"])

#: Every role name, for argparse `choices=` and for tests.
ROLES = tuple(sorted(ROLE_MODELS))


def resolve_model(role: str, override: str | None = None) -> str:
    """Return the Gemini model id for `role`, honouring the resolution order above.

    Raises KeyError on an unknown role — a typo'd role must not silently fall through to a
    default, because the caller would then be billed at a tier it never asked for.
    """
    if override:
        return override
    sweep = os.environ.get("GEMINI_MODEL")
    if sweep:
        return sweep
    per_role = os.environ.get(f"GEMINI_MODEL_{role.upper()}")
    if per_role:
        return per_role
    try:
        return ROLE_MODELS[role]
    except KeyError:
        raise KeyError(
            f"unknown Gemini role {role!r}; known roles: {', '.join(ROLES)}"
        ) from None


def stamp(model: str) -> dict[str, str]:
    """The metadata fragment every Gemini-produced artifact must carry.

    Merge into the output dict (or each record of an output list) so a finding can always be
    traced back to the model that produced it.
    """
    return {"model": model}


def _main(argv: list[str]) -> int:
    """`gemini_models.py <role>` — print one resolved id, for shell call sites.

    One implementation serves Python and bash. Failure is loud and stdout stays empty, so a
    caller that forgets to check the status substitutes nothing rather than a plausible id.
    """
    if len(argv) != 1:
        print(f"usage: gemini_models.py <role>; roles: {', '.join(ROLES)}", file=sys.stderr)
        return 2
    try:
        print(resolve_model(argv[0]))
    except KeyError as exc:
        print(exc.args[0], file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
