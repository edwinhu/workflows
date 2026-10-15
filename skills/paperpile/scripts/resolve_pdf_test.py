"""Contract tests for resolve_pdf.py: bib parsing, matching floors, resolver URL building, the main()
chain and exit codes. Every network/browser/CLI boundary (curl, scholar, CDP, websockets) is stubbed;
paths that default under $HOME are redirected into tmp_path."""

import importlib
import json
import sys
import types
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


@pytest.fixture
def rp(monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "cfg"))
    monkeypatch.delenv("PAPERPILE_CDP_PORT", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))
    monkeypatch.syspath_prepend(str(HERE))
    sys.modules.pop("resolve_pdf", None)
    mod = importlib.import_module("resolve_pdf")

    def boom(*a, **k):
        raise AssertionError(f"unstubbed external call: {a[:1]}")

    monkeypatch.setattr(mod.subprocess, "run", boom)
    monkeypatch.setattr(mod.shutil, "which", lambda n: None)
    mod.set_cdp_port(None)
    yield mod
    sys.modules.pop("resolve_pdf", None)


BIB = """@article{smith2020,
  author = {Smith, Jane and Doe, John},
  title = {The {Real} Title of a Paper},
  journaltitle = {Journal of Things},
  date = {2020-05-01},
  url = {https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123456},
}

@article{nodoi2019,
  author = {Roe, Richard},
  title = {Untethered Law},
  year = {2019}
}

@article{withdoi,
  author = {A B},
  title = {T},
  doi = {10.1234/abc},
  year = {2001},
}
"""


@pytest.fixture
def bib(tmp_path):
    p = tmp_path / "lib.bib"
    p.write_text(BIB)
    return p


def pdf_bytes(n=2048):
    return b"%PDF-1.4\n" + b"x" * n


# --- bib parsing ----------------------------------------------------------------------------------

def test_parse_bib_extracts_fields_and_strips_braces(rp, bib):
    e = rp.parse_bib_for_key(bib, "smith2020")
    assert e.title == "The Real Title of a Paper"
    assert e.authors == ["Smith, Jane", "Doe, John"]
    assert e.journal == "Journal of Things" and e.year == "2020"
    assert e.ssrn_id == "123456" and e.doi is None


def test_parse_bib_keeps_doi_and_drops_non_doi_values(rp, bib, tmp_path):
    assert rp.parse_bib_for_key(bib, "withdoi").doi == "10.1234/abc"
    bad = tmp_path / "b.bib"
    bad.write_text("@article{k,\n  title = {T},\n  doi = {not-a-doi},\n}\n")
    assert rp.parse_bib_for_key(bad, "k").doi is None


def test_parse_bib_unknown_key_returns_none(rp, bib):
    assert rp.parse_bib_for_key(bib, "ghost") is None


def test_parse_bib_missing_file_dies_with_code_1(rp, tmp_path, capsys):
    with pytest.raises(SystemExit) as e:
        rp.parse_bib_for_key(tmp_path / "nope.bib", "k")
    assert e.value.code == 1 and "bib file not found" in capsys.readouterr().err


def test_parse_bib_key_is_matched_literally_not_as_regex(rp, bib):
    assert rp.parse_bib_for_key(bib, "smith.020") is None


def test_writeback_doi_inserts_once(rp, bib):
    assert rp.writeback_doi(bib, "nodoi2019", "10.9/x") is True
    text = bib.read_text()
    assert "doi = {10.9/x}" in text
    assert rp.parse_bib_for_key(bib, "nodoi2019").doi == "10.9/x"
    assert rp.parse_bib_for_key(bib, "smith2020").title            # neighbours intact
    assert rp.writeback_doi(bib, "nodoi2019", "10.9/y") is False   # idempotent
    assert text == bib.read_text()


def test_writeback_doi_unknown_key_false(rp, bib):
    assert rp.writeback_doi(bib, "ghost", "10.9/x") is False


