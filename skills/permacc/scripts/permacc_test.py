# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "requests"]
# ///
"""Contract tests for permacc.py: key resolution, the folder-in-body rule, capture polling, delete
fallbacks and CLI refusals. requests is stubbed; nothing here reaches perma.cc."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import permacc as pc


class Resp:
    def __init__(self, status=200, body=None, text=""):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = text or json.dumps(self._body)
        self.ok = status < 400

    def json(self):
        return self._body

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError(f"HTTP {self.status_code}")


class Net:
    """Records every request and answers from a per-method queue or callable."""

    def __init__(self):
        self.calls = []
        self.answers = {"get": [], "post": [], "delete": [], "patch": []}

    def _do(self, method, url, **kw):
        self.calls.append((method, url, kw))
        a = self.answers[method]
        if callable(a):
            return a(url, **kw)
        return a.pop(0) if len(a) > 1 else a[0]

    def install(self, monkeypatch):
        for m in self.answers:
            monkeypatch.setattr(pc.requests, m, lambda url, _m=m, **kw: self._do(_m, url, **kw))
        monkeypatch.setattr(pc.time, "sleep", lambda s: None)
        return self


@pytest.fixture
def net(monkeypatch):
    return Net().install(monkeypatch)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("PERMACC_API_KEY", raising=False)
    monkeypatch.delenv("PERMACC_API_KEY_FILE", raising=False)


# --- key and header -------------------------------------------------------------------------------

def test_headers_use_apikey_scheme_not_bearer():
    assert pc._headers("k") == {"Authorization": "ApiKey k"}


def test_read_key_precedence_arg_then_env_then_file(monkeypatch, tmp_path):
    f = tmp_path / "key"
    f.write_text("filekey\n")
    monkeypatch.setenv("PERMACC_API_KEY_FILE", str(f))
    assert pc.read_key(None) == "filekey"
    monkeypatch.setenv("PERMACC_API_KEY", " envkey ")
    assert pc.read_key(None) == "envkey"
    assert pc.read_key(" argkey ") == "argkey"


def test_read_key_missing_names_every_source(capsys):
    with pytest.raises(SystemExit) as e:
        pc.read_key(None)
    msg = str(e.value.code)
    assert "no key" in msg and "--api-key" in msg and "PERMACC_API_KEY" in msg


def test_read_key_ignores_file_variable_pointing_nowhere(monkeypatch, tmp_path):
    monkeypatch.setenv("PERMACC_API_KEY_FILE", str(tmp_path / "absent"))
    with pytest.raises(SystemExit):
        pc.read_key(None)


# --- folders --------------------------------------------------------------------------------------

USER = {"full_name": "Ed", "top_level_folders": [
    {"id": 1, "name": "Personal", "registrar": None},
    {"id": 376861, "name": "Law Library", "registrar": 16, "registrar_name": "UVA"}]}


def test_folders_reads_top_level_folders_key(net):
    net.answers["get"] = [Resp(200, USER)]
    assert [f["id"] for f in pc.folders("k")] == [1, 376861]
    assert net.calls[0][1] == f"{pc.API}/user/"


def test_folders_missing_key_is_empty_not_error(net):
    net.answers["get"] = [Resp(200, {"folders": [{"id": 9}]})]
    assert pc.folders("k") == []


def test_sponsored_folder_picks_first_with_registrar(net):
    net.answers["get"] = [Resp(200, USER)]
    assert pc.sponsored_folder("k") == 376861


def test_sponsored_folder_none_when_unsponsored(net):
    net.answers["get"] = [Resp(200, {"top_level_folders": [{"id": 1, "registrar": None}]})]
    assert pc.sponsored_folder("k") is None


# --- archive --------------------------------------------------------------------------------------

def test_archive_sends_folder_in_json_body_never_query(net):
    net.answers["post"] = [Resp(201, {"guid": "AB12-CD34"})]
    assert pc.archive("https://x.test/", "k", 376861)["guid"] == "AB12-CD34"
    _, url, kw = net.calls[0]
    assert kw["json"] == {"url": "https://x.test/", "folder": 376861}
    assert "?" not in url and "params" not in kw


def test_archive_without_folder_omits_the_field(net):
    net.answers["post"] = [Resp(201, {"guid": "g"})]
    pc.archive("https://x.test/", "k", None)
    assert net.calls[0][2]["json"] == {"url": "https://x.test/"}


def test_archive_folder_coerced_to_int(net):
    net.answers["post"] = [Resp(201, {"guid": "g"})]
    pc.archive("https://x.test/", "k", "376861")
    assert net.calls[0][2]["json"]["folder"] == 376861


def test_archive_usage_limit_400_carries_diagnostic_hint(net):
    net.answers["post"] = [Resp(400, text="You've reached your usage limit")]
    with pytest.raises(RuntimeError) as e:
        pc.archive("https://x.test/", "k", None)
    assert "HTTP 400" in str(e.value) and "permacc.py folders" in str(e.value)


def test_archive_other_error_has_no_hint(net):
    net.answers["post"] = [Resp(500, text="boom")]
    with pytest.raises(RuntimeError) as e:
        pc.archive("https://x.test/", "k", 1)
    assert "HTTP 500" in str(e.value) and "folders" not in str(e.value)


# --- capture_status -------------------------------------------------------------------------------

def cap(status):
    return Resp(200, {"captures": [{"role": "screenshot", "status": "failed"},
                                   {"role": "primary", "status": status}]})


def test_capture_status_reads_primary_capture_only(net):
    net.answers["get"] = [cap("success")]
    assert pc.capture_status("g", "k") == "success"


def test_capture_status_polls_until_pending_resolves(net):
    net.answers["get"] = [cap("pending"), cap("pending"), cap("failed")]
    assert pc.capture_status("g", "k", tries=6) == "failed"
    assert len(net.calls) == 3


def test_capture_status_gives_up_pending_after_tries(net):
    net.answers["get"] = [cap("pending")]
    assert pc.capture_status("g", "k", tries=3) == "pending"
    assert len(net.calls) == 3


def test_capture_status_no_primary_is_pending(net):
    net.answers["get"] = [Resp(200, {"captures": []})]
    assert pc.capture_status("g", "k", tries=1) == "pending"


def test_capture_status_http_error_does_not_raise(net):
    net.answers["get"] = [Resp(503)]
    assert pc.capture_status("g", "k", tries=2) == "pending"


# --- delete / private -----------------------------------------------------------------------------

def test_delete_reports_ok_only_on_204(net):
    net.answers["delete"] = [Resp(204)]
    assert pc.delete("g", "k") == (True, 204)
    net.answers["delete"] = [Resp(403)]
    assert pc.delete("g", "k") == (False, 403)


def test_make_private_sends_closed_enum_reason(net):
    net.answers["patch"] = [Resp(200)]
    assert pc.make_private("g", "k") is True
    assert net.calls[0][2]["json"] == {"is_private": True, "private_reason": "user"}


def delete_args(**over):
    base = dict(urls=[], out=None, failed=False, dry_run=False, private_if_undeletable=False)
    base.update(over)
    return pc.argparse.Namespace(**base)


def test_do_delete_nothing_to_delete_refuses():
    with pytest.raises(SystemExit) as e:
        pc.do_delete(delete_args(), "k")
    assert "nothing to delete" in str(e.value.code)


def test_do_delete_dry_run_touches_no_network(net, capsys):
    assert pc.do_delete(delete_args(urls=["g1"], dry_run=True), "k") == 0
    assert net.calls == [] and "would delete g1" in capsys.readouterr().out


def test_do_delete_403_without_flag_is_stuck_nonzero(net, capsys):
    net.answers["delete"] = [Resp(403)]
    assert pc.do_delete(delete_args(urls=["old"]), "k") == 1
    assert "--private-if-undeletable" in capsys.readouterr().err
    assert not [c for c in net.calls if c[0] == "patch"]


def test_do_delete_403_with_flag_makes_private_and_updates_record(net, tmp_path):
    out = tmp_path / "rec.json"
    out.write_text(json.dumps({"u1": {"guid": "old", "capture": "failed"},
                               "u2": {"guid": "new", "capture": "failed"},
                               "u3": {"guid": "ok", "capture": "success"}}))
    codes = {"old": 403, "new": 204}
    net.answers["delete"] = lambda url, **kw: Resp(codes[url.rstrip("/").split("/")[-1]])
    net.answers["patch"] = [Resp(200)]
    rc = pc.do_delete(delete_args(out=out, failed=True, private_if_undeletable=True), "k")
    assert rc == 0
    rec = json.loads(out.read_text())
    assert "u2" not in rec                      # deleted -> gone
    assert rec["u1"]["private"] is True         # private -> kept, flagged
    assert rec["u3"] == {"guid": "ok", "capture": "success"}  # captured -> untouched


# --- main() ---------------------------------------------------------------------------------------

def run(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["permacc.py", *argv])
    return pc.main()


def test_main_rejects_unknown_command(monkeypatch, capsys):
    with pytest.raises(SystemExit) as e:
        run(monkeypatch, "explode", "--api-key", "k")
    assert e.value.code == 2 and "invalid choice" in capsys.readouterr().err


def test_main_without_key_refuses_before_any_request(monkeypatch, net):
    with pytest.raises(SystemExit) as e:
        run(monkeypatch, "status")
    assert "no key" in str(e.value.code) and net.calls == []


def test_main_archive_no_urls_refuses(monkeypatch, net):
    with pytest.raises(SystemExit) as e:
        run(monkeypatch, "archive", "--api-key", "k")
    assert "no URLs" in str(e.value.code) and net.calls == []


def test_main_verify_requires_out_file(monkeypatch, net, tmp_path):
    with pytest.raises(SystemExit) as e:
        run(monkeypatch, "verify", "--api-key", "k", "--out", str(tmp_path / "absent.json"))
    assert "verify needs --out" in str(e.value.code)


def test_main_status_prints_name_and_sponsored_folder(monkeypatch, net, capsys):
    net.answers["get"] = [Resp(200, USER)]
    assert run(monkeypatch, "status", "--api-key", "k") == 0
    out = capsys.readouterr().out
    assert "Ed" in out and "sponsored folder: 376861" in out


def test_main_status_warns_when_unsponsored(monkeypatch, net, capsys):
    net.answers["get"] = [Resp(200, {"full_name": "Ed", "top_level_folders": []})]
    run(monkeypatch, "status", "--api-key", "k")
    assert "NONE" in capsys.readouterr().out


def test_main_folders_labels_sponsored_and_personal(monkeypatch, net, capsys):
    net.answers["get"] = [Resp(200, USER)]
    assert run(monkeypatch, "folders", "--api-key", "k") == 0
    out = capsys.readouterr().out
    assert "[SPONSORED] id=376861" in out and "[personal ] id=1" in out


def test_main_archive_dry_run_dedupes_and_makes_no_post(monkeypatch, net, capsys):
    assert run(monkeypatch, "archive", "http://a/", "http://a/", "http://b/",
               "--api-key", "k", "--dry-run", "--folder", "5") == 0
    out = capsys.readouterr().out
    assert "2 URLs" in out and out.count("would archive") == 2 and net.calls == []


def test_main_archive_from_json_accepts_inventory_and_bare_list(monkeypatch, net, tmp_path, capsys):
    inv = tmp_path / "inv.json"
    inv.write_text(json.dumps({"url_inventory": [{"url": "http://a/", "fn_id": 3}, {"url": "http://b/"}]}))
    run(monkeypatch, "archive", "--from-json", str(inv), "--api-key", "k", "--dry-run", "--folder", "1")
    assert "2 URLs" in capsys.readouterr().out
    inv.write_text(json.dumps(["http://a/", "http://c/", "http://d/"]))
    run(monkeypatch, "archive", "--from-json", str(inv), "--api-key", "k", "--dry-run", "--folder", "1")
    assert "3 URLs" in capsys.readouterr().out


def test_main_archive_warns_without_folder(monkeypatch, net, capsys):
    run(monkeypatch, "archive", "http://a/", "--api-key", "k", "--dry-run")
    assert "PERSONAL quota" in capsys.readouterr().err


def test_main_archive_auto_folder_resolves_sponsored(monkeypatch, net, capsys):
    net.answers["get"] = [Resp(200, USER)]
    run(monkeypatch, "archive", "http://a/", "--api-key", "k", "--dry-run", "--auto-folder")
    assert "auto-folder: 376861" in capsys.readouterr().out


def test_main_archive_end_to_end_records_capture_and_skips_done(monkeypatch, net, tmp_path, capsys):
    out = tmp_path / "rec.json"
    out.write_text(json.dumps({"http://done/": {"guid": "OLD", "capture": "success"}}))
    net.answers["post"] = [Resp(201, {"guid": "NEW1"}), Resp(201, {"guid": "NEW2"})]
    net.answers["get"] = lambda url, **kw: cap("success" if "NEW1" in url else "failed")
    rc = run(monkeypatch, "archive", "http://done/", "http://a/", "http://b/",
             "--api-key", "k", "--folder", "7", "--out", str(out), "--delay", "0")
    assert rc == 1  # NEW2's capture failed
    rec = json.loads(out.read_text())
    assert rec["http://done/"]["guid"] == "OLD"
    assert rec["http://a/"] == {"guid": "NEW1", "perma_url": "https://perma.cc/NEW1", "capture": "success"}
    assert rec["http://b/"]["capture"] == "failed"
    posts = [c for c in net.calls if c[0] == "post"]
    assert len(posts) == 2 and all(c[2]["json"]["folder"] == 7 for c in posts)
    assert "cite the live URL" in capsys.readouterr().err


def test_main_archive_no_verify_skips_capture_polling(monkeypatch, net, capsys):
    net.answers["post"] = [Resp(201, {"guid": "G1"})]
    assert run(monkeypatch, "archive", "http://a/", "--api-key", "k", "--folder", "7",
               "--no-verify") == 0
    assert not [c for c in net.calls if c[0] == "get"]


def test_main_archive_api_error_counts_failure_and_continues(monkeypatch, net, capsys):
    net.answers["post"] = [Resp(500, text="x"), Resp(201, {"guid": "G2"})]
    rc = run(monkeypatch, "archive", "http://a/", "http://b/", "--api-key", "k", "--folder", "7",
             "--no-verify", "--delay", "0")
    assert rc == 1 and "https://perma.cc/G2" in capsys.readouterr().out


def test_main_verify_marks_failures_nonzero(monkeypatch, net, tmp_path):
    out = tmp_path / "rec.json"
    out.write_text(json.dumps({"u1": {"guid": "A"}, "u2": {"guid": "B"}}))
    net.answers["get"] = lambda url, **kw: cap("success" if url.rstrip("/").endswith("A") else "failed")
    assert run(monkeypatch, "verify", "--api-key", "k", "--out", str(out)) == 1
    rec = json.loads(out.read_text())
    assert rec["u1"]["capture"] == "success" and rec["u2"]["capture"] == "failed"
