"""Offline tests for edgar_filing.py: synthetic SGML, a stub psql on PATH, no network."""
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import edgar_filing as ef  # noqa: E402

SCRIPT = HERE / "edgar_filing.py"
ACC = "0001104659-20-000437"


def doc(type_, filename, body, seq=1, desc=None, nl="\n"):
    lines = ["<DOCUMENT>", f"<TYPE>{type_}", f"<SEQUENCE>{seq}", f"<FILENAME>{filename}"]
    if desc is not None:
        lines.append(f"<DESCRIPTION>{desc}")
    lines += ["<TEXT>", body, "</TEXT>", "</DOCUMENT>"]
    return nl.join(lines).encode() + nl.encode()


HEADER = b"<SEC-HEADER>0001104659-20-000437.hdr.sgml\nCONFORMED SUBMISSION TYPE: 8-K\n</SEC-HEADER>\n"


def filing(*docs):
    return HEADER + b"".join(docs)


# ── paths ─────────────────────────────────────────────────────────────────────────────────────
def test_rel_path_pads_short_cik():
    assert ef.rel_path(1034196, ACC) == f"000103/1034196/{ACC}.txt"
    assert ef.rel_path("1034196", ACC) == f"000103/1034196/{ACC}.txt"


def test_rel_path_short_cik_prefix_is_zero_padded():
    assert ef.rel_path(320193, "0000320193-20-000096") == "000032/320193/0000320193-20-000096.txt"
    assert ef.rel_path(5, ACC) == f"000000/5/{ACC}.txt"


def test_rel_path_ten_digit_cik_and_leading_zeros():
    assert ef.rel_path("0001034196", ACC) == f"000103/1034196/{ACC}.txt"
    assert ef.rel_path("9999999999", ACC) == f"999999/9999999999/{ACC}.txt"


def test_rel_path_undashed_accession():
    assert ef.rel_path(1034196, "000110465920000437") == f"000103/1034196/{ACC}.txt"


@pytest.mark.parametrize("bad", [
    "", "0001104659-20-00043", "0001104659-20-0004370", "000110465920000437 ", "0001104659-20-000437\n",
    "0001104659_20_000437", "'; DROP TABLE x;--", "0001104659-20-000437' OR '1'='1",
    "0001104659-20-000437;", "０００１１０４６５９２００００４３７", "abc",
])
def test_rel_path_rejects_bad_accession(bad):
    with pytest.raises(ValueError):
        ef.rel_path(1034196, bad)


@pytest.mark.parametrize("bad", ["", "abc", "-1", "12345678901", 12345678901, -5, 1.5, None, True, "1 2"])
def test_rel_path_rejects_bad_cik(bad):
    with pytest.raises(ValueError):
        ef.rel_path(bad, ACC)


def test_rclone_path_roots():
    rel = f"000103/1034196/{ACC}.txt"
    assert ef.rclone_path(1034196, ACC) == f"wrds:/wrds/sec/archives/{rel}"
    assert ef.rclone_path(1034196, ACC, clean=True) == f"wrds:/wrds/sec/wrds_clean_filings/{rel}"


# ── resolve (injected query) ──────────────────────────────────────────────────────────────────
def A(n):
    return f"0001234567-20-{n:06d}"


def fake(rows):
    calls = []

    def query(accessions):
        calls.append(list(accessions))
        want = set(accessions)
        return [r for r in rows if r[0] in want]
    query.calls = calls
    return query


def test_resolve_prefers_same_cik_on_multi_filer_accession():
    rows = [(ACC, "0000000005", f"000000/5/{ACC}.txt"), (ACC, "0001034196", f"000103/1034196/{ACC}.txt"),
            (ACC, "0000000002", f"000000/2/{ACC}.txt")]
    r, = ef.resolve([("1034196", ACC)], query=fake(rows))
    assert (r.wrdsfname, r.status) == (f"000103/1034196/{ACC}.txt", "ok")


def test_resolve_cik_matches_numerically_not_textually():
    rows = [(ACC, "0001034196", f"000103/1034196/{ACC}.txt")]
    for cik in (1034196, "1034196", "0001034196"):
        assert ef.resolve([(cik, ACC)], query=fake(rows))[0].status == "ok"