# --- pure helpers ---------------------------------------------------------------------------------

@pytest.mark.parametrize("doi,sid", [("10.2139/ssrn.4567890", "4567890"), ("10.2139/ssrn.12x", None),
                                     ("10.1016/j.x.2020", None), ("", None), (None, None)])
def test_extract_ssrn_id_from_doi(rp, doi, sid):
    assert rp.extract_ssrn_id_from_doi(doi) == sid


def test_title_similarity_floor_behaviour(rp):
    assert rp.title_similarity("The Real Title", "the  real, title!") == 1.0
    assert rp.title_similarity("", "x") == 0.0 and rp.title_similarity("x", None) == 0.0
    assert rp.title_similarity("Corporate Governance Reform", "Quantum Chromodynamics") < rp.TITLE_MATCH_FLOOR


def test_filename_title_strips_author_year_prefix(rp):
    assert rp.filename_title("Smith et al. 2015 - Real Title") == "Real Title"
    assert rp.filename_title("Smith 2015a - Real Title") == "Real Title"
    assert rp.filename_title("no year here") == "no year here"


def test_is_real_pdf_requires_magic_and_minimum_size(rp, tmp_path):
    good, small, html = tmp_path / "g.pdf", tmp_path / "s.pdf", tmp_path / "h.pdf"
    good.write_bytes(pdf_bytes())
    small.write_bytes(b"%PDF-1.4 tiny")
    html.write_bytes(b"<html>" + b"x" * 4000)
    assert rp.is_real_pdf(good) and not rp.is_real_pdf(small) and not rp.is_real_pdf(html)
    assert not rp.is_real_pdf(tmp_path / "absent.pdf")


def test_load_config_parses_shipped_reference_block(rp):
    cfg = rp.load_config()
    assert cfg["uva_ezproxy_host"] == "proxy1.library.virginia.edu"
    assert "nyu_ezproxy_host" in cfg and "default_output_dir" in cfg
    assert "#" not in cfg["uva_libkey_id"]   # trailing comments stripped


def test_load_config_missing_block_dies(rp, tmp_path, monkeypatch, capsys):
    ref = tmp_path / "ref.md"
    ref.write_text("no config here")
    monkeypatch.setattr(rp, "PROXY_REF", ref)
    with pytest.raises(SystemExit) as e:
        rp.load_config()
    assert e.value.code == 1 and "no ```config``` block" in capsys.readouterr().err


# --- CDP port order -------------------------------------------------------------------------------

def test_cdp_ports_order_flag_env_defaults_deduped(rp, monkeypatch):
    assert rp.cdp_ports() == [9250, 9222]
    monkeypatch.setenv("PAPERPILE_CDP_PORT", "9333")
    assert rp.cdp_ports() == [9333, 9250, 9222]
    rp.set_cdp_port(9222)
    assert rp.cdp_ports() == [9222, 9333, 9250]
    monkeypatch.setenv("PAPERPILE_CDP_PORT", "junk")
    assert rp.cdp_ports() == [9222, 9250]


def test_cdp_resolve_first_reachable_wins_and_is_cached(rp, monkeypatch):
    probed = []
    monkeypatch.setattr(rp, "_port_reachable", lambda p: probed.append(p) or p == 9222)
    assert rp.cdp_resolve() == "http://127.0.0.1:9222" and probed == [9250, 9222]
    assert rp.cdp_resolve() == "http://127.0.0.1:9222" and probed == [9250, 9222]
    assert rp.cdp_alive() is True


def test_cdp_unreachable_everywhere(rp, monkeypatch):
    monkeypatch.setattr(rp, "_port_reachable", lambda p: False)
    assert rp.cdp_resolve() is None and rp.cdp_alive() is False
    assert rp.cdp_url() == "http://127.0.0.1:9250"          # falls back to the first candidate
    assert rp.cdp_ports_desc() == ":9250, :9222"


