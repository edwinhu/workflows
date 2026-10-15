"""Contract tests for bulk_fetch.py: streaming, filtering and CLI refusals, with the S3 boundary stubbed."""

import bz2
import csv
import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bulk_fetch as bf


class FakeResp(io.BytesIO):
    """A urlopen() response: readable and a context manager."""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def bz2_csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return bz2.compress(buf.getvalue().encode())


@pytest.fixture
def no_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network call attempted")

    monkeypatch.setattr(bf.urllib.request, "urlopen", boom)


def serve(monkeypatch, payloads):
    """Stub bf._open: url suffix -> bytes. Records requested URLs."""
    seen = []

    def fake(url):
        seen.append(url)
        for suffix, data in payloads.items():
            if url.endswith(suffix) or suffix in url:
                return FakeResp(data)
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(bf, "_open", fake)
    return seen


def test_open_sends_declared_user_agent(monkeypatch):
    got = {}

    def fake_urlopen(req):
        got["ua"] = req.get_header("User-agent")
        got["url"] = req.full_url
        return FakeResp(b"")

    monkeypatch.setattr(bf.urllib.request, "urlopen", fake_urlopen)
    bf._open("https://example.invalid/x")
    assert got["ua"] == bf.UA and got["url"] == "https://example.invalid/x"


def test_stream_csv_yields_dict_rows_and_handles_quoted_commas(monkeypatch):
    data = bz2_csv(["id", "name"], [["1", "Smith, J."], ["2", "Doe"]])
    serve(monkeypatch, {"x.csv.bz2": data})
    rows = list(bf._stream_csv("http://h/x.csv.bz2"))
    assert rows == [{"id": "1", "name": "Smith, J."}, {"id": "2", "name": "Doe"}]


def test_stream_csv_keeps_last_row_without_trailing_newline(monkeypatch):
    data = bz2.compress(b"id,v\n1,a\n2,b")
    serve(monkeypatch, {"x.csv.bz2": data})
    assert [r["id"] for r in bf._stream_csv("http://h/x.csv.bz2")] == ["1", "2"]


def test_stream_csv_skips_blank_lines(monkeypatch):
    serve(monkeypatch, {"x.csv.bz2": bz2.compress(b"id\n1\n\n2\n")})
    assert [r["id"] for r in bf._stream_csv("http://h/x.csv.bz2")] == ["1", "2"]


def test_list_reports_latest_snapshot_per_dataset(monkeypatch, capsys):
    xml = (
        "<Key>bulk-data/opinions-2025-01-01.csv.bz2</Key><Size>1000000000</Size>"
        "<Key>bulk-data/opinions-2026-06-30.csv.bz2</Key><Size>54000000000</Size>"
        "<Key>bulk-data/courts-2026-06-30.csv.bz2</Key><Size>5000</Size>"
        "<Key>bulk-data/schema.sql</Key><Size>10</Size>"
    )
    serve(monkeypatch, {"prefix=bulk-data/": xml.encode()})
    assert bf.cmd_list(None) == 0
    out = capsys.readouterr().out
    assert "opinions" in out and "latest 2026-06-30" in out and "54.00 GB" in out
    assert "2025-01-01" not in out and "schema" not in out
    assert out.index("courts") < out.index("opinions")  # sorted by name


def run_clusters(monkeypatch, tmp_path, rows, **kw):
    seen = serve(monkeypatch, {"opinion-clusters-2026-06-30.csv.bz2": bz2_csv(
        ["id", "court_id", "date_filed"], rows)})
    out = tmp_path / "c.csv"
    ns = bf.argparse.Namespace(date="2026-06-30", court=None, after=None, before=None,
                               out=str(out), **kw)
    return bf.cmd_clusters(ns), out, seen


def test_clusters_filters_by_court_and_date_window(monkeypatch, tmp_path):
    rows = [["1", "delch", "2011-12-31"], ["2", "delch", "2012-06-01"],
            ["3", "scotus", "2012-06-01"], ["4", "delch", "2020-01-01"]]
    rc, out, seen = run_clusters(monkeypatch, tmp_path, rows)
    assert rc == 0 and len(seen) == 1
    # no filters keeps everything
    assert len(list(csv.DictReader(open(out)))) == 4
    ns = bf.argparse.Namespace(date="2026-06-30", court="delch", after="2012-01-01",
                               before="2019-12-31", out=str(out))
    assert bf.cmd_clusters(ns) == 0
    assert [r["id"] for r in csv.DictReader(open(out))] == ["2"]


def test_clusters_exit_1_when_nothing_kept(monkeypatch, tmp_path, capsys):
    ns_rows = [["1", "scotus", "2012-06-01"]]
    serve(monkeypatch, {"opinion-clusters-": bz2_csv(["id", "court_id", "date_filed"], ns_rows)})
    ns = bf.argparse.Namespace(date="2026-06-30", court="delch", after=None, before=None,
                               out=str(tmp_path / "c.csv"))
    assert bf.cmd_clusters(ns) == 1
    assert "kept 0" in capsys.readouterr().out


def test_clusters_url_embeds_snapshot_date(monkeypatch, tmp_path):
    _, _, seen = run_clusters(monkeypatch, tmp_path, [["1", "delch", "2020-01-01"]])
    assert seen == [f"{bf.BASE}/bulk-data/opinion-clusters-2026-06-30.csv.bz2"]


def test_opinions_keeps_only_matching_cluster_ids(monkeypatch, tmp_path):
    cl = tmp_path / "cl.csv"
    cl.write_text("id,court_id\n10,delch\n30,delch\n")
    serve(monkeypatch, {"opinions-2026-06-30.csv.bz2": bz2_csv(
        ["id", "cluster_id", "plain_text"],
        [["a", "10", "t1"], ["b", "20", "t2"], ["c", "30", "t3"]])})
    out = tmp_path / "o.csv"
    ns = bf.argparse.Namespace(date="2026-06-30", clusters=str(cl), out=str(out))
    assert bf.cmd_opinions(ns) == 0
    assert [r["id"] for r in csv.DictReader(open(out))] == ["a", "c"]


def test_opinions_exit_1_when_no_cluster_matches(monkeypatch, tmp_path):
    cl = tmp_path / "cl.csv"
    cl.write_text("id\n99\n")
    serve(monkeypatch, {"opinions-": bz2_csv(["id", "cluster_id"], [["a", "1"]])})
    ns = bf.argparse.Namespace(date="d", clusters=str(cl), out=str(tmp_path / "o.csv"))
    assert bf.cmd_opinions(ns) == 1


@pytest.mark.parametrize("argv", [[], ["clusters"], ["clusters", "--date", "2026-01-01"],
                                  ["opinions", "--date", "x", "--out", "o"], ["bogus"]])
def test_main_refuses_bad_arguments(monkeypatch, no_network, argv, capsys):
    monkeypatch.setattr(sys, "argv", ["bulk_fetch.py", *argv])
    with pytest.raises(SystemExit) as e:
        bf.main()
    assert e.value.code == 2
    err = capsys.readouterr().err
    assert "required" in err or "invalid choice" in err


def test_main_dispatches_clusters_with_parsed_args(monkeypatch):
    got = {}
    monkeypatch.setattr(bf, "cmd_clusters", lambda a: got.update(vars(a)) or 0)
    monkeypatch.setattr(sys, "argv", ["bulk_fetch.py", "clusters", "--date", "2026-06-30",
                                      "--court", "delch", "--after", "2012-01-01", "--out", "o.csv"])
    assert bf.main() == 0
    assert got["court"] == "delch" and got["after"] == "2012-01-01" and got["before"] is None