def test_resolve_wrong_cik_relocates_to_first_sorted():
    rows = [(ACC, "0000000009", f"000000/9/{ACC}.txt"), (ACC, "0000000003", f"000000/3/{ACC}.txt")]
    r, = ef.resolve([("1034196", ACC)], query=fake(rows))
    assert (r.wrdsfname, r.status) == (f"000000/3/{ACC}.txt", "relocated")


def test_resolve_accession_only_takes_first_sorted():
    rows = [(ACC, "0000000009", f"000000/9/{ACC}.txt"), (ACC, "0000000003", f"000000/3/{ACC}.txt")]
    r, = ef.resolve([(None, ACC)], query=fake(rows))
    assert (r.wrdsfname, r.status) == (f"000000/3/{ACC}.txt", "ok")


def test_resolve_missing():
    r, = ef.resolve([("1", A(1))], query=fake([]))
    assert (r.wrdsfname, r.status) == (None, "missing")


def test_resolve_one_result_per_pair_in_order_and_normalises_accession():
    rows = [(A(1), "0000000001", f"000000/1/{A(1)}.txt"), (A(2), "0000000002", f"000000/2/{A(2)}.txt")]
    pairs = [(2, A(2).replace("-", "")), (None, A(1)), (7, A(3)), (2, A(2))]
    out = ef.resolve(pairs, query=fake(rows))
    assert [(r.accession, r.wrdsfname, r.status) for r in out] == [
        (A(2), f"000000/2/{A(2)}.txt", "ok"), (A(1), f"000000/1/{A(1)}.txt", "ok"), (A(3), None, "missing"),
        (A(2), f"000000/2/{A(2)}.txt", "ok")]


def test_resolve_chunks_and_never_queries_per_accession():
    n = 12_001
    pairs = [(None, A(i)) for i in range(n)] + [(None, A(0))]  # a duplicate is queried once
    q = fake([])
    out = ef.resolve(pairs, query=q)
    assert len(out) == n + 1
    assert [len(c) for c in q.calls] == [5000, 5000, 2001]
    assert sum(len(c) for c in q.calls) == n


def test_resolve_rejects_invalid_accession_before_querying():
    q = fake([])
    with pytest.raises(ValueError):
        ef.resolve([(1, "nope")], query=q)
    assert q.calls == []


@pytest.mark.parametrize("cik", ["", "abc", None, " "])
def test_resolve_bad_cik_in_query_row_is_query_error(cik):
    with pytest.raises(ef.QueryError):
        ef.resolve([(1, ACC)], query=lambda accs: [(ACC, cik, f"000000/1/{ACC}.txt")])


@pytest.mark.parametrize("fname", [
    f"/000000/1/{ACC}.txt", f"../000000/1/{ACC}.txt", f"000000/../1/{ACC}.txt",
    f"000000/1/../{ACC}.txt", f"000000/1/{ACC}.txt/..", "x.txt", "a/3", "", None,
    f"00000/1/{ACC}.txt", f"000000/x/{ACC}.txt", f"000000/1/{ACC}.html",
    f"000000/1/{ACC}.txt\n", f"000000/1/x/{ACC}.txt"])
def test_resolve_bad_wrdsfname_in_query_row_is_query_error(fname):
    with pytest.raises(ef.QueryError):
        ef.resolve([(1, ACC)], query=lambda accs: [(ACC, "0000000001", fname)])


@pytest.mark.parametrize("fname", [f"000000/1/{ACC}.txt", "000103/1034196/000110465920000437.txt"])
def test_resolve_accepts_well_formed_wrdsfname(fname):
    r, = ef.resolve([(1, ACC)], query=lambda accs: [(ACC, "0000000001", fname)])
    assert r.wrdsfname == fname


def test_fetch_never_escapes_dest_on_injected_traversal(tmp_path):
    with pytest.raises(ef.QueryError):
        ef.fetch_round([(1, ACC)], tmp_path,
                       query=lambda accs: [(ACC, "0000000001", "../../evil.txt")], copy=lambda argv: None)


def test_resolve_propagates_query_failure():
    def boom(accessions):
        raise ef.QueryError("psql exploded")
    with pytest.raises(ef.QueryError):
        ef.resolve([(1, ACC)], query=boom)


