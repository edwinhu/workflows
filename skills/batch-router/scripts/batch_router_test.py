"""Tests for route_batch.py ranking and the claude/openai batch validators. No network."""

import importlib.util
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILLS = HERE.parents[1]
sys.path.insert(0, str(HERE))


def load(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


route = load(HERE / "route_batch.py")
claude = load(SKILLS / "claude-batch/scripts/claude_batch.py")
openai = load(SKILLS / "openai-batch/scripts/openai_batch.py")

ACCOUNTS = """
[accounts.a_late]
provider = "anthropic"
monthly_credit_usd = 200
cycle_renews = 2026-11-23
key = "{key}"
credit_linked = true
[accounts.b_soon]
provider = "anthropic"
monthly_credit_usd = 200
cycle_renews = 2026-11-08
key = "{key}"
credit_linked = true
[accounts.c_nokey]
provider = "anthropic"
monthly_credit_usd = 200
cycle_renews = 2026-11-06
key = "none"
credit_linked = true
[accounts.oai]
provider = "openai"
monthly_credit_usd = 100
key = "{key}"
credit_linked = false
"""


def ranked(tmp_path, monkeypatch, *argv):
    keyfile = tmp_path / "k"
    keyfile.write_text("sk-test")
    cfg = tmp_path / "accounts.toml"
    cfg.write_text(ACCOUNTS.format(key=keyfile))
    monkeypatch.setenv("BATCH_ACCOUNTS", str(cfg))
    ap_args = ["--json", "--today", "2026-11-04", *argv]
    out = subprocess.run([sys.executable, str(HERE / "route_batch.py"), *ap_args], capture_output=True,
                         text=True, env={**os.environ, "BATCH_ACCOUNTS": str(cfg)}, check=False)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)["candidates"]


def test_soonest_expiring_prepaid_with_key_ranks_first(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "5000", "--in-tokens", "3000", "--out-tokens", "300")
    assert [r["account"] for r in c[:2]] == ["b_soon", "a_late"]
    assert all(r["group"] == 1 for r in c[:2])
    assert c[0]["balance_verified"] is False
    blocked = {r["account"]: r["reason"] for r in c if r["group"] == 4}
    assert blocked == {"c_nokey": "no key"}


def test_insufficient_verified_balance_drops_to_group_2(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "5000", "--in-tokens", "3000", "--out-tokens", "300",
               "--balance", "b_soon=1")
    by = {r["account"]: r for r in c}
    assert by["b_soon"]["group"] == 2 and by["b_soon"]["balance_verified"] is True
    assert c[0]["account"] == "a_late"


def test_openai_unlinked_is_pay_per_token_and_web_search_does_not_block_it(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "200", "--in-tokens", "1000", "--out-tokens", "200",
               "--needs", "web-search")
    by = {r["account"]: r for r in c}
    assert by["oai"]["group"] == 3 and "web-search" not in by["oai"]["reason"]
    assert by["vertex"]["group"] == 3


def test_shards_over_the_request_limit(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "250000", "--in-tokens", "100", "--out-tokens", "10")
    by = {r["account"]: r for r in c}
    assert by["a_late"]["shards"] == 3
    assert by["oai"]["shards"] == 5
    assert by["vertex"]["shards"] == 2


def test_zero_args_is_a_usage_error():
    out = subprocess.run([sys.executable, str(HERE / "route_batch.py")], capture_output=True, text=True, check=False)
    assert out.returncode == 2 and "usage" in out.stderr


def test_haiku_long_context_price():
    import batchlib
    assert batchlib.batch_cost("claude-haiku-5-5", 1, 50_000, 0) == 50_000 * 0.05 / 1e6
    assert batchlib.batch_cost("claude-haiku-5-5", 1, 150_000, 0) == 150_000 * 0.25 / 1e6


def test_claude_validate(tmp_path):
    good = {"custom_id": "a-1", "params": {"model": "claude-haiku-5-5", "max_tokens": 10,
                                           "messages": [{"role": "user", "content": "hi"}]}}
    rows = [good, {**good}, {"custom_id": "bad id!", "params": {**good["params"], "max_tokens": 0, "stream": True}}]
    p = tmp_path / "r.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    _, errors = claude.validate(p)
    text = "\n".join(errors)
    assert "duplicate custom_id a-1" in text
    assert "must match" in text and "max_tokens" in text and "params.stream" in text


def test_openai_validate_one_model_per_file(tmp_path):
    row = {"custom_id": "r1", "method": "POST", "url": "/v1/responses", "body": {"model": "gpt-6-luna", "input": "x"}}
    other = {**row, "custom_id": "r2", "body": {"model": "gpt-6.1-terra", "input": "y"}}
    p = tmp_path / "r.jsonl"
    p.write_text(json.dumps(row) + "\n" + json.dumps(other) + "\n")
    _, errors = openai.validate(p)
    assert any("one model per file" in e for e in errors)


def test_submit_refuses_without_run(tmp_path, capsys):
    row = {"custom_id": "a", "params": {"model": "claude-haiku-5-5", "max_tokens": 5,
                                        "messages": [{"role": "user", "content": "hi"}]}}
    p = tmp_path / "r.jsonl"
    p.write_text(json.dumps(row) + "\n")
    assert claude.main(["submit", str(p)]) == 2
    assert "refusing" in capsys.readouterr().err


def test_no_key_account_reports_cleanly(tmp_path, monkeypatch):
    cfg = tmp_path / "a.toml"
    cfg.write_text('[accounts.x]\nprovider = "anthropic"\nkey = "none"\n')
    monkeypatch.setenv("BATCH_ACCOUNTS", str(cfg))
    try:
        claude.main(["list", "--account", "x"])
    except SystemExit as exc:
        assert "no key" in str(exc)
    else:
        raise AssertionError("expected SystemExit")


def test_dates_are_dates():
    import batchlib
    accts, _ = batchlib.load_accounts(SKILLS / "batch-router/references/accounts.example.toml")
    assert isinstance(accts["personal"].cycle_renews, date)
    assert accts["openai"].prepaid is False and accts["personal"].prepaid is True
