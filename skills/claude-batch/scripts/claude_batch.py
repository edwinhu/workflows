#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Anthropic Message Batches: validate, verify, submit, status, results, cancel, list, accounts.

Input JSONL: one {"custom_id": ..., "params": {<Messages API body>}} per line.
`submit` refuses without --run. `validate` and `accounts` make no network call.

Usage:
  claude_batch.py validate requests.jsonl
  claude_batch.py verify requests.jsonl [--row 1] [--account NAME]     # ONE sync request, full price
  claude_batch.py submit requests.jsonl --run [--account NAME]
  claude_batch.py status BATCH_ID [--wait] [--account NAME]
  claude_batch.py results BATCH_ID --input requests.jsonl --out results.jsonl [--account NAME]
  claude_batch.py cancel BATCH_ID | list [--limit 20] | accounts
Exit codes: 0 ok, 1 invalid input / API error / unreconciled rows, 2 usage error.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "batch-router" / "scripts"))
from batchlib import (
    LIMITS,
    MODELS,
    accounts_path,
    key_status,
    load_accounts,
    pick_account,
    resolve_key,
)

API = "https://api.anthropic.com/v1"
VERSION = "2026-10-21"
CUSTOM_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
FORBIDDEN = ("stream", "speed", "fallbacks")
MAX_REQ, MAX_BYTES = LIMITS["anthropic"]


def validate(path: Path) -> tuple[list[dict], list[str]]:
    rows, errors, seen, nbytes = [], [], set(), 0
    with open(path, "rb") as fh:
        for n, raw in enumerate(fh, 1):
            nbytes += len(raw)
            if not raw.strip():
                errors.append(f"line {n}: empty line")
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                errors.append(f"line {n}: invalid JSON: {exc}")
                continue
            cid = row.get("custom_id") if isinstance(row, dict) else None
            if not isinstance(cid, str) or not CUSTOM_ID.match(cid):
                errors.append(f"line {n}: custom_id {cid!r} must match ^[a-zA-Z0-9_-]{{1,64}}$")
            elif cid in seen:
                errors.append(f"line {n}: duplicate custom_id {cid}")
            else:
                seen.add(cid)
            p = row.get("params") if isinstance(row, dict) else None
            if not isinstance(p, dict):
                errors.append(f"line {n}: missing 'params' object")
                continue
            extra = set(row) - {"custom_id", "params"}
            if extra:
                errors.append(f"line {n}: unknown top-level keys {sorted(extra)}")
            if not isinstance(p.get("model"), str):
                errors.append(f"line {n}: params.model missing")
            mt = p.get("max_tokens")
            if not isinstance(mt, int) or mt < 1:
                errors.append(f"line {n}: params.max_tokens must be an integer >= 1 (0 is not allowed in batch)")
            if not isinstance(p.get("messages"), list) or not p["messages"]:
                errors.append(f"line {n}: params.messages must be a non-empty list")
            for k in FORBIDDEN:
                if k in p:
                    errors.append(f"line {n}: params.{k} is not allowed in a batch")
            rows.append(row)
    if len(rows) > MAX_REQ or nbytes > MAX_BYTES:
        errors.append(f"{len(rows):,} requests / {nbytes / 2**20:.1f} MB exceeds one batch "
                      f"({MAX_REQ:,} / {MAX_BYTES // 2**20} MB): shard the file")
    return rows, errors


class Client:
    def __init__(self, account: str | None):
        accounts, settings = load_accounts()
        self.acct = pick_account(accounts, "anthropic", account)
        self.key = resolve_key(self.acct, settings)

    def call(self, method: str, url: str, body: dict | None = None, raw: bool = False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url if url.startswith("http") else API + url, data=data, method=method)
        req.add_header("x-api-key", self.key)
        req.add_header("anthropic-version", VERSION)
        if data is not None:
            req.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                payload = r.read()
        except urllib.error.HTTPError as exc:
            text = exc.read().decode(errors="replace")
            raise SystemExit(f"HTTP {exc.code} from {method} {url} [account {self.acct.name}]: {text}") from None
        return payload if raw else json.loads(payload)


def price(model: str, usage: dict, sync: bool) -> float | None:
    m = MODELS.get(model)
    if not m:
        return None
    pin, pout = m["in"], m["out"]
    tin = usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
    if "long_over" in m and tin > m["long_over"]:
        pin, pout = m["long"]
    cost = (tin * pin + usage.get("output_tokens", 0) * pout) / 1e6
    return cost * (2 if sync else 1)


def cmd_validate(a) -> int:
    rows, errors = validate(a.jsonl)
    for e in errors[:50]:
        print(e)
    if len(errors) > 50:
        print(f"... {len(errors) - 50} more")
    models = sorted({r["params"].get("model") for r in rows if isinstance(r.get("params"), dict)})
    print(f"{'INVALID' if errors else 'OK'}: {len(rows):,} requests, models {models}")
    return 1 if errors else 0


def cmd_verify(a) -> int:
    rows, errors = validate(a.jsonl)
    if errors:
        print("\n".join(errors[:20]))
        return 1
    row = rows[a.row - 1]
    p = row["params"]
    m = MODELS.get(p["model"])
    if m:
        ceiling = (p["max_tokens"] * m["out"] * 2) / 1e6
        print(f"verify: ONE synchronous request at standard (2x batch) price; output ceiling ${ceiling:.6f} plus input")
    else:
        print(f"verify: model {p['model']} not in the price table; cost unknown")
    c = Client(a.account)
    resp = c.call("POST", "/messages", p)
    text = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
    cost = price(p["model"], resp.get("usage", {}), sync=True)
    print(json.dumps({"account": c.acct.name, "custom_id": row["custom_id"], "model": resp.get("model"),
                      "stop_reason": resp.get("stop_reason"), "usage": resp.get("usage"),
                      "cost_usd": round(cost, 6) if cost is not None else None, "text": text}, indent=2))
    return 0