# ── default query: stub psql on PATH ──────────────────────────────────────────────────────────
@pytest.fixture
def stub(tmp_path, monkeypatch):
    bindir, state = tmp_path / "bin", tmp_path / "state"
    bindir.mkdir()
    state.mkdir()
    (state / "out").write_text("")
    (state / "rc").write_text("0")
    psql = bindir / "psql"
    psql.write_text(
        "#!/bin/sh\n"
        f'S="{state}"\n'
        'cat > "$S/stdin"\n'
        'printf "%s\\n" "$@" > "$S/argv"\n'
        'printf "%s" "$PGSSLMODE" > "$S/sslmode"\n'
        'cat "$S/out"\n'
        'echo "psql: stub stderr" >&2\n'
        'exit "$(cat "$S/rc")"\n')
    psql.chmod(psql.stat().st_mode | stat.S_IEXEC)
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("PGUSER", raising=False)

    class S:
        dir, home_dir = state, home

        def set(self, out="", rc=0):
            (state / "out").write_text(out)
            (state / "rc").write_text(str(rc))

        def read(self, name):
            return (state / name).read_text()
    return S()


def test_default_query_sends_sql_on_stdin_and_parses_rows(stub, monkeypatch):
    monkeypatch.setenv("PGUSER", "alice")
    stub.set(f"{ACC}\t0001034196\t000103/1034196/{ACC}.txt\n")
    rows = ef.psql_query([ACC, A(1)])
    assert rows == [(ACC, "0001034196", f"000103/1034196/{ACC}.txt")]
    sql, argv = stub.read("stdin"), stub.read("argv")
    assert f"'{ACC}'" in sql and f"'{A(1)}'" in sql
    assert "wrdssec_all.wrds_forms" in sql and "wrdsfname IS NOT NULL" in sql
    assert ACC not in argv and "SELECT" not in argv  # nothing bulky in argv
    for flag in ("-X", "-A", "-t", "ON_ERROR_STOP=1", "wrds-pgdata.wharton.upenn.edu", "9737", "wrds", "alice"):
        assert flag in argv.split("\n"), flag
    assert stub.read("sslmode") == "require"


def test_default_query_user_from_pgpass(stub):
    (stub.home_dir / ".pgpass").write_text(
        "# comment\nother.host:5432:db:wrongone:pw\n"
        "wrds-pgdata.wharton.upenn.edu:9737:wrds:bob:secret\nwrds-pgdata.wharton.upenn.edu:9737:wrds:second:pw\n")
    ef.psql_query([ACC])
    assert "bob" in stub.read("argv").split("\n")
    assert "wrongone" not in stub.read("argv")


def test_default_query_no_user_raises(stub):
    with pytest.raises(ef.QueryError, match="user"):
        ef.psql_query([ACC])


def test_default_query_nonzero_exit_raises_with_stderr(stub, monkeypatch):
    monkeypatch.setenv("PGUSER", "alice")
    stub.set("", rc=2)
    with pytest.raises(ef.QueryError, match="stub stderr"):
        ef.psql_query([ACC])


def test_failed_query_never_reads_as_missing(stub, monkeypatch):
    monkeypatch.setenv("PGUSER", "alice")
    stub.set("", rc=2)
    with pytest.raises(ef.QueryError):
        ef.resolve([(1, ACC)])


def test_default_query_rejects_bad_accession_without_running_psql(stub, monkeypatch):
    monkeypatch.setenv("PGUSER", "alice")
    with pytest.raises(ValueError):
        ef.psql_query(["x'); DROP TABLE y;--"])
    assert not (stub.dir / "stdin").exists()


def test_default_query_garbled_row_raises(stub, monkeypatch):
    monkeypatch.setenv("PGUSER", "alice")
    stub.set("only-one-column\n")
    with pytest.raises(ef.QueryError):
        ef.psql_query([ACC])


# ── documents / extract ───────────────────────────────────────────────────────────────────────
SGML = filing(
    doc("8-K", "d1d8k.htm", "<html>main</html>", 1, "FORM 8-K"),
    doc("EX-3.1", "d1dex31.htm", "charter text\nline2", 2, "Charter"),
    doc("EX-10.10", "d1dex1010.htm", "ten", 3),
    doc("EX-10.1", "d1dex101.htm", "one", 4, "Credit"),
)


