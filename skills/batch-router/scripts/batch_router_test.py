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


def test_pdf_job_routes_to_gemini_even_with_expiring_claude_credit(tmp_path, monkeypatch):
    # b_soon expires in 4 days with a verified $200: a text job would spend it first.
    c = ranked(tmp_path, monkeypatch, "--requests", "500", "--in-tokens", "20000", "--out-tokens", "400",
               "--needs", "pdf", "--balance", "b_soon=200")
    assert c[0]["provider"] == "gemini" and c[0]["group"] == 1
    by = {r["account"]: r for r in c}
    assert by["b_soon"]["group"] == 3 and by["b_soon"]["days_left"] == 4
    assert any("TEXT jobs" in n for n in by["b_soon"]["notes"])


def test_text_web_search_routes_to_claude_soonest_credit_first(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "500", "--in-tokens", "2000", "--out-tokens", "300",
               "--needs", "web-search", "--balance", "b_soon=200")
    assert [r["account"] for r in c[:2]] == ["b_soon", "a_late"]
    assert all(r["group_name"] == "web-search → Claude" for r in c[:2])
    notes = " ".join(c[0]["notes"])
    assert "web_search_20260318" in notes and "max_uses=3" in notes and "$15.00" in notes
    assert "pilot 5-10 rows" in notes and "throttle" in notes and "Verified 2026-11-20" in notes and "UNVERIFIED" not in notes
    by = {r["account"]: r for r in c}
    assert by["vertex"]["group_name"] == "fallback"
    assert any("pilot and cap" in n for n in by["vertex"]["notes"])
    assert route.claude_search_tool("claude-sonnet-4-5") == "web_search_20250305"


def test_pdf_web_search_job_still_routes_to_gemini(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "500", "--in-tokens", "20000", "--out-tokens", "400",
               "--needs", "pdf", "--needs", "web-search", "--balance", "b_soon=200")
    assert c[0]["provider"] == "gemini" and c[0]["group"] == 1
    by = {r["account"]: r for r in c}
    assert by["b_soon"]["group"] == 3 and not by["b_soon"].get("lead")


def test_long_input_is_long_context_and_routes_to_gemini(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "100", "--in-tokens", "150000", "--out-tokens", "300")
    assert c[0]["provider"] == "gemini" and "long-context" in c[0]["reason"]


def test_embeddings_block_claude_and_route_to_gemini(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "1000", "--in-tokens", "500", "--out-tokens", "0",
               "--needs", "embeddings")
    by = {r["account"]: r for r in c}
    assert c[0]["provider"] == "gemini"
    assert by["b_soon"]["group"] == 4 and "embeddings" in by["b_soon"]["reason"]


def test_text_job_still_spends_expiring_credit_first(tmp_path, monkeypatch):
    c = ranked(tmp_path, monkeypatch, "--requests", "500", "--in-tokens", "20000", "--out-tokens", "400")
    assert c[0]["account"] == "b_soon" and c[0]["group"] == 1


def test_purpose_sets_the_gemini_billing_project(tmp_path, monkeypatch):
    def gem(*extra):
        c = ranked(tmp_path, monkeypatch, "--requests", "10", "--in-tokens", "100", "--out-tokens", "10",
                   "--needs", "pdf", *extra)
        return c[0]["next"]
    research = gem("--purpose", "research")
    assert "research project" in research and "UVA" not in research
    assert "bills Eddy's personal account" in research and "pilot and cap" in research
    assert "never the AI Studio" in gem("--purpose", "research")
    consulting = gem("--purpose", "consulting")
    assert consulting.startswith("ASK EDDY") and "never the research project" in consulting
    assert "UVA" not in consulting


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