def test_port_reachable_maps_curl_exit_status(rp, monkeypatch):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return types.SimpleNamespace(returncode=0 if "9222" in cmd[-1] else 7)

    monkeypatch.setattr(rp.subprocess, "run", run)
    assert rp._port_reachable(9222) is True and rp._port_reachable(1) is False
    assert calls[0][-1] == "http://127.0.0.1:9222/json/version"


def test_port_reachable_swallows_curl_errors(rp, monkeypatch):
    def run(*a, **k):
        raise OSError("no curl")

    monkeypatch.setattr(rp.subprocess, "run", run)
    assert rp._port_reachable(9222) is False


# --- crossref / cookies / index -------------------------------------------------------------------

def crossref_stub(rp, monkeypatch, items):
    seen = []

    def run(cmd, **kw):
        seen.append(cmd)
        return types.SimpleNamespace(stdout=json.dumps({"message": {"items": items}}), returncode=0)

    monkeypatch.setattr(rp.subprocess, "run", run)
    return seen


def test_crossref_lookup_filters_year_and_lowercases(rp, monkeypatch):
    seen = crossref_stub(rp, monkeypatch, [
        {"DOI": "10.1/FAR", "issued": {"date-parts": [[2010]]}},
        {"DOI": "10.1/NEAR", "published-print": {"date-parts": [[2021]]}},
    ])
    assert rp.crossref_lookup_doi("Some Title", "2020") == "10.1/near"
    assert "query.title=Some+Title" in seen[0][-1]


def test_crossref_lookup_no_year_takes_first_and_empty_title_skips_network(rp, monkeypatch):
    crossref_stub(rp, monkeypatch, [{"DOI": "10.1/A"}])
    assert rp.crossref_lookup_doi("T", None) == "10.1/a"
    assert rp.crossref_lookup_doi("", "2020") is None   # would raise via the boom stub if it called out


def test_crossref_lookup_bad_json_is_none(rp, monkeypatch):
    monkeypatch.setattr(rp.subprocess, "run", lambda *a, **k: types.SimpleNamespace(stdout="<html>", returncode=0))
    assert rp.crossref_lookup_doi("T", "2020") is None


def test_cookie_header_merges_files_and_skips_malformed(rp, monkeypatch, tmp_path):
    jar = tmp_path / "jar"
    jar.mkdir()
    (jar / "api.paperpile.com.json").write_text(json.dumps([{"name": "plack_session", "value": "S1"}]))
    (jar / "paperpile.com.json").write_text("{not json")
    (jar / "library.paperpile.com.json").write_text(json.dumps([{"name": "a", "value": "b"}]))
    monkeypatch.setattr(rp, "COOKIE_DIR", jar)
    assert rp._paperpile_cookie_header() == "plack_session=S1; a=b"


def test_cookie_header_none_when_no_jar(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "COOKIE_DIR", tmp_path / "empty")
    assert rp._paperpile_cookie_header() is None


def test_index_fresh_cache_short_circuits_network(rp, monkeypatch, tmp_path):
    cache = tmp_path / "idx.json"
    cache.write_text(json.dumps({"library": [1], "attachments": []}))
    monkeypatch.setattr(rp, "PAPERPILE_CACHE", cache)
    assert rp.paperpile_api_index() == {"library": [1], "attachments": []}   # boom stub proves no curl


def test_index_without_cookie_returns_none(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "PAPERPILE_CACHE", tmp_path / "idx.json")
    monkeypatch.setattr(rp, "_paperpile_cookie_header", lambda: None)
    assert rp.paperpile_api_index() is None