def test_documents_fields():
    ds = ef.documents(SGML)
    assert [(d.sequence, d.type, d.filename, d.description) for d in ds] == [
        ("1", "8-K", "d1d8k.htm", "FORM 8-K"), ("2", "EX-3.1", "d1dex31.htm", "Charter"),
        ("3", "EX-10.10", "d1dex1010.htm", ""), ("4", "EX-10.1", "d1dex101.htm", "Credit")]
    assert ds[1].text == b"charter text\nline2\n"  # newline after <TEXT> dropped, the one before </TEXT> kept


def test_extract_by_filename_and_type_case_insensitive():
    assert ef.extract(SGML, filename="D1DEX31.HTM").text == b"charter text\nline2\n"
    assert ef.extract(SGML, doc_type="ex-3.1").filename == "d1dex31.htm"


def test_extract_ex10_1_does_not_match_ex10_10():
    assert ef.extract(SGML, doc_type="EX-10.1").filename == "d1dex101.htm"
    assert ef.extract(SGML, doc_type="EX-10.10").filename == "d1dex1010.htm"


def test_extract_no_match_and_ambiguous_are_distinct():
    with pytest.raises(ef.NoMatchError):
        ef.extract(SGML, doc_type="EX-99")
    dup = filing(doc("EX-10.1", "a.htm", "A", 1), doc("EX-10.1", "b.htm", "B", 2))
    with pytest.raises(ef.AmbiguousError) as e:
        ef.extract(dup, doc_type="EX-10.1")
    assert e.value.filenames == ["a.htm", "b.htm"]
    assert "a.htm" in str(e.value) and "b.htm" in str(e.value)
    assert not issubclass(ef.AmbiguousError, ef.NoMatchError)
    assert ef.extract(dup, doc_type="EX-10.1", filename="b.htm").text == b"B\n"


def test_extract_needs_a_selector():
    with pytest.raises(ValueError):
        ef.extract(SGML)


def test_documents_crlf():
    crlf = filing(doc("EX-3.1", "c.htm", "a\r\nb", 1, "D", nl="\r\n"))
    d, = ef.documents(crlf)
    assert (d.type, d.filename, d.description) == ("EX-3.1", "c.htm", "D")
    assert d.text == b"a\r\nb\r\n"


def test_tags_inside_body_not_at_line_start_are_inert():
    body = "see <TYPE>EX-99 and </TEXT> and <DOCUMENT> inline\n  </TEXT>\n  <DOCUMENT>\nend"
    d, = ef.documents(filing(doc("EX-3.1", "x.htm", body)))
    assert d.text == (body + "\n").encode()
    assert d.type == "EX-3.1"


def test_missing_description_is_empty():
    d, = ef.documents(filing(doc("EX-3.1", "x.htm", "b")))
    assert d.description == ""


def test_truncated_filing_raises():
    full = filing(doc("EX-3.1", "x.htm", "body"))
    for cut in (full.rindex(b"</DOCUMENT>"), full.rindex(b"</TEXT>"), full.index(b"<TEXT>") + 8):
        with pytest.raises(ValueError, match="truncated|unterminated"):
            ef.documents(full[:cut])


def test_non_utf8_bytes_pass_through_unchanged():
    raw = bytes(range(128, 256)) + b"\xff\xfe\x00\r\n\x00end"
    sgml = HEADER + b"<DOCUMENT>\n<TYPE>EX-3.1\n<FILENAME>b.bin\n<TEXT>\n" + raw + b"\n</TEXT>\n</DOCUMENT>\n"
    assert ef.extract(sgml, filename="b.bin").text == raw + b"\n"


def test_documents_none_when_no_document():
    assert ef.documents(HEADER) == []


# ── CLI ───────────────────────────────────────────────────────────────────────────────────────
def run(*args, input=b"", env=None):
    e = {**os.environ, **(env or {})}
    return subprocess.run([sys.executable, str(SCRIPT), *args], input=input, capture_output=True, env=e)


def test_cli_docstring_first_line_is_a_summary():
    first = (ef.__doc__ or "").strip().splitlines()[0]
    assert first and len(first) > 20


def test_cli_path():
    r = run("path", "1034196", ACC)
    assert (r.returncode, r.stdout) == (0, f"wrds:/wrds/sec/archives/000103/1034196/{ACC}.txt\n".encode())
    r = run("path", "1034196", ACC.replace("-", ""), "--clean")
    assert r.stdout == f"wrds:/wrds/sec/wrds_clean_filings/000103/1034196/{ACC}.txt\n".encode()


