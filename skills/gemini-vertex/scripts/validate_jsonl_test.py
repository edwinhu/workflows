"""Contract tests for validate_jsonl.py (function and CLI)."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate_jsonl import validate_jsonl  # noqa: E402

SCRIPT = Path(__file__).parent / "validate_jsonl.py"


def req(text="hi", **extra):
    return {"request": {"contents": [{"parts": [{"text": text}]}]}, **extra}


def write(tmp_path, rows):
    f = tmp_path / "r.jsonl"
    f.write_text("\n".join(r if isinstance(r, str) else json.dumps(r) for r in rows) + "\n")
    return str(f)


def cli(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)


def test_cloud_valid_rows_need_no_key(tmp_path):
    assert validate_jsonl(write(tmp_path, [req("a"), req("b")]), "cloud") == (True, [])


def test_developer_requires_nonempty_key(tmp_path):
    ok, errs = validate_jsonl(write(tmp_path, [req("a"), req("b", key="")]), "developer")
    assert not ok
    assert errs == ["Line 1: Missing nonempty key", "Line 2: Missing nonempty key"]


def test_developer_duplicate_key(tmp_path):
    ok, errs = validate_jsonl(write(tmp_path, [req("a", key="k"), req("b", key="k")]), "developer")
    assert errs == ["Line 2: Duplicate request ID 'k'"]


def test_cloud_duplicate_request_body(tmp_path):
    ok, errs = validate_jsonl(write(tmp_path, [req("same"), req("same")]), "cloud")
    assert not ok and len(errs) == 1
    assert errs[0].startswith("Line 2: Duplicate request ID ")


def test_invalid_json_and_empty_line_and_missing_request(tmp_path):
    ok, errs = validate_jsonl(write(tmp_path, ["{nope", "", {"x": 1}]), "cloud")
    assert errs[0].startswith("Line 1: Invalid JSON - ")
    assert errs[1] == "Line 2: Empty line"
    assert errs[2] == "Line 3: Missing 'request' object"


def test_missing_or_empty_contents_and_parts(tmp_path):
    rows = [{"request": {"contents": []}}, {"request": {}},
            {"request": {"contents": [{"role": "user"}]}}]
    _, errs = validate_jsonl(write(tmp_path, rows), "cloud")
    assert errs == ["Line 1: Missing or empty contents array",
                    "Line 2: Missing or empty contents array",
                    "Line 3: Content requires parts array"]


def media(uri, key="fileData"):
    return {"request": {"contents": [{"parts": [{key: {"fileUri": uri}}]}]}}


def test_cloud_media_uri_must_be_gs(tmp_path):
    f = write(tmp_path, [media("gs://b/x.pdf"), media("https://h/x.pdf")])
    ok, errs = validate_jsonl(f, "cloud")
    assert errs == ["Line 2: Invalid cloud file URI: https://h/x.pdf"]


def test_developer_media_uri_must_be_https_or_files(tmp_path):
    rows = [dict(media("files/abc"), key="1"), dict(media("https://h/x"), key="2"),
            dict(media("gs://b/x"), key="3")]
    ok, errs = validate_jsonl(write(tmp_path, rows), "developer")
    assert errs == ["Line 3: Invalid developer file URI: gs://b/x"]


def test_snake_case_file_data_accepted(tmp_path):
    row = {"request": {"contents": [{"parts": [{"file_data": {"file_uri": "gs://b/x"}}]}]}}
    assert validate_jsonl(write(tmp_path, [row]), "cloud") == (True, [])


def test_empty_file_is_valid(tmp_path):
    f = tmp_path / "e.jsonl"
    f.write_text("")
    assert validate_jsonl(str(f)) == (True, [])


def test_unknown_backend_raises(tmp_path):
    try:
        validate_jsonl(write(tmp_path, [req()]), "bogus")
    except ValueError as e:
        assert str(e) == "Unknown backend: bogus"
    else:
        raise AssertionError("expected ValueError")


def test_cli_valid_exit_0(tmp_path):
    p = cli(write(tmp_path, [req()]))
    assert p.returncode == 0 and p.stdout == "Valid JSONL\n"


def test_cli_invalid_exit_1_with_messages(tmp_path):
    p = cli(write(tmp_path, [req("a")]), "--backend", "developer")
    assert p.returncode == 1
    assert p.stdout == "ERROR: Line 1: Missing nonempty key\nValidation failed: 1 error(s)\n"


def test_cli_missing_file_is_usage_error(tmp_path):
    p = cli(str(tmp_path / "nope.jsonl"))
    assert p.returncode == 2
    assert "File not found" in p.stderr