def test_index_fetches_library_paginates_attachments_and_caches(rp, monkeypatch, tmp_path):
    cache = tmp_path / "sub" / "idx.json"
    monkeypatch.setattr(rp, "PAPERPILE_CACHE", cache)
    monkeypatch.setattr(rp, "_paperpile_cookie_header", lambda: "plack_session=S")
    pages = {0: [{"i": n} for n in range(50)], 50: [{"i": 99}]}
    urls = []

    def run(cmd, **kw):
        urls.append(cmd[-1])
        assert "Cookie: plack_session=S" in cmd
        if cmd[-1].endswith("/api/library"):
            return types.SimpleNamespace(returncode=0, stdout=json.dumps([{"_id": "a"}]), stderr="")
        skip = int(cmd[-1].rsplit("=", 1)[1])
        return types.SimpleNamespace(returncode=0, stdout=json.dumps(pages[skip]), stderr="")

    monkeypatch.setattr(rp.subprocess, "run", run)
    idx = rp.paperpile_api_index(force=True)
    assert len(idx["library"]) == 1 and len(idx["attachments"]) == 51
    assert len(urls) == 3 and cache.exists()


def test_index_library_failure_returns_none_and_writes_nothing(rp, monkeypatch, tmp_path):
    cache = tmp_path / "idx.json"
    monkeypatch.setattr(rp, "PAPERPILE_CACHE", cache)
    monkeypatch.setattr(rp, "_paperpile_cookie_header", lambda: "c=1")
    monkeypatch.setattr(rp.subprocess, "run",
                        lambda *a, **k: types.SimpleNamespace(returncode=22, stdout="", stderr="403"))
    assert rp.paperpile_api_index(force=True) is None and not cache.exists()


# --- local Paperpile dir --------------------------------------------------------------------------

@pytest.fixture
def ppdir(rp, monkeypatch, tmp_path):
    d = tmp_path / "pp"
    (d / "S").mkdir(parents=True)
    monkeypatch.setattr(rp, "PAPERPILE_DIR", d)
    return d


def entry(rp, **over):
    base = dict(key="k", doi=None, title="The Real Title of a Paper", authors=["Smith, Jane"],
                journal="", year="2020", ssrn_id=None, url=None)
    base.update(over)
    return rp.BibEntry(**base)


def test_resolve_paperpile_copies_matching_pdf(rp, ppdir, tmp_path):
    (ppdir / "S" / "Smith 2020 - The Real Title of a Paper.pdf").write_bytes(pdf_bytes())
    out = tmp_path / "out.pdf"
    ok, diag = rp.resolve_paperpile(entry(rp), out)
    assert ok and out.read_bytes().startswith(b"%PDF-") and "paperpile:" in diag


def test_resolve_paperpile_declines_title_collision(rp, ppdir, tmp_path):
    (ppdir / "S" / "Smith 2020 - Quantum Chromodynamics On Lattices.pdf").write_bytes(pdf_bytes())
    out = tmp_path / "out.pdf"
    ok, diag = rp.resolve_paperpile(entry(rp), out)
    assert not ok and "< 0.75" in diag and not out.exists()


def test_resolve_paperpile_declines_non_pdf_file(rp, ppdir, tmp_path):
    (ppdir / "S" / "Smith 2020 - The Real Title of a Paper.pdf").write_bytes(b"<html>" + b"x" * 3000)
    ok, diag = rp.resolve_paperpile(entry(rp), tmp_path / "o.pdf")
    assert not ok and "not a valid PDF" in diag


@pytest.mark.parametrize("over,msg", [
    (dict(title=""), "no title"), (dict(authors=[]), "no authors"),
    (dict(authors=["Zed, Z"]), "no Paperpile letter dir"), (dict(year="1999"), "no Paperpile match"),
])
def test_resolve_paperpile_named_refusals(rp, ppdir, tmp_path, over, msg):
    ok, diag = rp.resolve_paperpile(entry(rp, **over), tmp_path / "o.pdf")
    assert not ok and msg in diag


def test_resolve_paperpile_no_entry_or_dir(rp, tmp_path):
    assert rp.resolve_paperpile(None, tmp_path / "o.pdf")[0] is False