def test_cli_path_bad_input_exit_2():
    r = run("path", "1034196", "bogus")
    assert r.returncode == 2 and r.stdout == b"" and r.stderr


def test_cli_bad_arguments_exit_2():
    assert run().returncode == 2
    assert run("nope").returncode == 2
    assert run("extract", "-").returncode == 2  # no selector
    assert run("extract", "-", "--list", "--type", "X").returncode == 2


@pytest.fixture
def sgml_file(tmp_path):
    p = tmp_path / "f.txt"
    p.write_bytes(SGML)
    return p


def test_cli_extract_list(sgml_file):
    r = run("extract", str(sgml_file), "--list")
    assert r.returncode == 0
    lines = r.stdout.decode().splitlines()
    assert lines[0] == "1\t8-K\td1d8k.htm\tFORM 8-K"
    assert lines[2] == "3\tEX-10.10\td1dex1010.htm\t"
    assert len(lines) == 4


def test_cli_extract_by_filename_type_and_stdin(sgml_file):
    assert run("extract", str(sgml_file), "--filename", "d1dex31.htm").stdout == b"charter text\nline2\n"
    assert run("extract", str(sgml_file), "--type", "ex-10.1").stdout == b"one\n"
    r = run("extract", "-", "--type", "EX-3.1", input=SGML)
    assert (r.returncode, r.stdout) == (0, b"charter text\nline2\n")


def test_cli_extract_exit_codes(sgml_file, tmp_path):
    r = run("extract", str(sgml_file), "--type", "EX-99")
    assert (r.returncode, r.stdout) == (3, b"")
    dup = tmp_path / "dup.txt"
    dup.write_bytes(filing(doc("EX-10.1", "a.htm", "A", 1), doc("EX-10.1", "b.htm", "B", 2)))
    r = run("extract", str(dup), "--type", "EX-10.1")
    assert (r.returncode, r.stdout) == (4, b"")
    assert b"a.htm" in r.stderr and b"b.htm" in r.stderr
    trunc = tmp_path / "t.txt"
    trunc.write_bytes(SGML[:-30])
    assert run("extract", str(trunc), "--list").returncode == 2
    assert run("extract", str(tmp_path / "absent.txt"), "--list").returncode == 2


def stub_rows(stub, monkeypatch, rows):
    monkeypatch.setenv("PGUSER", "alice")
    stub.set("".join("\t".join(r) + "\n" for r in rows))


def test_cli_resolve_stdout_only_unique_paths_in_input_order(stub, monkeypatch):
    stub_rows(stub, monkeypatch, [(A(2), "0000000002", f"000000/2/{A(2)}.txt"), (A(1), "0000000001", f"000000/1/{A(1)}.txt"),
                      (A(9), "0000000007", f"000000/7/{A(9)}.txt")])
    text = f"2 {A(2)}\n\n1,{A(1)}\n{A(2)}\n7\t{A(9)}\n3 {A(9)}\n"
    r = run("resolve", "-", input=text.encode())
    assert r.returncode == 0
    assert r.stdout == f"000000/2/{A(2)}.txt\n000000/1/{A(1)}.txt\n000000/7/{A(9)}.txt\n".encode()
    err = r.stderr.decode().splitlines()
    assert len(err) == 1 and "relocated" in err[0] and A(9) in err[0] and "3" in err[0]


@pytest.mark.parametrize("row", [(A(1), "", f"000000/1/{A(1)}.txt"), (A(1), "0000000001", "../../evil.txt")])
def test_cli_resolve_bad_query_row_is_exit_1_not_2(stub, monkeypatch, row):
    stub_rows(stub, monkeypatch, [row])
    r = run("resolve", "-", input=f"1 {A(1)}\n".encode())
    assert (r.returncode, r.stdout) == (1, b"") and b"query failed" in r.stderr