def cmd_submit(a) -> int:
    rows, errors = validate(a.jsonl)
    if errors:
        print("\n".join(errors[:20]))
        return 1
    if not a.run:
        print(f"refusing to submit {len(rows):,} paid requests without --run "
              "(run verify and a 5-10 row pilot first; a paid batch needs Eddy's go-ahead)", file=sys.stderr)
        return 2
    c = Client(a.account)
    resp = c.call("POST", "/messages/batches", {"requests": rows})
    print(json.dumps({"account": c.acct.name, "id": resp["id"], "processing_status": resp["processing_status"],
                      "request_counts": resp["request_counts"], "expires_at": resp.get("expires_at")}, indent=2))
    return 0


def cmd_status(a) -> int:
    c = Client(a.account)
    while True:
        b = c.call("GET", f"/messages/batches/{a.batch_id}")
        print(json.dumps({k: b.get(k) for k in ("id", "processing_status", "request_counts", "created_at",
                                                 "ended_at", "expires_at")}))
        if not a.wait or b["processing_status"] == "ended":
            return 0
        time.sleep(a.interval)


def cmd_results(a) -> int:
    c = Client(a.account)
    b = c.call("GET", f"/messages/batches/{a.batch_id}")
    if b["processing_status"] != "ended" or not b.get("results_url"):
        print(f"batch {a.batch_id} is {b['processing_status']}; results exist only once it has ended", file=sys.stderr)
        return 1
    blob = c.call("GET", b["results_url"], raw=True).decode()
    wanted = []
    if a.input:
        wanted = [json.loads(line)["custom_id"] for line in a.input.read_text().splitlines() if line.strip()]
    by_type, seen, problems, cost = {}, set(), [], 0.0
    with open(a.out, "w") as out:
        for line in blob.splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            cid, res = r["custom_id"], r["result"]
            seen.add(cid)
            by_type[res["type"]] = by_type.get(res["type"], 0) + 1
            if res["type"] == "succeeded":
                msg = res["message"]
                out.write(json.dumps({"custom_id": cid, "message": msg}) + "\n")
                cost += price(msg.get("model", ""), msg.get("usage", {}), sync=False) or 0.0
            else:
                problems.append({"custom_id": cid, "type": res["type"], "error": res.get("error")})
    missing = [cid for cid in wanted if cid not in seen]
    unexpected = sorted(seen - set(wanted)) if wanted else []
    summary = {"batch": a.batch_id, "account": c.acct.name, "results": by_type, "succeeded_written": str(a.out),
               "est_cost_usd": round(cost, 6), "not_succeeded": problems, "missing": missing,
               "unexpected": unexpected, "input_checked": bool(wanted)}
    print(json.dumps(summary, indent=2))
    return 1 if problems or missing or unexpected else 0


def cmd_cancel(a) -> int:
    c = Client(a.account)
    b = c.call("POST", f"/messages/batches/{a.batch_id}/cancel", {})
    print(json.dumps({"id": b["id"], "processing_status": b["processing_status"]}))
    return 0


def cmd_list(a) -> int:
    c = Client(a.account)
    page = c.call("GET", f"/messages/batches?limit={a.limit}")
    for b in page.get("data", []):
        print(f"{b['id']}  {b['processing_status']:<12} {b['created_at']}  {json.dumps(b['request_counts'])}")
    return 0


def cmd_accounts(_a) -> int:
    accounts, _ = load_accounts()
    mine = [x for x in accounts.values() if x.provider == "anthropic"]
    if not mine:
        print(f"no anthropic accounts in {accounts_path()}")
        return 1
    for x in mine:
        ok, why = key_status(x)
        print(f"{x.name:<8} {x.label:<24} credit ${x.monthly_credit_usd:.0f} until {x.cycle_renews}  "
              f"{'key: ' + why if ok else why.upper()}{'  (default)' if x.default else ''}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Anthropic Message Batches")
    sub = ap.add_subparsers(dest="cmd")

    def add(name, fn, *, jsonl=False, batch=False):
        p = sub.add_parser(name)
        p.set_defaults(fn=fn)
        if jsonl:
            p.add_argument("jsonl", type=Path)
        if batch:
            p.add_argument("batch_id")
        if name not in ("validate", "accounts"):
            p.add_argument("--account", help=f"account name in {accounts_path()}")
        return p

    add("validate", cmd_validate, jsonl=True)
    add("verify", cmd_verify, jsonl=True).add_argument("--row", type=int, default=1)
    add("submit", cmd_submit, jsonl=True).add_argument("--run", action="store_true")
    st = add("status", cmd_status, batch=True)
    st.add_argument("--wait", action="store_true")
    st.add_argument("--interval", type=int, default=30)
    rs = add("results", cmd_results, batch=True)
    rs.add_argument("--input", type=Path, help="the submitted JSONL, to reconcile every custom_id")
    rs.add_argument("--out", type=Path, required=True)
    add("cancel", cmd_cancel, batch=True)
    add("list", cmd_list).add_argument("--limit", type=int, default=20)
    add("accounts", cmd_accounts)
    a = ap.parse_args(argv)
    if not a.cmd:
        ap.print_usage(sys.stderr)
        return 2
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