def test_resolve_paperpile_parses_first_last_author_form(rp, ppdir, tmp_path):
    (ppdir / "S" / "Smith 2020 - The Real Title of a Paper.pdf").write_bytes(pdf_bytes())
    assert rp.resolve_paperpile(entry(rp, authors=["Jane Q. Smith"]), tmp_path / "o.pdf")[0]


# --- paperpile-api matching (index stubbed, never reaches the browser) -----------------------------

def api_index(title="The Real Title of a Paper", with_att=True):
    return {"library": [{"_id": "L1", "title": title, "author": [{"last": "Smith"}],
                         "published": {"year": "2020"}}],
            "attachments": ([{"pub_id": "L1", "mimeType": "application/pdf", "article_pdf": 1,
                              "gdrive_id": "G"}] if with_att else [])}


def test_api_requires_browser_and_title(rp, tmp_path):
    assert "requires --via-browser" in rp.resolve_paperpile_api(entry(rp), tmp_path / "o", False)[1]
    assert rp.resolve_paperpile_api(entry(rp, title=""), tmp_path / "o", True) == (False, "no entry/title")
    assert rp.resolve_paperpile_api(None, tmp_path / "o", True) == (False, "no entry/title")


def test_api_no_index_is_named(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "paperpile_api_index", lambda force=False: None)
    assert "no Paperpile index" in rp.resolve_paperpile_api(entry(rp), tmp_path / "o", True)[1]


def test_api_declines_title_collision_on_same_first_author(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "paperpile_api_index", lambda force=False: api_index("Smith On Unrelated Taxation Of Bees"))
    ok, diag = rp.resolve_paperpile_api(entry(rp, title="Real Title Of A Paper Smith"), tmp_path / "o", True)
    assert not ok and "< 0.75" in diag


def test_api_no_first_author_match(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "paperpile_api_index", lambda force=False: api_index())
    ok, diag = rp.resolve_paperpile_api(entry(rp, authors=["Nobody, N"]), tmp_path / "o", True)
    assert not ok and "no library item matches first-author 'nobody'" in diag


def test_api_matched_item_without_pdf_attachment(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "paperpile_api_index", lambda force=False: api_index(with_att=False))
    ok, diag = rp.resolve_paperpile_api(entry(rp), tmp_path / "o", True)
    assert not ok and "no PDF attachment" in diag


def test_api_cdp_down_is_named_before_any_navigation(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "paperpile_api_index", lambda force=False: api_index())
    monkeypatch.setattr(rp, "_port_reachable", lambda p: False)
    ok, diag = rp.resolve_paperpile_api(entry(rp), tmp_path / "o", True)
    assert not ok and "CDP not reachable on :9250, :9222" in diag


# --- scholar / institutional resolvers ------------------------------------------------------------

def test_scholar_download_refusals_and_success(rp, monkeypatch, tmp_path):
    out = tmp_path / "o.pdf"
    assert rp.scholar_download("http://x", out) == (False, "scholar CLI not on PATH")
    monkeypatch.setattr(rp.shutil, "which", lambda n: "/bin/scholar")

    def run(cmd, **kw):
        assert cmd[:3] == ["scholar", "download", "http://x"] and cmd[-1] == str(out)
        out.write_bytes(b"<html>paywall" + b"x" * 3000)
        return types.SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(rp.subprocess, "run", run)
    ok, diag = rp.scholar_download("http://x", out)
    assert not ok and "not a PDF" in diag and not out.exists()     # paywall HTML is deleted

    monkeypatch.setattr(rp.subprocess, "run", lambda c, **k: (out.write_bytes(pdf_bytes()),
                        types.SimpleNamespace(returncode=0, stderr=""))[1])
    assert rp.scholar_download("http://x", out)[0] is True