def test_cli_resolve_missing_exit_3_still_prints_found(stub, monkeypatch, tmp_path):
    stub_rows(stub, monkeypatch, [(A(1), "0000000001", f"000000/1/{A(1)}.txt")])
    f = tmp_path / "pairs.tsv"
    f.write_text(f"1 {A(1)}\n1 {A(5)}\n")
    r = run("resolve", str(f))
    assert (r.returncode, r.stdout) == (3, f"000000/1/{A(1)}.txt\n".encode())
    err = r.stderr.decode().splitlines()
    assert len(err) == 1 and "missing" in err[0] and A(5) in err[0]


def test_cli_resolve_invalid_line_exit_2(stub, monkeypatch):
    stub_rows(stub, monkeypatch, [])
    assert run("resolve", "-", input=b"1 2 3\n").returncode == 2
    assert run("resolve", "-", input=b"1 not-an-accession\n").returncode == 2


def test_cli_resolve_failed_query_exit_1_not_missing(stub, monkeypatch):
    monkeypatch.setenv("PGUSER", "alice")
    stub.set("", rc=2)
    r = run("resolve", "-", input=f"1 {ACC}\n".encode())
    assert r.returncode == 1 and r.stdout == b"" and b"stub stderr" in r.stderr


# ── fetch_round / fetch_rounds (injected query and copy; stub rclone for the default copy) ────────
def rows_for(*ns):
    return [(A(n), f"{n:010d}", f"000000/{n}/{A(n)}.txt") for n in ns]


def fake_copy(skip=(), fail=None):
    calls = []

    def copy(argv):
        calls.append(list(argv))
        if fail:
            raise ef.CopyError(fail)
        listed = Path(argv[argv.index("--files-from") + 1]).read_text().splitlines()
        calls[-1].append(listed)  # the list's content, read while the temp file still exists
        for rel in listed:
            if not any(s in rel for s in skip):
                p = Path(argv[3]) / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("body " + rel)
    copy.calls = calls
    return copy


def test_fetch_round_one_copy_with_n_lines_and_exact_argv(tmp_path):
    cp = fake_copy()
    out = ef.fetch_round([(n, A(n)) for n in (1, 2, 3)] + [(1, A(1))], tmp_path, query=fake(rows_for(1, 2, 3)), copy=cp)
    assert len(cp.calls) == 1
    argv, listed = cp.calls[0][:-1], cp.calls[0][-1]
    assert argv[:2] == ["rclone", "copy"]
    assert argv[2:4] == ["wrds:/wrds/sec/archives", f"{tmp_path}/archives"]
    assert argv[4] == "--files-from" and argv[6:] == ["--transfers", "8", "--no-traverse", "--log-level", "ERROR",
                         "--ignore-checksum"]
    assert listed == [f"000000/{n}/{A(n)}.txt" for n in (1, 2, 3)]  # de-duplicated
    assert out == [f"{tmp_path}/archives/000000/{n}/{A(n)}.txt" for n in (1, 2, 3, 1)]
    assert not Path(argv[5]).exists()  # temp list removed


def test_fetch_round_skips_cached_and_all_cached_makes_no_call(tmp_path):
    q, cp = fake(rows_for(1, 2)), fake_copy()
    ef.fetch_round([(1, A(1))], tmp_path, query=q, copy=cp)
    ef.fetch_round([(1, A(1)), (2, A(2))], tmp_path, query=q, copy=cp)
    assert [c[-1] for c in cp.calls] == [[f"000000/1/{A(1)}.txt"], [f"000000/2/{A(2)}.txt"]]
    ef.fetch_round([(1, A(1)), (2, A(2))], tmp_path, query=q, copy=cp)
    assert len(cp.calls) == 2


def test_fetch_round_empty_cached_file_is_copied_again(tmp_path):
    p = tmp_path / "archives" / "000000" / "1" / f"{A(1)}.txt"
    p.parent.mkdir(parents=True)
    p.write_text("")
    cp = fake_copy()
    assert ef.fetch_round([(1, A(1))], tmp_path, query=fake(rows_for(1)), copy=cp) == [str(p)]
    assert len(cp.calls) == 1


def test_fetch_round_silently_skipped_and_unknown_are_none(tmp_path):
    cp = fake_copy(skip=(A(2),))
    out = ef.fetch_round([(1, A(1)), (2, A(2)), (3, A(3))], tmp_path, query=fake(rows_for(1, 2)), copy=cp)
    assert out[0] and out[1] is None and out[2] is None
    assert cp.calls[0][-1] == [f"000000/{n}/{A(n)}.txt" for n in (1, 2)]  # the unknown one is never listed