def test_multipart_body_and_boundary(tmp_path):
    import batchlib
    f = tmp_path / "doc.pdf"
    f.write_bytes(b"%PDF-1.4 tiny")
    body, ctype = batchlib.multipart({"purpose": "user_data", "expires_in_seconds": "3600"}, f)
    boundary = ctype.split("boundary=")[1]
    assert ctype.startswith("multipart/form-data; boundary=")
    assert body.startswith(f"--{boundary}\r\n".encode()) and body.endswith(f"--{boundary}--\r\n".encode())
    assert b'name="purpose"\r\n\r\nuser_data' in body and b'name="expires_in_seconds"\r\n\r\n3600' in body
    assert b'name="file"; filename="doc.pdf"' in body and b"Content-Type: application/pdf" in body
    assert b"%PDF-1.4 tiny" in body
    (tmp_path / "x.bin").write_bytes(b"1")
    other, _ = batchlib.multipart({}, tmp_path / "x.bin")
    assert b"application/octet-stream" in other


def _no_client(monkeypatch, mod):
    def boom(*a, **k):
        raise AssertionError("Client constructed before validation")
    monkeypatch.setattr(mod, "Client", boom)


def test_upload_rejects_out_of_range_expires(tmp_path, monkeypatch):
    f = tmp_path / "a.pdf"
    f.write_bytes(b"x")
    for mod, bad in ((claude, ["100", "7776001"]), (openai, ["3599", "2592001"])):
        _no_client(monkeypatch, mod)
        for v in bad:
            assert mod.main(["upload", str(f), "--expires", v]) != 0


def test_upload_rejects_oversize_file(tmp_path, monkeypatch):
    f = tmp_path / "a.pdf"
    f.write_bytes(b"xx")
    for mod in (claude, openai):
        _no_client(monkeypatch, mod)
        monkeypatch.setattr(mod, "MAX_FILE_BYTES", 1)
        assert mod.main(["upload", str(f)]) != 0


def test_bare_invocation_is_usage_error():
    for rel in ("claude-batch/scripts/claude_batch.py", "openai-batch/scripts/openai_batch.py"):
        out = subprocess.run([sys.executable, str(SKILLS / rel)], capture_output=True, text=True, check=False)
        assert out.returncode == 2 and "usage" in out.stderr


def _run_results(mod, tmp_path, monkeypatch, capsys, blob, batch):
    class Fake:
        acct = type("A", (), {"name": "t"})()

        def __init__(self, account):
            pass

        def call(self, method, url, body=None, raw=False, **kw):
            return blob.encode() if raw else batch

    monkeypatch.setattr(mod, "Client", Fake)
    out = tmp_path / "out.jsonl"
    rc = mod.main(["results", "bid", "--out", str(out)])
    summary = json.loads(capsys.readouterr().out)
    return rc, summary, out.read_text()


def _claude_row(cid, stop, content):
    msg = {"model": "claude-haiku-5-5", "stop_reason": stop, "content": content,
           "usage": {"input_tokens": 10, "output_tokens": 10}}
    return json.dumps({"custom_id": cid, "result": {"type": "succeeded", "message": msg}})


CLAUDE_BATCH = {"processing_status": "ended", "results_url": "https://x/results"}


def test_claude_max_tokens_no_text_is_incomplete(tmp_path, monkeypatch, capsys):
    blob = _claude_row("a", "max_tokens", [{"type": "thinking", "thinking": "..."}])
    rc, s, written = _run_results(claude, tmp_path, monkeypatch, capsys, blob, CLAUDE_BATCH)
    assert rc == 1 and written == ""
    assert s["incomplete"][0]["custom_id"] == "a" and s["incomplete"][0]["stop_reason"] == "max_tokens"
    assert s["est_cost_usd"] > 0


def test_claude_normal_and_tool_use_rows_are_clean(tmp_path, monkeypatch, capsys):
    blob = "\n".join([_claude_row("a", "end_turn", [{"type": "text", "text": "hi"}]),
                      _claude_row("b", "tool_use", [{"type": "tool_use", "id": "t", "name": "n", "input": {}}])])
    rc, s, written = _run_results(claude, tmp_path, monkeypatch, capsys, blob, CLAUDE_BATCH)
    assert rc == 0 and s["incomplete"] == [] and len(written.splitlines()) == 2


