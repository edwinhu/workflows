"""Contract tests for the paperpile shell scripts (poll_attachment.sh, refresh-auth.sh, warmup.sh).
Every external (paperpile, curl, node, bun, sleep) is a recording stub first on PATH and HOME is a
tmp dir, so nothing reaches a browser, the network or real auth state."""

import json
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
BASH = shutil.which("bash")


@pytest.fixture
def env(tmp_path):
    home = tmp_path / "home"
    (home / ".claude-work/skills/paperpile/cache").mkdir(parents=True)
    d = tmp_path / "bin"
    d.mkdir()
    e = type("E", (), {})()
    e.home, e.bin, e.log = home, d, tmp_path / "calls.log"
    e.cache = home / ".claude-work/skills/paperpile/cache/paperpile-index.json"
    e.tmp = tmp_path
    return e


def stub(env, name, body):
    p = env.bin / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(p.stat().st_mode | stat.S_IEXEC)


def recorder(env, name, extra=""):
    stub(env, name, f'printf "%s" "{name}" >> "{env.log}"\n'
                    f'for a in "$@"; do printf " [%s]" "$a" >> "{env.log}"; done\n'
                    f'echo >> "{env.log}"\n{extra}')


def run(env, script, *args, extra_env=None):
    e = {"PATH": f"{env.bin}:/usr/bin:/bin", "HOME": str(env.home), "TMPDIR": str(env.tmp)}
    e.update(extra_env or {})
    r = subprocess.run([BASH, str(HERE / script), *args], capture_output=True, text=True, env=e, timeout=60)
    calls = env.log.read_text() if env.log.exists() else ""
    return r, calls


# --- poll_attachment.sh ---------------------------------------------------------------------------

def index(env, atts):
    env.cache.write_text(json.dumps({"attachments": atts}))


def test_poll_requires_item_id(env):
    r, _ = run(env, "poll_attachment.sh")
    assert r.returncode != 0 and "Usage: poll_attachment.sh <item_id>" in r.stderr


def test_poll_rejects_unknown_argument(env):
    r, _ = run(env, "poll_attachment.sh", "ITEM", "--bogus")
    assert r.returncode == 1 and "Unknown arg: --bogus" in r.stderr


def test_poll_prints_gdrive_id_for_matching_pdf_attachment(env):
    recorder(env, "paperpile")
    index(env, [{"pub_id": "OTHER", "article_pdf": 1, "gdrive_id": "no"},
                {"pub_id": "ITEM", "article_pdf": 0, "gdrive_id": "supplement"},
                {"pub_id": "ITEM", "article_pdf": 1, "gdrive_id": ""},
                {"pub_id": "ITEM", "article_pdf": 1, "gdrive_id": "GDRIVE1"}])
    r, calls = run(env, "poll_attachment.sh", "ITEM", "--timeout", "30")
    assert r.returncode == 0 and r.stdout.strip() == "GDRIVE1"
    assert "paperpile [index] [--refresh]" in calls     # refreshed before reading


def test_poll_times_out_with_item_named(env):
    recorder(env, "paperpile")
    index(env, [])
    r, calls = run(env, "poll_attachment.sh", "ITEM", "--timeout", "0")
    assert r.returncode == 1 and "Timeout: no PDF attachment found for ITEM after 0s" in r.stderr
    assert calls == ""    # an expired deadline never polls


def test_poll_waits_then_gives_up_when_attachment_never_appears(env):
    recorder(env, "paperpile")
    stub(env, "sleep", "exec /bin/sleep 1.1\n")      # the 5 s interval becomes ~1 s
    index(env, [{"pub_id": "ITEM", "article_pdf": 0, "gdrive_id": "x"}])
    r, calls = run(env, "poll_attachment.sh", "ITEM", "--timeout", "1")
    assert r.returncode == 1 and "Waiting for PDF attachment" in r.stderr
    assert calls.count("paperpile [index]") >= 1


def test_poll_unreadable_cache_is_not_a_match(env):
    recorder(env, "paperpile")
    env.cache.write_text("{broken")
    stub(env, "sleep", "exec /bin/sleep 1.1\n")
    r, _ = run(env, "poll_attachment.sh", "ITEM", "--timeout", "1")
    assert r.returncode == 1 and "Timeout" in r.stderr


def test_poll_survives_refresh_failure(env):
    stub(env, "paperpile", "exit 9\n")
    index(env, [{"pub_id": "ITEM", "article_pdf": 1, "gdrive_id": "G2"}])
    r, _ = run(env, "poll_attachment.sh", "ITEM", "--timeout", "30")
    assert r.returncode == 0 and r.stdout.strip() == "G2"


# --- refresh-auth.sh ------------------------------------------------------------------------------