def test_fetch_round_copy_failure_raises_with_stderr(tmp_path):
    with pytest.raises(ef.CopyError, match="boom"):
        ef.fetch_round([(1, A(1))], tmp_path, query=fake(rows_for(1)), copy=fake_copy(fail="boom"))


def test_fetch_round_raw_and_clean_never_share_a_path(tmp_path):
    cp = fake_copy()
    raw, = ef.fetch_round([(1, A(1))], tmp_path, query=fake(rows_for(1)), copy=cp)
    clean, = ef.fetch_round([(1, A(1))], tmp_path, clean=True, query=fake(rows_for(1)), copy=cp)
    assert raw != clean and "/archives/" in raw and "/wrds_clean_filings/" in clean
    assert cp.calls[1][2] == "wrds:/wrds/sec/wrds_clean_filings"


def test_fetch_round_propagates_query_failure(tmp_path):
    def boom(accessions):
        raise ef.QueryError("psql exploded")
    with pytest.raises(ef.QueryError):
        ef.fetch_round([(1, A(1))], tmp_path, query=boom, copy=fake_copy())


def test_fetch_rounds_three_levels_three_copies(tmp_path):
    cp = fake_copy()
    nxt = {1: [(2, A(2))], 2: [(3, A(3)), (3, A(3))], 3: []}

    def discover(paths):
        return [p for path in paths for p in nxt[int(path.split("/")[-2])]]
    out = ef.fetch_rounds([(1, A(1))], tmp_path, discover, query=fake(rows_for(1, 2, 3)), copy=cp)
    assert len(cp.calls) == 3 and len(out) == 3 and all(out)


def test_fetch_rounds_cycle_terminates_and_empty_seeds(tmp_path):
    cp = fake_copy()
    ef.fetch_rounds([(1, A(1))], tmp_path, lambda paths: [(2, A(2)), (None, A(1).replace("-", "")), (1, A(1))],
                    query=fake(rows_for(1, 2)), copy=cp)
    assert len(cp.calls) == 2  # (1,A1) is never requested again; (None,A1) is a different pair, resolved once more but cached
    called = []
    assert ef.fetch_rounds([], tmp_path, lambda p: called.append(p) or [], query=fake([]), copy=cp) == []
    assert called == [] and len(cp.calls) == 2


def test_fetch_rounds_missing_target_not_retried(tmp_path):
    cp, q, seen = fake_copy(), fake(rows_for(1)), []

    def discover(paths):
        seen.append(paths)
        return [(9, A(9))] if len(seen) < 4 else []
    ef.fetch_rounds([(1, A(1))], tmp_path, discover, query=q, copy=cp)
    assert [c for c in q.calls if A(9) in c] == [[A(9)]] and len(cp.calls) == 1