def _oai_row(cid, body):
    return json.dumps({"custom_id": cid, "error": None, "response": {"status_code": 200, "body": body}})


OAI_BATCH = {"status": "completed", "output_file_id": "f1"}


def test_openai_incomplete_status_is_incomplete(tmp_path, monkeypatch, capsys):
    body = {"object": "response", "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"},
            "output": [{"type": "reasoning", "content": []}]}
    rc, s, written = _run_results(openai, tmp_path, monkeypatch, capsys, _oai_row("a", body), OAI_BATCH)
    assert rc == 1 and written == ""
    assert s["incomplete"][0]["status"] == "incomplete"
    assert s["incomplete"][0]["reason"] == {"reason": "max_output_tokens"}


def test_openai_completed_with_text_is_clean(tmp_path, monkeypatch, capsys):
    body = {"object": "response", "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "hi"}]}]}
    rc, s, written = _run_results(openai, tmp_path, monkeypatch, capsys, _oai_row("a", body), OAI_BATCH)
    assert rc == 0 and s["incomplete"] == [] and len(written.splitlines()) == 1


def test_openai_embeddings_body_not_flagged(tmp_path, monkeypatch, capsys):
    body = {"object": "list", "data": [{"object": "embedding", "embedding": [0.1]}]}
    rc, s, written = _run_results(openai, tmp_path, monkeypatch, capsys, _oai_row("a", body), OAI_BATCH)
    assert rc == 0 and s["incomplete"] == [] and len(written.splitlines()) == 1


# ── batch_models.json, --refresh, --propose ─────────────────────────────────────────────────

import copy  # noqa: E402
import shutil  # noqa: E402

refresh = load(HERE / "batch_refresh.py")

# The hand-edited MODELS constant as it stood before the table moved to batch_models.json (2026-11-04).
LEGACY_MODELS = {
    "claude-haiku-5-5": ("anthropic", "cheap", 0.05, 0.25, 100_000, (0.25, 1.25)),
    "claude-sonnet-5-5": ("anthropic", "mid", 1.0, 5.0, None, None),
    "claude-opus-5-5": ("anthropic", "top", 2.0, 10.0, None, None),
    "claude-fable-5-1": ("anthropic", "frontier", 5.0, 25.0, None, None),
    "gpt-6-luna": ("openai", "cheap", 0.05, 0.25, 272_000, (0.10, 0.375)),
    "gpt-6.1-terra": ("openai", "mid", 0.50, 2.50, 272_000, (1.00, 3.75)),
    "gpt-6.1-sol": ("openai", "top", 1.00, 5.00, 272_000, (2.00, 7.50)),
    "gpt-6-astra": ("openai", "frontier", 5.00, 25.00, 272_000, (10.00, 37.50)),
    "gemini-3.5-flash-lite": ("gemini", "cheap", 0.15, 1.25, None, None),
    "gemini-3.8-flash": ("gemini", "mid", 0.375, 1.875, None, None),
}


def test_table_loads_identically_to_the_legacy_constants():
    import batchlib
    assert set(batchlib.MODELS) == set(LEGACY_MODELS)
    for mid, (prov, tier, pin, pout, over, long) in LEGACY_MODELS.items():
        m = batchlib.MODELS[mid]
        assert (m["provider"], m["tier"], m["in"], m["out"]) == (prov, tier, pin, pout), mid
        assert m.get("long_over") == over and m.get("long") == long, mid
        assert isinstance(m.get("long", ()), tuple)
        assert m["available"] is True and m["source"].startswith("https://")


def test_table_file_has_no_stray_keys_for_batch_cost():
    import batchlib
    assert batchlib.batch_cost("gpt-6-luna", 10, 300_000, 0) == 10 * 300_000 * 0.10 / 1e6
    assert batchlib.batch_cost("gemini-3.8-flash", 2, 1000, 100) == 2 * (1000 * 0.375 + 100 * 1.875) / 1e6


def test_unavailable_model_is_skipped_by_pick_model(tmp_path):
    import batchlib
    assert route.pick_model("gemini", "mid", None) == "gemini-3.8-flash"
    batchlib.MODELS["gemini-3.8-flash"]["available"] = False
    try:
        assert route.pick_model("gemini", "mid", None) is None
    finally:
        batchlib.MODELS["gemini-3.8-flash"]["available"] = True


ANTHROPIC_PAGE = """### Batch processing

| Model | Batch input | Batch output |
| :---- | :---- | :---- |
| Claude Fable 5.2 | $4 / MTok | $20 / MTok |
| Claude Fable 5.1 | $5 / MTok | $25 / MTok |
| Claude Opus 5.5 | $2 / MTok | $10 / MTok |
| Claude Sonnet 5.5 | $1.10 / MTok | $5 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.05 / MTok | $0.25 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.25 / MTok | $1.25 / MTok |
"""
OPENAI_PAGE = """### Batch pricing data

| Model | Short context input | Short context output | Short context cached input | Long context input | Long context output |
| --- | --- | --- | --- | --- | --- |
| gpt-6.2-sol | $1.00 | $5.00 | $0.05 | $2.00 | $7.50 |
| gpt-6-luna | $0.05 | $0.25 | $0.005 | $0.10 | $0.375 |
| gpt-6.1-sol | $1.00 | $5.00 | $0.05 | $2.00 | $7.50 |
| gpt-6.1-terra | $0.50 | $2.50 | $0.025 | $1.00 | $3.75 |
| gpt-6-astra | $5.00 | $25.00 | $0.50 | $10.00 | $37.50 |
"""
# Three tabs per model (Standard, Priority, Batch), the shape of the live page.
_TAB = " | Input (text, image, video, audio)\n | Global\n | ${i} | $0.1 | N/A\n | \n | Text output (response and reasoning)\n | Global\n | ${o} | $9 | N/A\n | \n"


def _gem(name, *tabs, head=""):
    return "".join(f"{name}\n{head}{_TAB.format(i=i, o=o)}" for i, o in tabs)


GEMINI_PAGE = ("Header\n | \n"
               + _gem("Gemini 3.8 Flash", (0.75, 3.75), (1.35, 6.75), (0.375, 1.875))
               + _gem("Gemini 3.5 Flash-Lite", (0.30, 2.50), (0.5, 4.0), (0.15, 1.25))
               + _gem("Gemini 4 Neon", (3.0, 15.0), (5.4, 27.0), (1.5, 7.5)))


def _catalogs(**over):
    base = {"anthropic": {"claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"},
            "openai": {"gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"},
            "gemini": {"gemini-3.5-flash-lite", "gemini-3.8-flash"}}
    base.update(over)
    return base, {}


def _pages(**over):
    base = {"anthropic": ANTHROPIC_PAGE, "openai": OPENAI_PAGE, "gemini": GEMINI_PAGE}
    base.update(over)
    return base, {}


def _table_copy(tmp_path):
    p = tmp_path / "batch_models.json"
    shutil.copy(HERE / "batch_models.json", p)
    return p


def test_parsers_read_batch_rows_only():
    from datetime import date
    a = refresh.parse_anthropic(ANTHROPIC_PAGE)
    assert a["claudehaiku55"] == {"in": 0.05, "out": 0.25, "long": (0.25, 1.25)}
    assert a["claudefable52"] == {"in": 4.0, "out": 20.0}
    assert refresh.parse_openai(OPENAI_PAGE)["gpt-6.2-sol"] == {"in": 1.0, "out": 5.0, "long": (2.0, 7.5)}
    g = refresh.parse_gemini(GEMINI_PAGE, date(2026, 11, 21))
    assert g["gemini38flash"] == {"in": 0.375, "out": 1.875}
    assert g["gemini4neon"] == {"in": 1.5, "out": 7.5}


def test_gemini_dated_rows_follow_today():
    from datetime import date
    promo = _gem("Gemini 4 Carbon*", (2.0, 10.0), (3.6, 18.0), (1.0, 5.0), head="through November 30, 2026\n")
    full = _gem("Gemini 4 Carbon\n(Starting December 1, 2026),\nGemini 4 Carbon Cyber Permissive",
                (4.0, 20.0), (7.2, 36.0), (2.0, 10.0))
    page = "H\n | \n" + promo + full
    assert refresh.parse_gemini(page, date(2026, 11, 21))["gemini4carbon"] == {"in": 1.0, "out": 5.0}
    assert refresh.parse_gemini(page, date(2026, 12, 2))["gemini4carbon"] == {"in": 2.0, "out": 10.0}


def test_refresh_writes_available_price_asof_and_leaves_tier_untouched(tmp_path, monkeypatch, capsys):
    from datetime import date
    p = _table_copy(tmp_path)
    before = json.loads(p.read_text())
    cats, ce = _catalogs(gemini={"gemini-3.5-flash-lite"})  # 3.8-flash dropped from the list
    pages, pe = _pages(anthropic=ANTHROPIC_PAGE)  # sonnet price moved to 1.10
    monkeypatch.setattr(refresh, "fetch_catalogs", lambda: (cats, ce))
    monkeypatch.setattr(refresh, "fetch_pages", lambda: (pages, pe))
    assert refresh.refresh_cli(p, date(2026, 11, 21)) == 0
    after = json.loads(p.read_text())
    out = capsys.readouterr().out
    assert after["models"]["gemini-3.8-flash"]["available"] is False
    assert after["models"]["claude-sonnet-5-5"]["in"] == 1.10
    assert all(m["asOf"] == "2026-11-21" for m in after["models"].values())
    assert {k: v["tier"] for k, v in after["models"].items()} == {k: v["tier"] for k, v in before["models"].items()}
    assert set(after["models"]) == set(before["models"])  # refresh never adds or drops a model
    assert "claude-sonnet-5-5.in: 1.0 -> 1.1" in out and "gemini-3.8-flash.available: True -> False" in out


def test_refresh_unparsable_price_is_flagged_with_reason_never_guessed(tmp_path, monkeypatch):
    from datetime import date
    p = _table_copy(tmp_path)
    cats, ce = _catalogs()
    pages, pe = _pages(gemini="a page with no tables at all")
    monkeypatch.setattr(refresh, "fetch_catalogs", lambda: (cats, ce))
    monkeypatch.setattr(refresh, "fetch_pages", lambda: (pages, pe))
    refresh.refresh_cli(p, date(2026, 11, 21))
    m = json.loads(p.read_text())["models"]["gemini-3.8-flash"]
    assert (m["in"], m["out"]) == (0.375, 1.875)  # last verified numbers, not invented ones
    assert "no parsable batch row" in m["price_unverified"] and "2026-11-21" in m["price_unverified"]
    assert "price_unverified" not in json.loads(p.read_text())["models"]["gpt-6-luna"]


def test_refresh_unreachable_provider_leaves_its_fields_alone(tmp_path, monkeypatch, capsys):
    from datetime import date
    p = _table_copy(tmp_path)
    before = json.loads(p.read_text())["models"]["gpt-6-luna"]
    cats, _ = _catalogs()
    del cats["openai"]
    pages, _ = _pages()
    del pages["openai"]
    monkeypatch.setattr(refresh, "fetch_catalogs", lambda: (cats, {"openai": "401"}))
    monkeypatch.setattr(refresh, "fetch_pages", lambda: (pages, {"openai": "timeout"}))
    refresh.refresh_cli(p, date(2026, 11, 21))
    assert json.loads(p.read_text())["models"]["gpt-6-luna"] == before
    assert "openai: catalog unreachable (401)" in capsys.readouterr().out


def test_refresh_without_changes_does_not_rewrite(tmp_path, monkeypatch, capsys):
    from datetime import date
    p = _table_copy(tmp_path)
    cats, ce = _catalogs()
    pages, pe = _pages(anthropic=ANTHROPIC_PAGE.replace("$1.10", "$1"))
    monkeypatch.setattr(refresh, "fetch_catalogs", lambda: (cats, ce))
    monkeypatch.setattr(refresh, "fetch_pages", lambda: (pages, pe))
    refresh.refresh_cli(p, date(2026, 11, 4))  # same asOf as the committed table
    assert "no change" in capsys.readouterr().out


def test_propose_detects_new_family_and_writes_nothing(tmp_path, monkeypatch, capsys):
    from datetime import date
    p = _table_copy(tmp_path)
    snapshot = p.read_bytes()
    cats, ce = _catalogs(
        gemini={"gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-4-neon", "text-embedding-005"},
        anthropic={"claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1",
                   "claude-fable-5-2", "claude-opus-4-8", "claude-opus-4-5-20251101"},
        openai={"gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra", "gpt-6.2-sol", "gpt-5.6-luna",
                "gpt-image-2", "gpt-realtime"})
    pages, _ = _pages()
    monkeypatch.setattr(refresh, "fetch_catalogs", lambda: (cats, ce))
    monkeypatch.setattr(refresh, "fetch_pages", lambda: (pages, {}))
    assert refresh.propose_cli(p, date(2026, 11, 21), as_json=True) == 0
    rep = json.loads(capsys.readouterr().out)
    assert p.read_bytes() == snapshot  # advisory: nothing written
    fams = {(f["provider"], f["family"]): [m["id"] for m in f["models"]] for f in rep["families"]}
    assert fams[("gemini", "gemini codename")] == ["gemini-4-neon"]
    assert fams[("anthropic", "claude fable")] == ["claude-fable-5-2"]
    assert ("openai", "gpt image") not in fams and ("openai", "gpt realtime") not in fams
    assert all("20251101" not in m["id"] for f in rep["families"] for m in f["models"])
    tiers = {t["current"]: t for t in rep["tiers"]}
    assert [c["id"] for c in tiers["gpt-6.1-sol"]["candidates"]] == ["gpt-6.2-sol"]
    assert tiers["claude-fable-5-1"]["candidates"][0]["price"] == {"in": 4.0, "out": 20.0}
    neon = tiers["gemini-3.8-flash"]["candidates"][0]
    assert neon["id"] == "gemini-4-neon" and neon["codename_no_published_tier"] is True
    assert neon["price"] == {"in": 1.5, "out": 7.5}
    assert "gpt-5.6-luna" not in [c["id"] for t in rep["tiers"] for c in t["candidates"]]  # older, not newer


def test_propose_text_says_codename_needs_a_human(tmp_path, monkeypatch, capsys):
    from datetime import date
    p = _table_copy(tmp_path)
    cats, ce = _catalogs(gemini={"gemini-3.8-flash", "gemini-4-neon", "gemini-4-argon"})
    pages, _ = _pages()
    monkeypatch.setattr(refresh, "fetch_catalogs", lambda: (cats, ce))
    monkeypatch.setattr(refresh, "fetch_pages", lambda: (pages, {}))
    refresh.propose_cli(p, date(2026, 11, 21), as_json=False)
    out = capsys.readouterr().out
    assert "gemini-4-neon" in out and "no published tier; a human must assign one" in out
    assert "gemini-4-argon: price not found" in out  # not on the page: said plainly, not guessed


def test_cli_refresh_and_propose_are_exclusive_and_skip_job_args(monkeypatch):
    assert route.main(["--refresh", "--propose"]) == 2
    seen = {}
    monkeypatch.setattr(refresh, "propose_cli", lambda path, today, js: seen.update(path=path, js=js) or 0)
    monkeypatch.setitem(sys.modules, "batch_refresh", refresh)
    assert route.main(["--propose", "--json", "--table", "/x.json"]) == 0
    assert str(seen["path"]) == "/x.json" and seen["js"] is True