def test_scholar_download_reports_last_stderr_line_and_timeout(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp.shutil, "which", lambda n: "/bin/scholar")
    monkeypatch.setattr(rp.subprocess, "run", lambda c, **k: types.SimpleNamespace(
        returncode=1, stderr="noise\nfinal reason\n"))
    assert rp.scholar_download("u", tmp_path / "o") == (False, "final reason")

    def timeout(*a, **k):
        raise rp.subprocess.TimeoutExpired("scholar", 90)

    monkeypatch.setattr(rp.subprocess, "run", timeout)
    assert rp.scholar_download("u", tmp_path / "o") == (False, "timeout (90s)")


@pytest.fixture
def fetched(rp, monkeypatch):
    got = []
    monkeypatch.setattr(rp, "scholar_download", lambda url, out: got.append(("scholar", url)) or (False, "x"))
    monkeypatch.setattr(rp, "browser_fetch_pdf", lambda url, out: got.append(("browser", url)) or (False, "x"))
    return got


def test_resolve_ezproxy_wraps_doi_url_and_picks_fetcher(rp, fetched, tmp_path):
    rp.resolve_ezproxy("10.1/a b", "proxy.example", tmp_path / "o", False)
    rp.resolve_ezproxy("10.1/a", "proxy.example", tmp_path / "o", True)
    assert fetched[0] == ("scholar", "https://proxy.example/login?url=https://doi.org/10.1/a%20b")
    assert fetched[1] == ("browser", "https://proxy.example/login?url=https://doi.org/10.1/a")
    assert rp.resolve_ezproxy("10.1/a", "", tmp_path / "o", False) == (False, "ezproxy host not configured")


@pytest.mark.parametrize("lib", ["", "TODO", "abc"])
def test_resolve_libkey_unconfigured_never_fetches(rp, fetched, tmp_path, lib):
    ok, diag = rp.resolve_libkey("10.1/a", lib, tmp_path / "o", True)
    assert not ok and "not configured" in diag and fetched == []


def test_resolve_libkey_builds_openurl(rp, fetched, tmp_path):
    rp.resolve_libkey("10.1/a", "1234", tmp_path / "o", False)
    assert fetched == [("scholar", "https://libkey.io/libraries/1234/openurl?genre=article&doi=10.1/a")]


def test_resolve_ssrn_tries_delivery_then_abstract_page(rp, fetched, tmp_path):
    assert rp.resolve_ssrn("42", tmp_path / "o", True) == (False, "x")
    assert [u for _, u in fetched] == ["https://papers.ssrn.com/sol3/Delivery.cfm/42.pdf?abstractid=42&mirid=1",
                                      "https://ssrn.com/abstract=42"]
    assert rp.resolve_ssrn("", tmp_path / "o", True) == (False, "no SSRN id")


def test_resolve_ssrn_stops_after_first_success(rp, monkeypatch, tmp_path):
    urls = []
    monkeypatch.setattr(rp, "browser_fetch_pdf", lambda u, o: urls.append(u) or (True, "ok"))
    assert rp.resolve_ssrn("42", tmp_path / "o", True) == (True, "ok") and len(urls) == 1


def test_resolve_openathens_gates(rp, fetched, tmp_path):
    assert "requires --via-browser" in rp.resolve_openathens("10.1016/x", tmp_path / "o", False)[1]
    assert rp.resolve_openathens("", tmp_path / "o", True) == (False, "no DOI")
    assert "not in OpenAthens publisher list" in rp.resolve_openathens("10.9999/x", tmp_path / "o", True)[1]
    assert fetched == []
    rp.resolve_openathens("10.1016/j.x", tmp_path / "o", True)
    assert fetched == [("browser", "https://doi.org/10.1016/j.x")]


def test_resolve_virgo_needs_browser_and_quotes_title(rp, fetched, tmp_path):
    assert rp.resolve_virgo("T", tmp_path / "o", False)[0] is False
    assert rp.resolve_virgo("", tmp_path / "o", True)[0] is False and fetched == []
    rp.resolve_virgo("A & B", tmp_path / "o", True)
    assert "q=keyword:{A%20%26%20B}&pool=articles" in fetched[0][1]