@pytest.fixture
def rclone_stub(stub, monkeypatch):
    rc = stub.dir.parent / "bin" / "rclone"
    rc.write_text(
        "#!/bin/sh\n"
        f'S="{stub.dir}"\n'
        'printf "%s\\n" "$@" > "$S/rclone_argv"\n'
        'echo x >> "$S/rclone_calls"\n'
        'while read f; do case "$f" in */2/*) ;; *) mkdir -p "$(dirname "$3/$f")"; echo body > "$3/$f";; esac; done < "$5"\n'
        '[ -f "$S/rclone_err" ] && cat "$S/rclone_err" >&2\n'
        'exit "$(cat "$S/rclone_rc" 2>/dev/null || echo 0)"\n')
    rc.chmod(rc.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PGUSER", "alice")
    return stub


def test_default_copy_runs_rclone_from_path(rclone_stub, tmp_path):
    rclone_stub.set(f"{A(1)}\t0000000001\t000000/1/{A(1)}.txt\n")
    out, = ef.fetch_round([(1, A(1))], tmp_path)
    assert Path(out).read_text() == "body\n"
    argv = rclone_stub.read("rclone_argv").split("\n")
    assert argv[:3] == ["copy", "wrds:/wrds/sec/archives", f"{tmp_path}/archives"] and "--no-traverse" in argv
    assert "--ignore-checksum" in argv


def test_default_copy_nonzero_exit_raises_with_stderr(rclone_stub, tmp_path):
    rclone_stub.set(f"{A(1)}\t0000000001\t000000/1/{A(1)}.txt\n")
    (rclone_stub.dir / "rclone_rc").write_text("1")
    (rclone_stub.dir / "rclone_err").write_text("auth exploded")
    with pytest.raises(ef.CopyError, match="auth exploded"):
        ef.fetch_round([(1, A(1))], tmp_path)


def test_cli_fetch_stdout_stderr_and_exit_codes(rclone_stub, tmp_path):
    rclone_stub.set(f"{A(1)}\t0000000001\t000000/1/{A(1)}.txt\n{A(2)}\t0000000002\t000000/2/{A(2)}.txt\n"
                    f"{A(9)}\t0000000007\t000000/7/{A(9)}.txt\n")
    d = tmp_path / "out"
    text = f"1 {A(1)}\n\n1 {A(1)}\n3 {A(9)}\n2 {A(2)}\n5 {A(5)}\n"
    r = run("fetch", "-", str(d), input=text.encode())
    assert r.returncode == 3
    assert r.stdout.decode().splitlines() == [f"{d}/archives/000000/1/{A(1)}.txt", f"{d}/archives/000000/7/{A(9)}.txt"]
    err = r.stderr.decode().splitlines()
    assert len(err) == 3 and sum("relocated" in e for e in err) == 1 and sum("missing" in e for e in err) == 2
    ok = run("fetch", "-", str(d), "--clean", input=f"1 {A(1)}\n".encode())
    assert (ok.returncode, ok.stdout) == (0, f"{d}/wrds_clean_filings/000000/1/{A(1)}.txt\n".encode())


def test_cli_fetch_failures_and_bad_input(rclone_stub, tmp_path):
    rclone_stub.set(f"{A(1)}\t0000000001\t000000/1/{A(1)}.txt\n")
    (rclone_stub.dir / "rclone_rc").write_text("1")
    r = run("fetch", "-", str(tmp_path), input=f"1 {A(1)}\n".encode())
    assert r.returncode == 1 and r.stdout == b""
    assert run("fetch", "-", str(tmp_path), input=b"1 2 3\n").returncode == 2
    rclone_stub.set("", rc=2)
    assert run("fetch", "-", str(tmp_path), input=f"1 {A(1)}\n".encode()).returncode == 1


def test_docstring_names_fetch():
    assert "fetch" in ef.__doc__


# ── dot-stuffing ──────────────────────────────────────────────────────────────────────────────
def _body(raw: bytes) -> bytes:
    sgml = HEADER + b"<DOCUMENT>\n<TYPE>EX-3.1\n<FILENAME>d.txt\n<TEXT>\n" + raw + b"</TEXT>\n</DOCUMENT>\n"
    d, = ef.documents(sgml)
    return d.text


def test_stuffed_file_is_unstuffed():
    assert _body(b"..report table{\nplain\n..x\n") == b".report table{\nplain\n.x\n"


def test_triple_dot_becomes_double_in_stuffed_file():
    assert _body(b"..a\n...\nb\n") == b".a\n..\nb\n"


def test_unstuffed_file_with_single_dot_line_and_genuine_triple_dot_unchanged():
    raw = b".x\n...\n..y\n"
    assert _body(raw) == raw


def test_lone_dot_line_counts_as_single_dot_even_with_crlf():
    for raw in (b"..a\n.\n", b"..a\r\n.\r\n"):
        assert _body(raw) == raw


def test_crlf_stuffed_is_unstuffed():
    assert _body(b"..a\r\nb\r\n") == b".a\r\nb\r\n"


def test_non_utf8_bytes_unstuffed_without_decoding():
    assert _body(b"..\xff\xfe\x00\n\x80..\n") == b".\xff\xfe\x00\n\x80..\n"


def test_uuencoded_line_starting_with_dots_is_unstuffed():
    assert _body(b"begin 644 a.gif\n..M1TE&.#=A\nend\n") == b"begin 644 a.gif\n.M1TE&.#=A\nend\n"


def test_single_dot_line_in_another_document_keeps_whole_submission_unchanged():
    sgml = filing(doc("EX-3.1", "a.htm", "..a"), doc("EX-3.1", "b.htm", ".b"))
    assert [d.text for d in ef.documents(sgml)] == [b"..a\n", b".b\n"]
