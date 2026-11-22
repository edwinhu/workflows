"""Shared by route_batch.py, claude_batch.py and openai_batch.py: accounts, keys, prices, limits.

Not a CLI. The accounts file is personal config read from $BATCH_ACCOUNTS (default
~/.config/batch-router/accounts.toml); nothing here persists a balance.
"""

import json
import math
import os
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import tomllib

# Batch prices, USD per million tokens (input, output), tiers and availability live in
# batch_models.json beside this file; `route_batch.py --refresh` is the only writer of `available`,
# `price` and `asOf`. `long` is the price above `long_over` input tokens per request.
MODELS_FILE = Path(__file__).resolve().parent / "batch_models.json"


def load_models(path: Path | None = None) -> dict:
    """{model: {provider, tier, in, out[, long_over, long], ...}} from the table; `long` is a tuple."""
    data = json.loads((path or MODELS_FILE).read_text())
    out = {}
    for mid, m in data["models"].items():
        m = dict(m)
        if m.get("long"):
            m["long"] = tuple(m["long"])
        out[mid] = m
    return out


MODELS = load_models()

# Per-batch hard limits: requests, bytes. Gemini Cloud Batch: 200k requests, one 1 GB JSONL.
LIMITS = {
    "anthropic": (100_000, 256 * 1024 * 1024),
    "openai": (50_000, 200 * 1024 * 1024),
    "gemini": (200_000, 1024 * 1024 * 1024),
}

# USD per search. Gemini 3 grounding: first 5,000 queries/month free, then $14/1,000.
SEARCH_USD = {"anthropic": 0.010, "openai": 0.010, "gemini": 0.014}

# What each provider's BATCH path does. OpenAI's batch guide never mentions tools, but a live
# /v1/responses batch row with web_search searched and cited sources (2026-11-05).
# Claude web search works in Message Batches at $10/1k (per-org batch throttle):
# https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool (2026-11-20).
# Claude has no embeddings endpoint and no audio/video input; OpenAI audio/video on batch is unverified.
CAPABILITIES = {
    "anthropic": {"vision", "pdf", "web-search", "long-context"},
    "openai": {"vision", "pdf", "web-search", "long-context", "embeddings"},
    "gemini": {"vision", "pdf", "web-search", "long-context", "embeddings", "audio", "video"},
}


def batch_cost(model: str, requests: int, in_tokens: float, out_tokens: float) -> float:
    """Token cost of a batch at batch prices; in/out are per-request averages."""
    m = MODELS[model]
    pin, pout = m["in"], m["out"]
    if "long_over" in m and in_tokens > m["long_over"]:
        pin, pout = m["long"]
    return requests * (in_tokens * pin + out_tokens * pout) / 1e6


def shards_needed(provider: str, requests: int, nbytes: int) -> int:
    max_req, max_bytes = LIMITS[provider]
    return max(1, math.ceil(requests / max_req), math.ceil(nbytes / max_bytes))


# ── accounts ─────────────────────────────────────────────────────────────────────────────────


def accounts_path() -> Path:
    return Path(os.environ.get("BATCH_ACCOUNTS") or Path.home() / ".config/batch-router/accounts.toml")


@dataclass
class Account:
    name: str
    provider: str
    label: str = ""
    org_id_prefix: str = ""
    monthly_credit_usd: float = 0.0
    cycle_renews: date | None = None
    key: str = ""
    credit_linked: bool = False
    default: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def prepaid(self) -> bool:
        """Prepaid only when a monthly credit exists AND is confirmed linked to this key's org."""
        return self.monthly_credit_usd > 0 and self.credit_linked


def load_accounts(path: Path | None = None) -> tuple[dict[str, Account], dict]:
    """Return ({name: Account}, top-level settings). A missing file is an empty config."""
    p = path or accounts_path()
    if not p.exists():
        return {}, {}
    data = tomllib.loads(p.read_text())
    out = {}
    known = set(Account.__dataclass_fields__) - {"name", "extra"}
    for name, raw in (data.get("accounts") or {}).items():
        kw = {k: v for k, v in raw.items() if k in known}
        out[name] = Account(name=name, extra={k: v for k, v in raw.items() if k not in known}, **kw)
    settings = {k: v for k, v in data.items() if k != "accounts"}
    return out, settings


def pick_account(accounts: dict[str, Account], provider: str, name: str | None) -> Account:
    """The named account, else the provider's `default = true` one, else its only one."""
    if name:
        acct = accounts.get(name)
        if acct is None:
            raise SystemExit(f"no account '{name}' in {accounts_path()} (have: {', '.join(accounts) or 'none'})")
        if acct.provider != provider:
            raise SystemExit(f"account '{name}' is provider {acct.provider}, not {provider}")
        return acct
    mine = [a for a in accounts.values() if a.provider == provider]
    defaults = [a for a in mine if a.default]
    if len(defaults) == 1:
        return defaults[0]
    if len(mine) == 1:
        return mine[0]
    raise SystemExit(f"pass --account: {len(mine)} {provider} accounts in {accounts_path()}, none default")