def test_browser_fetch_refuses_when_cdp_down(rp, monkeypatch, tmp_path):
    monkeypatch.setattr(rp, "_port_reachable", lambda p: False)
    ok, diag = rp.browser_fetch_pdf("http://x", tmp_path / "o")
    assert not ok and "CDP not reachable" in diag


# --- main() ---------------------------------------------------------------------------------------

@pytest.fixture
def mainenv(rp, monkeypatch, tmp_path, bib):
    """No browser, no network; every resolver records its name and fails unless told otherwise."""
    monkeypatch.setattr(rp, "_port_reachable", lambda p: False)
    ran = []
    for n in ("resolve_paperpile_api", "resolve_paperpile", "resolve_libkey", "resolve_ezproxy",
              "resolve_openathens", "resolve_ssrn", "resolve_virgo"):
        monkeypatch.setattr(rp, n, lambda *a, _n=n, **k: ran.append(_n) or (False, "stub"))
    monkeypatch.setattr(rp, "crossref_lookup_doi", lambda t, y: None)
    return types.SimpleNamespace(ran=ran, bib=bib, out=tmp_path / "out")


def run_main(rp, monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["resolve_pdf.py", *argv])
    try:
        return rp.main()
    except SystemExit as e:
        return e.code


def test_main_needs_bibkey_or_doi(rp, mainenv, monkeypatch, capsys):
    assert run_main(rp, monkeypatch, "--out", str(mainenv.out)) == 1
    assert "must provide BIBKEY or --doi" in capsys.readouterr().err


def test_main_unknown_key_without_doi_exit_2(rp, mainenv, monkeypatch, capsys):
    assert run_main(rp, monkeypatch, "ghost", "--bib", str(mainenv.bib), "--out", str(mainenv.out)) == 2
    assert "not found and no --doi" in capsys.readouterr().err


def test_main_no_identifier_at_all_exit_2(rp, mainenv, monkeypatch, tmp_path, capsys):
    b = tmp_path / "e.bib"
    b.write_text("@article{k,\n  author = {A B},\n  year = {2000}\n}\n")
    assert run_main(rp, monkeypatch, "k", "--bib", str(b), "--out", str(mainenv.out)) == 2
    assert "nothing to resolve" in capsys.readouterr().err


def test_main_all_resolvers_fail_exit_3_in_chain_order(rp, mainenv, monkeypatch, capsys):
    assert run_main(rp, monkeypatch, "withdoi", "--bib", str(mainenv.bib), "--out", str(mainenv.out)) == 3
    assert mainenv.ran == ["resolve_paperpile_api", "resolve_paperpile", "resolve_ezproxy",
                           "resolve_openathens", "resolve_ezproxy"]
    assert "fail" in capsys.readouterr().err


def test_main_skip_paperpile_drops_both_steps(rp, mainenv, monkeypatch, capsys):
    run_main(rp, monkeypatch, "withdoi", "--bib", str(mainenv.bib), "--out", str(mainenv.out), "--skip-paperpile")
    assert "resolve_paperpile_api" not in mainenv.ran and "resolve_paperpile" not in mainenv.ran
    assert "--skip-paperpile" in capsys.readouterr().err


def test_main_prefer_ssrn_goes_before_institutional_and_libkey_is_opt_in(rp, mainenv, monkeypatch):
    run_main(rp, monkeypatch, "smith2020", "--bib", str(mainenv.bib), "--out", str(mainenv.out),
             "--doi", "10.1/x", "--prefer-ssrn", "--skip-paperpile")
    assert mainenv.ran[0] == "resolve_ssrn" and "resolve_libkey" not in mainenv.ran
    mainenv.ran.clear()
    run_main(rp, monkeypatch, "smith2020", "--bib", str(mainenv.bib), "--out", str(mainenv.out),
             "--doi", "10.1/x", "--try-libkey", "--skip-paperpile")
    assert mainenv.ran[0] == "resolve_libkey" and mainenv.ran[-1] == "resolve_ssrn"


