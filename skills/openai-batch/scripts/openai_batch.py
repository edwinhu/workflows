#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""OpenAI Batch API: validate, verify, submit, status, results, cancel, list, accounts.

Input JSONL: one {"custom_id", "method": "POST", "url": "/v1/...", "body": {...}} per line, ONE model
and ONE url per file. `submit` refuses without --run. `validate` and `accounts` make no network call.

Usage:
  openai_batch.py validate requests.jsonl
  openai_batch.py verify requests.jsonl [--row 1] [--account NAME]     # ONE sync request, full price
  openai_batch.py submit requests.jsonl --run [--account NAME]         # Files upload + batch create
  openai_batch.py status BATCH_ID [--wait] [--account NAME]
  openai_batch.py results BATCH_ID --input requests.jsonl --out results.jsonl [--account NAME]
  openai_batch.py upload PATH [PATH ...] [--purpose user_data] [--expires SECONDS] [--account NAME]
  openai_batch.py delete-file FILE_ID [FILE_ID ...] [--account NAME]
  openai_batch.py cancel BATCH_ID | list [--limit 20] | accounts
A file id resolves only under the account (project key) that uploaded it: upload with the same
--account as submit. --expires is 3600..2592000 s; files are capped at 512 MB.
Exit codes: 0 ok, 1 invalid input / API error / unreconciled rows, 2 usage error.
"""

import argparse
import json
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
    multipart,
    pick_account,
    resolve_key,
)

API = "https://api.openai.com"
ENDPOINTS = {"/v1/responses", "/v1/chat/completions", "/v1/embeddings", "/v1/completions",
             "/v1/moderations", "/v1/images/generations", "/v1/images/edits"}
MAX_REQ, MAX_BYTES = LIMITS["openai"]
MAX_FILE_BYTES = 512 * 2**20
EXPIRES_RANGE = (3600, 2_592_000)
TERMINAL = {"failed", "completed", "expired", "cancelled"}


def validate(path: Path) -> tuple[list[dict], list[str]]:
    rows, errors, seen, nbytes = [], [], set(), 0
    models, urls = set(), set()
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
            if not isinstance(row, dict):
                errors.append(f"line {n}: not an object")
                continue
            cid = row.get("custom_id")
            if not isinstance(cid, str) or not cid:
                errors.append(f"line {n}: custom_id must be a non-empty string")
            elif cid in seen:
                errors.append(f"line {n}: duplicate custom_id {cid}")
            else:
                seen.add(cid)
            if row.get("method") != "POST":
                errors.append(f"line {n}: method must be POST")
            if row.get("url") not in ENDPOINTS:
                errors.append(f"line {n}: url {row.get('url')!r} is not a batch endpoint")
            urls.add(row.get("url"))
            body = row.get("body")
            if not isinstance(body, dict) or not isinstance(body.get("model"), str):
                errors.append(f"line {n}: body.model missing")
                continue
            if body.get("stream"):
                errors.append(f"line {n}: body.stream is not allowed in a batch")
            models.add(body["model"])
            rows.append(row)
    if len(models) > 1:
        errors.append(f"one model per file; found {sorted(models)}")
    if len(urls) > 1:
        errors.append(f"one endpoint per batch; found {sorted(u for u in urls if u)}")
    if len(rows) > MAX_REQ or nbytes > MAX_BYTES:
        errors.append(f"{len(rows):,} requests / {nbytes / 2**20:.1f} MB exceeds one batch "
                      f"({MAX_REQ:,} / {MAX_BYTES // 2**20} MB): shard the file")
    return rows, errors


class Client:
    def __init__(self, account: str | None):
        accounts, settings = load_accounts()
        self.acct = pick_account(accounts, "openai", account)
        self.key = resolve_key(self.acct, settings)

    def billing(self) -> str:
        if self.acct.prepaid:
            return f"prepaid credit on '{self.acct.name}' (confirmed linked)"
        return f"PAY-PER-TOKEN on '{self.acct.name}': no confirmed prepaid credit"

    def call(self, method: str, path: str, body=None, raw: bool = False, data: bytes | None = None,
             ctype: str = "application/json"):
        if body is not None:
            data = json.dumps(body).encode()
        req = urllib.request.Request(API + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.key}")
        if data is not None:
            req.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                payload = r.read()
        except urllib.error.HTTPError as exc:
            text = exc.read().decode(errors="replace")
            hint = " (credit_balance_exhausted: the prepaid credit is spent)" if "credit_balance_exhausted" in text else ""
            raise SystemExit(f"HTTP {exc.code} from {method} {path} [account {self.acct.name}]{hint}: {text}") from None
        return payload if raw else json.loads(payload)

    def upload(self, path: Path, purpose: str = "batch", expires: int | None = None) -> dict:
        fields = {"purpose": purpose}
        if expires is not None:
            fields["expires_after[anchor]"] = "created_at"
            fields["expires_after[seconds]"] = str(expires)
        body, ctype = multipart(fields, path, "application/jsonl" if purpose == "batch" else None)
        return self.call("POST", "/v1/files", data=body, ctype=ctype)


def cmd_validate(a) -> int:
    rows, errors = validate(a.jsonl)
    for e in errors[:50]:
        print(e)
    models = sorted({r["body"]["model"] for r in rows})
    print(f"{'INVALID' if errors else 'OK'}: {len(rows):,} requests, models {models}")
    return 1 if errors else 0


def cmd_verify(a) -> int:
    rows, errors = validate(a.jsonl)
    if errors:
        print("\n".join(errors[:20]))
        return 1
    row = rows[a.row - 1]
    c = Client(a.account)
    m = MODELS.get(row["body"]["model"])
    print(f"verify: ONE synchronous request at standard (2x batch) price, {c.billing()}"
          + ("" if m else f"; model {row['body']['model']} not in the price table"))
    resp = c.call("POST", row["url"], row["body"])
    print(json.dumps({"account": c.acct.name, "custom_id": row["custom_id"], "response": resp}, indent=2)[:4000])
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
    print(f"billing: {c.billing()}", file=sys.stderr)
    f = c.upload(a.jsonl)  # purpose batch
    b = c.call("POST", "/v1/batches", {"input_file_id": f["id"], "endpoint": rows[0]["url"],
                                        "completion_window": "24h"})
    print(json.dumps({"account": c.acct.name, "id": b["id"], "status": b["status"],
                      "input_file_id": f["id"]}, indent=2))
    return 0


def cmd_upload(a) -> int:
    lo, hi = EXPIRES_RANGE
    if a.expires is not None and not lo <= a.expires <= hi:
        print(f"--expires must be {lo}..{hi} seconds", file=sys.stderr)
        return 1
    for p in a.paths:
        if not p.is_file():
            print(f"{p}: not a file", file=sys.stderr)
            return 1
        if p.stat().st_size > MAX_FILE_BYTES:
            print(f"{p}: {p.stat().st_size / 2**20:.1f} MB exceeds the {MAX_FILE_BYTES // 2**20} MB file limit",
                  file=sys.stderr)
            return 1
    c = Client(a.account)
    for p in a.paths:
        f = c.upload(p, a.purpose, a.expires)
        print(json.dumps({"account": c.acct.name, "path": str(p), "file_id": f["id"], "bytes": f.get("bytes"),
                          "purpose": f.get("purpose"), "expires_at": f.get("expires_at")}))
    return 0


def cmd_delete_file(a) -> int:
    c = Client(a.account)
    for fid in a.file_ids:
        r = c.call("DELETE", f"/v1/files/{fid}")
        print(json.dumps({"account": c.acct.name, "file_id": fid, "deleted": r.get("deleted")}))
    return 0


def cmd_status(a) -> int:
    c = Client(a.account)
    while True:
        b = c.call("GET", f"/v1/batches/{a.batch_id}")
        print(json.dumps({k: b.get(k) for k in ("id", "status", "request_counts", "output_file_id",
                                                 "error_file_id", "created_at", "expires_at", "errors")}))
        if not a.wait or b["status"] in TERMINAL:
            return 0
        time.sleep(a.interval)


def cmd_results(a) -> int:
    c = Client(a.account)
    b = c.call("GET", f"/v1/batches/{a.batch_id}")
    if b["status"] not in TERMINAL:
        print(f"batch {a.batch_id} is {b['status']}; wait for a terminal status", file=sys.stderr)
        return 1
    seen, problems, ok = set(), [], 0
    with open(a.out, "w") as out:
        for fid in (b.get("output_file_id"), b.get("error_file_id")):
            if not fid:
                continue
            for line in c.call("GET", f"/v1/files/{fid}/content", raw=True).decode().splitlines():
                if not line.strip():
                    continue
                r = json.loads(line)
                cid = r["custom_id"]
                seen.add(cid)
                resp = r.get("response") or {}
                if r.get("error") is None and resp.get("status_code") == 200:
                    ok += 1
                    out.write(json.dumps({"custom_id": cid, "body": resp.get("body")}) + "\n")
                else:
                    problems.append({"custom_id": cid, "status_code": resp.get("status_code"),
                                     "error": r.get("error") or (resp.get("body") or {}).get("error")})
    wanted = []
    if a.input:
        wanted = [json.loads(line)["custom_id"] for line in a.input.read_text().splitlines() if line.strip()]
    missing = [cid for cid in wanted if cid not in seen]
    summary = {"batch": a.batch_id, "status": b["status"], "succeeded": ok, "succeeded_written": str(a.out),
               "not_succeeded": problems, "missing": missing, "input_checked": bool(wanted),
               "request_counts": b.get("request_counts")}
    print(json.dumps(summary, indent=2))
    return 1 if problems or missing else 0


def cmd_cancel(a) -> int:
    c = Client(a.account)
    b = c.call("POST", f"/v1/batches/{a.batch_id}/cancel", {})
    print(json.dumps({"id": b["id"], "status": b["status"]}))
    return 0


def cmd_list(a) -> int:
    c = Client(a.account)
    page = c.call("GET", f"/v1/batches?limit={a.limit}")
    for b in page.get("data", []):
        print(f"{b['id']}  {b['status']:<11} {b['created_at']}  {b.get('endpoint')}  {json.dumps(b.get('request_counts'))}")
    if not page.get("data"):
        print(f"no batches on account '{c.acct.name}'")
    return 0


def cmd_accounts(_a) -> int:
    accounts, _ = load_accounts()
    mine = [x for x in accounts.values() if x.provider == "openai"]
    if not mine:
        print(f"no openai accounts in {accounts_path()}")
        return 1
    for x in mine:
        ok, why = key_status(x)
        print(f"{x.name:<8} {x.label:<16} {'prepaid (linked)' if x.prepaid else 'pay-per-token'}  "
              f"{'key: ' + why if ok else why.upper()}{'  (default)' if x.default else ''}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="OpenAI Batch API")
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
    st.add_argument("--interval", type=int, default=60)
    rs = add("results", cmd_results, batch=True)
    rs.add_argument("--input", type=Path, help="the submitted JSONL, to reconcile every custom_id")
    rs.add_argument("--out", type=Path, required=True)
    up = add("upload", cmd_upload)
    up.add_argument("paths", nargs="+", type=Path, metavar="PATH")
    up.add_argument("--purpose", default="user_data")
    up.add_argument("--expires", type=int, metavar="SECONDS", help="3600..2592000")
    add("delete-file", cmd_delete_file).add_argument("file_ids", nargs="+", metavar="FILE_ID")
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
