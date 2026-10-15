# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "requests"]
# ///
"""Contract tests for readwise_prune.py: filtering logic via main() with a faked Readwise API."""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import readwise_prune as rp


def ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def doc(id, days=400, loc="later", cat="article", tags=None, parent=None, title=None):
    d = {"id": id, "saved_at": ago(days), "location": loc, "category": cat,
         "title": title or f"title-{id}"}
    if tags is not None:
        d["tags"] = tags
    if parent:
        d["parent_id"] = parent
    return d


class FakeApi:
    """paginate() stand-in: first call = pass 1 (recent), later calls = one per location."""

    def __init__(self, recent, by_loc):
        self.recent, self.by_loc, self.params = recent, by_loc, []

    def __call__(self, token, params, label="docs"):
        self.params.append(params)
        if "updatedAfter" in params:
            return self.recent
        return self.by_loc.get(params["location"], [])


@pytest.fixture
def env(monkeypatch, tmp_path):
    tok = tmp_path / "tok"
    tok.write_text("secret\n")
    monkeypatch.setattr(rp, "TOKEN_PATH", tok)
    monkeypatch.setattr(rp.time, "sleep", lambda s: None)
    return monkeypatch


def run(env, argv, api, capsys):
    env.setattr(rp, "paginate", api)
    env.setattr(sys, "argv", ["readwise_prune.py", *argv])
    rp.main()
    return capsys.readouterr().out


def test_get_token_missing_and_empty(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rp, "TOKEN_PATH", tmp_path / "none")
    with pytest.raises(SystemExit) as e:
        rp.get_token()
    assert e.value.code == 2 and "Token file not found:" in capsys.readouterr().err
    (tmp_path / "e").write_text(" \n")
    monkeypatch.setattr(rp, "TOKEN_PATH", tmp_path / "e")
    with pytest.raises(SystemExit):
        rp.get_token()
    assert "Token file is empty:" in capsys.readouterr().err


def test_parse_dt_and_doc_tags():
    assert rp.parse_dt("2020-01-02T03:04:05+00:00") == datetime(2020, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    assert rp.parse_dt(None) is None and rp.parse_dt("garbage") is None
    assert rp.doc_tags({"tags": {"Keep": {}}}) == {"keep"}
    assert rp.doc_tags({"tags": ["A", 1]}) == {"a"}
    assert rp.doc_tags({}) == set()


def test_dry_run_filters_each_skip_reason(env, capsys):
    api = FakeApi(
        recent=[doc("safe", days=5), {"id": "h1", "parent_id": "hl", "saved_at": ago(1)}],
        by_loc={
            "later": [doc("old1"), doc("safe", days=5), doc("hl"), doc("young", days=10),
                      doc("tagged", tags={"Keep": {}}), doc("h2", parent="x"),
                      doc("fd", loc="feed")],
            "archive": [doc("old2", cat="pdf")],
        },
    )
    out = run(env, ["--exclude-tag", "keep"], api, capsys)
    assert "DRY RUN" in out
    assert "Candidates for deletion: 2" in out
    assert "Skipped (recently active): 1" in out
    assert "Skipped (has highlights):  1" in out
    assert "Skipped (highlight entry): 1" in out
    assert "Skipped (too recent):      1" in out
    assert "Skipped (feed):            1" in out
    assert "Skipped (tag):       1" in out
    assert "title-old1" in out and "title-old2" in out
    assert "Dry run complete. Pass --delete to remove 2 documents." in out
    assert [p.get("location") for p in api.params[1:]] == ["archive", "later"]


def test_nothing_to_prune(env, capsys):
    out = run(env, [], FakeApi([], {"later": [doc("young", days=3)]}), capsys)
    assert "Candidates for deletion: 0" in out and out.rstrip().endswith("Nothing to prune.")


def test_category_passed_server_side(env, capsys):
    api = FakeApi([], {})
    run(env, ["--location", "later", "--category", "pdf"], api, capsys)
    assert api.params[1] == {"location": "later", "category": "pdf"}


def test_delete_respects_limit_and_counts_failures(env, capsys):
    class Resp:
        def __init__(self, c):
            self.status_code = c

    calls = []

    def fake_request(method, url, headers, params=None, max_retries=5):
        calls.append((method, url, headers))
        return Resp(204 if len(calls) == 1 else 500)

    env.setattr(rp, "api_request", fake_request)
    api = FakeApi([], {"later": [doc("a"), doc("b"), doc("c")]})
    out = run(env, ["--delete", "--limit", "2", "--location", "later"], api, capsys)
    assert [c[:2] for c in calls] == [("DELETE", rp.API_DELETE + "a/"), ("DELETE", rp.API_DELETE + "b/")]
    assert calls[0][2] == {"Authorization": "Token secret"}
    assert "DELETE MODE" in out and "Done: 1 deleted, 1 failed" in out


def test_api_request_retries_on_429(monkeypatch):
    seq = iter([429, 200])
    waits = []

    class R:
        def __init__(self, c):
            self.status_code, self.headers = c, {"Retry-After": "7"}

    monkeypatch.setattr(rp.requests, "request", lambda *a, **k: R(next(seq)))
    monkeypatch.setattr(rp.time, "sleep", waits.append)
    assert rp.api_request("GET", "u", {}).status_code == 200
    assert waits == [7]