def test_main_ssrn_doi_derives_ssrn_id_without_bib(rp, mainenv, monkeypatch):
    run_main(rp, monkeypatch, "--doi", "10.2139/ssrn.99", "--out", str(mainenv.out))
    assert mainenv.ran[-1] == "resolve_ssrn"


def test_main_no_doi_title_only_falls_to_virgo(rp, mainenv, monkeypatch):
    assert run_main(rp, monkeypatch, "nodoi2019", "--bib", str(mainenv.bib), "--out", str(mainenv.out),
                    "--skip-paperpile") == 3
    assert mainenv.ran == ["resolve_virgo"]


def test_main_crossref_doi_is_written_back_unless_disabled(rp, mainenv, monkeypatch):
    monkeypatch.setattr(rp, "crossref_lookup_doi", lambda t, y: "10.7/found")
    run_main(rp, monkeypatch, "nodoi2019", "--bib", str(mainenv.bib), "--out", str(mainenv.out),
             "--no-writeback", "--skip-paperpile")
    assert rp.parse_bib_for_key(mainenv.bib, "nodoi2019").doi is None
    run_main(rp, monkeypatch, "nodoi2019", "--bib", str(mainenv.bib), "--out", str(mainenv.out),
             "--skip-paperpile")
    assert rp.parse_bib_for_key(mainenv.bib, "nodoi2019").doi == "10.7/found"


def test_main_success_prints_single_absolute_path_and_stops(rp, mainenv, monkeypatch, capsys):
    monkeypatch.setattr(rp, "resolve_ezproxy", lambda *a, **k: (True, "ok"))
    assert run_main(rp, monkeypatch, "withdoi", "--bib", str(mainenv.bib), "--out", str(mainenv.out),
                    "--skip-paperpile") == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert out == [str((mainenv.out / "withdoi.pdf").resolve())]
    assert "resolve_openathens" not in mainenv.ran


def test_main_doi_only_names_file_after_doi(rp, mainenv, monkeypatch, capsys):
    monkeypatch.setattr(rp, "resolve_ezproxy", lambda *a, **k: (True, "ok"))
    run_main(rp, monkeypatch, "--doi", "10.1/a", "--out", str(mainenv.out))
    assert capsys.readouterr().out.strip().endswith("10.1_a.pdf")


def test_main_login_only_refuses_without_browser(rp, mainenv, monkeypatch, capsys):
    assert run_main(rp, monkeypatch, "--login-only") == 1
    assert "CDP not reachable" in capsys.readouterr().err


def test_main_manual_hop_without_identifier_refuses(rp, mainenv, monkeypatch, tmp_path, capsys):
    b = tmp_path / "t.bib"
    b.write_text("@article{k,\n  author = {A B},\n  title = {Only A Title},\n  year = {2000}\n}\n")
    assert run_main(rp, monkeypatch, "k", "--bib", str(b), "--out", str(mainenv.out), "--manual-hop") == 1
    assert "--manual-hop needs DOI or SSRN id" in capsys.readouterr().err


def test_main_manual_hop_targets_ssrn_abstract_for_ssrn_doi(rp, mainenv, monkeypatch, capsys):
    seen = []
    monkeypatch.setattr(rp, "manual_hop", lambda url, out, **k: seen.append(url) or (False, "no"))
    assert run_main(rp, monkeypatch, "--doi", "10.2139/ssrn.77", "--out", str(mainenv.out), "--manual-hop") == 3
    assert seen == ["https://ssrn.com/abstract=77"]


def test_via_dia_is_accepted_alias_for_via_browser(rp, mainenv, monkeypatch):
    seen = []
    monkeypatch.setattr(rp, "resolve_openathens", lambda doi, out, vb: seen.append(vb) or (False, "x"))
    run_main(rp, monkeypatch, "--doi", "10.1016/x", "--via-dia", "--out", str(mainenv.out))
    assert seen == [True]