def test_refresh_auth_no_browser_names_port_and_exits_1(env):
    stub(env, "curl", f'echo "$@" >> "{env.log}"\nexit 7\n')
    recorder(env, "paperpile")
    r, calls = run(env, "refresh-auth.sh")
    assert r.returncode == 1 and "no CDP browser on :9222" in r.stderr
    assert "http://localhost:9222/json/version" in calls and "paperpile" not in calls.replace("localhost", "")


def test_refresh_auth_port_precedence_arg_then_env(env):
    stub(env, "curl", "exit 7\n")
    r, _ = run(env, "refresh-auth.sh", extra_env={"PAPERPILE_CDP_PORT": "9333"})
    assert "no CDP browser on :9333" in r.stderr
    r, _ = run(env, "refresh-auth.sh", "9444", extra_env={"PAPERPILE_CDP_PORT": "9333"})
    assert "no CDP browser on :9444" in r.stderr


def test_refresh_auth_node_failure_stops_before_paperpile_auth(env):
    stub(env, "curl", "exit 0\n")
    stub(env, "node", "cat >/dev/null\nexit 2\n")
    recorder(env, "paperpile")
    r, calls = run(env, "refresh-auth.sh")
    assert r.returncode == 2 and calls == ""        # no session cookie => never imports or auths


def test_refresh_auth_imports_extracted_file_then_verifies(env):
    stub(env, "curl", "exit 0\n")
    stub(env, "node", f'cat >/dev/null\necho "[]" > "$OUT"\n')
    recorder(env, "paperpile")
    r, calls = run(env, "refresh-auth.sh")
    lines = calls.splitlines()
    assert r.returncode == 0 and len(lines) == 2
    assert lines[0].startswith("paperpile [auth] [import] [") and "pp_cookies" in lines[0]
    assert lines[1] == "paperpile [auth]"


def test_refresh_auth_cleans_temp_file_on_exit(env):
    stub(env, "curl", "exit 0\n")
    stub(env, "node", 'cat >/dev/null\necho "[]" > "$OUT"\n')
    recorder(env, "paperpile")
    run(env, "refresh-auth.sh")
    assert list(env.tmp.glob("pp_cookies*")) == []


# --- warmup.sh ------------------------------------------------------------------------------------

VERSION_JSON = '{"webSocketDebuggerUrl": "ws://localhost:1/devtools/browser/x"}'


def curl_up_on(env, ok_port):
    stub(env, "curl", f'echo "$@" >> "{env.log}"\n'
                      f'case "$*" in *":{ok_port}/json/version"*) echo \'{VERSION_JSON}\'; exit 0;; '
                      f'*/json/close/*) exit 0;; esac\nexit 7\n')


def test_warmup_no_browser_lists_candidates_in_order(env):
    stub(env, "curl", "exit 7\n")
    r, _ = run(env, "warmup.sh", "9111", extra_env={"PAPERPILE_CDP_PORT": "9222"})
    assert r.returncode == 1
    assert "no CDP browser on any of: 9111 9222 9250 9222" in r.stderr


def test_warmup_default_candidates_are_automation_then_everyday(env):
    stub(env, "curl", "exit 7\n")
    r, _ = run(env, "warmup.sh")
    assert "any of: 9250 9222" in r.stderr


def test_warmup_first_answering_port_wins(env):
    curl_up_on(env, 9222)
    stub(env, "bun", 'echo TAB1\n')
    r, calls = run(env, "warmup.sh")
    assert r.returncode == 0 and "[warmup] using CDP on :9222" in r.stdout
    probes = [l for l in calls.splitlines() if "json/version" in l]
    assert probes[0].endswith(":9250/json/version") and probes[1].endswith(":9222/json/version")


def test_warmup_explicit_port_is_tried_first(env):
    curl_up_on(env, 9777)
    stub(env, "bun", 'echo TAB1\n')
    r, calls = run(env, "warmup.sh", "9777")
    assert "using CDP on :9777" in r.stdout and calls.splitlines()[0].endswith(":9777/json/version")


def test_warmup_runs_all_three_stages_and_closes_tabs(env):
    curl_up_on(env, 9250)
    stub(env, "bun", 'echo TAB1\n')
    r, calls = run(env, "warmup.sh")
    for stage in ("=== EZproxy ===", "=== Clear OpenAthens cookies ===", "=== HeinOnline ===", "[warmup] done"):
        assert stage in r.stdout
    assert "json/close/TAB1" in calls


def test_warmup_tab_creation_failure_aborts_loudly_under_set_e(env):
    # warmup_url returns 1 and `set -e` ends the run: non-zero for the scheduler, later stages skipped.
    curl_up_on(env, 9250)
    stub(env, "bun", "exit 1\n")
    r, _ = run(env, "warmup.sh")
    assert r.returncode == 1 and "[ezproxy] failed to open tab" in r.stdout
    assert "HeinOnline" not in r.stdout and "[warmup] done" not in r.stdout