def key_status(acct: Account) -> tuple[bool, str]:
    """Cheap presence check, no secret read: (usable, description)."""
    src = (acct.key or "").strip()
    if not src or src == "none":
        return False, "no key"
    if src.startswith("op://"):
        return True, "1Password reference (resolved at use)"
    if src.startswith("env:"):
        var = src[4:]
        return (bool(os.environ.get(var)), f"env {var}" + ("" if os.environ.get(var) else " (unset)"))
    p = Path(os.path.expandvars(os.path.expanduser(src)))
    if p.is_file() and os.access(p, os.R_OK):
        return True, "key file"
    return False, f"key file missing or unreadable: {p}"


def resolve_key(acct: Account, settings: dict) -> str:
    """Read the secret. Raises SystemExit with a clean 'no key' message when it cannot."""
    usable, why = key_status(acct)
    if not usable:
        raise SystemExit(f"account '{acct.name}': {why}. Add a key source to {accounts_path()} "
                         "(key = \"<file path>\" | \"op://Vault/Item/field\" | \"env:VAR\").")
    src = acct.key.strip()
    if src.startswith("env:"):
        return os.environ[src[4:]].strip()
    if src.startswith("op://"):
        env = dict(os.environ)
        tok_file = settings.get("op_token_file")
        if not env.get("OP_SERVICE_ACCOUNT_TOKEN") and tok_file:
            env["OP_SERVICE_ACCOUNT_TOKEN"] = Path(os.path.expandvars(os.path.expanduser(tok_file))).read_text().strip()
        r = subprocess.run(["op", "read", src], capture_output=True, text=True, env=env, timeout=60, check=False)
        if r.returncode != 0:
            last = (r.stderr.strip().splitlines() or [f"exit {r.returncode}"])[-1]
            raise SystemExit(f"account '{acct.name}': op read failed: {last}")
        return r.stdout.strip()
    return Path(os.path.expandvars(os.path.expanduser(src))).read_text().strip()


# ── JSONL measurement ────────────────────────────────────────────────────────────────────────


def _prompt_chars(row: dict) -> int:
    if "params" in row:  # Anthropic
        p = row["params"]
        return len(json.dumps(p.get("messages", ""))) + len(json.dumps(p.get("system", "")))
    if "body" in row:  # OpenAI
        b = row["body"]
        return sum(len(json.dumps(b[k])) for k in ("input", "messages", "instructions", "prompt") if k in b)
    if "request" in row:  # Gemini
        r = row["request"]
        return len(json.dumps(r.get("contents", ""))) + len(json.dumps(r.get("systemInstruction", "")))
    return len(json.dumps(row))


def _max_out(row: dict) -> int | None:
    if "params" in row:
        return row["params"].get("max_tokens")
    if "body" in row:
        b = row["body"]
        return b.get("max_output_tokens") or b.get("max_completion_tokens") or b.get("max_tokens")
    if "request" in row:
        return (row["request"].get("generationConfig") or {}).get("maxOutputTokens")
    return None


def measure_jsonl(path: Path) -> dict:
    """Rows, bytes, mean input tokens (chars/4) and mean max-output tokens (None if unset)."""
    rows = nbytes = chars = 0
    outs = []
    with open(path, "rb") as fh:
        for line in fh:
            if not line.strip():
                continue
            rows += 1
            nbytes += len(line)
            row = json.loads(line)
            chars += _prompt_chars(row)
            mo = _max_out(row)
            if mo:
                outs.append(mo)
    return {
        "rows": rows,
        "bytes": nbytes,
        "in_tokens": chars / 4 / rows if rows else 0,
        "out_tokens": sum(outs) / len(outs) if outs else None,
    }


# ---- uploads: multipart bodies for the providers' Files APIs ----

MIME = {".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/plain",
        ".jsonl": "application/jsonl", ".png": "image/png", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


def multipart(fields: dict[str, str], path: Path, mime: str | None = None) -> tuple[bytes, str]:
    """multipart/form-data body (text fields, then one `file` part) and its Content-Type header."""
    boundary = uuid.uuid4().hex
    ctype = mime or MIME.get(path.suffix.lower(), "application/octet-stream")
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
             for k, v in fields.items()]
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
                  f"Content-Type: {ctype}\r\n\r\n").encode())
    parts.append(path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"
