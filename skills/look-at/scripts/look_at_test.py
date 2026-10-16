# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""Contract tests for look_at.py and look_at.sh. The google-genai SDK is replaced by a fake module
and every backend CLI by a recording stub on PATH, so nothing here calls an API or reads a key."""

import importlib
import shutil
import stat
import subprocess
import sys
import types
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SH = HERE / "look_at.sh"
BASH = shutil.which("bash")


# --- look_at.py -----------------------------------------------------------------------------------

class FakeClient:
    instances = []

    def __init__(self, api_key):
        self.api_key = api_key
        self.uploaded, self.deleted, self.generated = [], [], []
        self.fail = False
        FakeClient.instances.append(self)
        outer = self

        class Files:
            def upload(self, file, config):
                outer.uploaded.append((file.name, config))
                return types.SimpleNamespace(name="files/abc")

            def delete(self, name):
                outer.deleted.append(name)

        class Models:
            def generate_content(self, model, contents, config):
                outer.generated.append((model, contents, config))
                if outer.fail:
                    raise RuntimeError("api exploded")
                return types.SimpleNamespace(text="EXTRACTED")

        self.files, self.models = Files(), Models()


@pytest.fixture
def la(monkeypatch):
    """look_at imported against a fake google.genai, with a clean key environment."""
    genai = types.ModuleType("google.genai")
    genai.Client = FakeClient
    ns = types.SimpleNamespace
    genai.types = types.ModuleType("google.genai.types")
    genai.types.ThinkingConfig = lambda **kw: ns(kind="thinking", **kw)
    genai.types.ToolCodeExecution = lambda: ns(kind="code")
    genai.types.Tool = lambda **kw: ns(kind="tool", **kw)
    genai.types.GenerateContentConfig = lambda **kw: ns(kind="config", **kw)
    google = types.ModuleType("google")
    google.genai = genai
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.genai", genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", genai.types)
    for k in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "GEMINI_API_KEY_FILE", "GEMINI_MODEL",
              "GEMINI_MODEL_VISION"):
        monkeypatch.delenv(k, raising=False)
    sys.modules.pop("look_at", None)
    monkeypatch.syspath_prepend(str(HERE))
    mod = importlib.import_module("look_at")
    # the macOS agenix fallback must never reach the real filesystem
    monkeypatch.setattr(mod.subprocess, "check_output",
                        lambda *a, **k: (_ for _ in ()).throw(subprocess.SubprocessError("no getconf")))
    FakeClient.instances.clear()
    yield mod
    sys.modules.pop("look_at", None)


@pytest.mark.parametrize("name,mime", [
    ("a.PDF", "application/pdf"), ("a.jpg", "image/jpeg"), ("a.JPEG", "image/jpeg"),
    ("a.png", "image/png"), ("a.mov", "video/mov"), ("a.mp3", "audio/mp3"),
    ("a.md", "text/markdown"), ("a.csv", "text/csv"), ("a.xyz", "application/octet-stream"),
    ("noext", "application/octet-stream"), ("dir.v2/clip.3gp", "video/3gpp"),
])
def test_infer_mime_type(la, name, mime):
    assert la.infer_mime_type(name) == mime


def test_resolve_api_key_precedence(la, monkeypatch, tmp_path):
    assert la._resolve_api_key() is None
    f = tmp_path / "k"
    f.write_text(" filekey \n")
    monkeypatch.setenv("GEMINI_API_KEY_FILE", str(f))
    assert la._resolve_api_key() == "filekey"
    monkeypatch.setenv("GEMINI_API_KEY", "gem")
    assert la._resolve_api_key() == "gem"
    monkeypatch.setenv("GOOGLE_API_KEY", "goog")
    assert la._resolve_api_key() == "goog"


def test_resolve_api_key_unreadable_file_falls_through(la, monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY_FILE", str(tmp_path / "absent"))
    assert la._resolve_api_key() is None


def test_resolve_api_key_reads_macos_agenix_fallback(la, monkeypatch, tmp_path):
    (tmp_path / "agenix").mkdir()
    (tmp_path / "agenix" / "gemini-api-key").write_text("mackey\n")
    monkeypatch.setattr(la.subprocess, "check_output", lambda *a, **k: str(tmp_path) + "\n")
    assert la._resolve_api_key() == "mackey"


def test_analyze_without_key_names_every_source(la, tmp_path):
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    with pytest.raises(ValueError) as e:
        la.analyze_file(str(f), "goal")
    for name in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "GEMINI_API_KEY_FILE"):
        assert name in str(e.value)
    assert FakeClient.instances == []


def test_analyze_missing_file_refuses_before_client(la, monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    with pytest.raises(ValueError, match="File not found"):
        la.analyze_file(str(tmp_path / "absent.png"), "goal")
    assert FakeClient.instances == []


def test_analyze_uploads_with_mime_prompts_and_cleans_up(la, monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    f = tmp_path / "doc.pdf"
    f.write_bytes(b"%PDF")
    assert la.analyze_file(str(f), "get the title") == "EXTRACTED"
    c = FakeClient.instances[0]
    assert c.api_key == "k"
    assert c.uploaded[0][1] == {"mime_type": "application/pdf"}
    model, contents, cfg = c.generated[0]
    assert model == "gemini-3.7-flash"           # the 'vision' role
    assert "Goal: get the title" in contents[1]
    assert cfg.thinking_config.thinking_level == "high" and cfg.tools is None
    assert c.deleted == ["files/abc"]
    assert "Model: gemini-3.7-flash" in capsys.readouterr().err  # provenance on stderr, not stdout


def test_analyze_model_override_and_agentic_tools(la, monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    la.analyze_file(str(f), "g", model="custom-model", agentic=True)
    model, _, cfg = FakeClient.instances[0].generated[0]
    assert model == "custom-model" and cfg.tools[0].code_execution.kind == "code"


def test_analyze_env_model_sweep_applies(la, monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "swept-model")
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    la.analyze_file(str(f), "g")
    assert FakeClient.instances[0].generated[0][0] == "swept-model"


def test_analyze_deletes_upload_even_when_generation_fails(la, monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    monkeypatch.setattr(FakeClient, "__init__", _failing_init(FakeClient.__init__))
    with pytest.raises(RuntimeError, match="api exploded"):
        la.analyze_file(str(f), "g")
    assert FakeClient.instances[0].deleted == ["files/abc"]


def _failing_init(orig):
    def init(self, api_key):
        orig(self, api_key)
        self.fail = True
    return init


def run_main(la, monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["look_at.py", *argv])
    with pytest.raises(SystemExit) as e:
        la.main()
    return e.value.code


@pytest.mark.parametrize("argv", [[], ["--file", "a.png"], ["--goal", "g"]])
def test_main_requires_file_and_goal(la, monkeypatch, argv, capsys):
    assert run_main(la, monkeypatch, *argv) == 2
    assert "required" in capsys.readouterr().err


def test_main_error_paths_exit_1_with_message(la, monkeypatch, capsys):
    assert run_main(la, monkeypatch, "-f", "/nonexistent/x.png", "-g", "g") == 1
    assert "Error:" in capsys.readouterr().err


def test_main_prints_result_on_success(la, monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    monkeypatch.setattr(sys, "argv", ["look_at.py", "-f", str(f), "-g", "g"])
    la.main()
    assert capsys.readouterr().out.strip() == "EXTRACTED"


def test_import_without_sdk_exits_with_install_hint(monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "google", None)  # makes `from google import genai` ImportError
    sys.modules.pop("look_at", None)
    monkeypatch.syspath_prepend(str(HERE))
    with pytest.raises(SystemExit) as e:
        importlib.import_module("look_at")
    assert e.value.code == 1 and "uv run --script" in capsys.readouterr().err
    sys.modules.pop("look_at", None)


# --- look_at.sh -----------------------------------------------------------------------------------

@pytest.fixture
def bindir(tmp_path):
    """Recording stubs for every external the script can invoke, first on PATH."""
    d = tmp_path / "bin"
    d.mkdir()
    log = tmp_path / "calls.log"
    for name in ("claude-code", "agy", "codex", "copilot", "uv", "pdftoppm"):
        p = d / name
        p.write_text(f'#!/bin/sh\nprintf "%s\\n" "{name}" >> "{log}"\n'
                     f'for a in "$@"; do printf "  [%s]\\n" "$a" >> "{log}"; done\n'
                     f'echo "{name}-output"\n'
                     f'if [ "{name}" = pdftoppm ]; then eval "last=\\${{$#}}"; touch "${{last}}-1.png"; fi\n')
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
    # route.ts is reached through `bun`: record its argv apart from calls.log (which holds only
    # backend calls), answer with $BUN_STUB_OUT, or fail with $BUN_STUB_FAIL set.
    b = d / "bun"
    b.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >> "{log.parent / "bun.log"}"\n'
                 'if [ -n "$BUN_STUB_FAIL" ]; then echo "route: boom" >&2; exit 2; fi\n'
                 'if [ -n "$BUN_STUB_OUT" ]; then echo "$BUN_STUB_OUT"; exit 0; fi\n'
                 """echo '{"provider":"gemini","model":"routed-model-9"}'\n""")
    b.chmod(b.stat().st_mode | stat.S_IEXEC)
    return d


def sh(bindir, *args, env_extra=None):
    env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(bindir.parent), "TMPDIR": str(bindir.parent)}
    env.update(env_extra or {})
    r = subprocess.run([BASH, str(SH), *args], capture_output=True, text=True, env=env, timeout=60)
    log = bindir.parent / "calls.log"
    calls = log.read_text() if log.exists() else ""
    return r, calls


@pytest.fixture
def img(tmp_path):
    f = tmp_path / "pic.png"
    f.write_bytes(b"x")
    return f


def test_sh_help_exits_zero_and_lists_backends(bindir):
    r, calls = sh(bindir, "--help")
    assert r.returncode == 0 and "--backend" in r.stdout and "consensus" in r.stdout and calls == ""


def test_sh_unknown_option_is_named_and_usage_nonzero(bindir):
    r, _ = sh(bindir, "--bogus")
    assert r.returncode == 1 and "unknown option: --bogus" in r.stderr


def test_sh_requires_file_then_goal(bindir, img):
    r, _ = sh(bindir, "--goal", "g")
    assert r.returncode == 1 and "--file is required" in r.stderr
    r, _ = sh(bindir, "--file", str(img))
    assert r.returncode == 1 and "--goal is required" in r.stderr


def test_sh_missing_file_refuses_before_any_backend(bindir, tmp_path):
    r, calls = sh(bindir, "-f", str(tmp_path / "nope.png"), "-g", "g")
    assert r.returncode == 1 and "file not found" in r.stderr and calls == ""


def test_sh_unknown_backend_named(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", "-b", "nope")
    assert r.returncode == 1 and "unknown backend 'nope'" in r.stderr and calls == ""


def test_sh_default_backend_is_agy_with_routed_vision_model(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "what is this")
    assert r.returncode == 0 and "agy-output" in r.stdout
    assert calls.startswith("agy\n")
    assert "[routed-model-9]" in calls                 # route.ts's answer, not a pinned id
    assert "[--dangerously-skip-permissions]" in calls
    assert f"[Read the file at {img}. what is this]" in calls
    assert f"[{img.parent}]" in calls                  # --add-dir is the file's directory
    asked = (bindir.parent / "bun.log").read_text()
    assert "scripts/lib/route.ts" in asked
    assert '--row {"kind":"vision","provider":"gemini"}' in asked


def test_sh_model_flag_overrides_route_for_agy(bindir, img):
    _, calls = sh(bindir, "-f", str(img), "-g", "g", "-m", "my-model")
    assert "[my-model]" in calls and "routed-model-9" not in calls
    assert not (bindir.parent / "bun.log").exists()    # an explicit model never consults route.ts


def test_sh_agy_refuses_naming_route_ts_when_it_exits_nonzero(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", env_extra={"BUN_STUB_FAIL": "1"})
    assert r.returncode == 1 and "route.ts" in r.stderr and calls == ""


def test_sh_agy_refuses_an_empty_routed_model(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", env_extra={"BUN_STUB_OUT": '{"provider":"gemini","model":null}'})
    assert r.returncode == 1 and "no model" in r.stderr and calls == ""


def test_sh_claude_backend_uses_claude_code_with_read_tool_only(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", "-b", "claude", "-m", "opus")
    assert r.returncode == 0 and calls.startswith("claude-code\n")
    assert "[--allowed-tools]" in calls and "[Read]" in calls and "[--model]" in calls and "[opus]" in calls


def test_sh_nested_guard_variable_is_set_for_children(bindir, img, tmp_path):
    # the stub records its env var through a wrapper agy
    p = bindir / "agy"
    p.write_text(f'#!/bin/sh\necho "NESTED=$LOOK_AT_NESTED"\n')
    r, _ = sh(bindir, "-f", str(img), "-g", "g")
    assert "NESTED=1" in r.stdout


def test_sh_codex_attaches_image_and_separates_prompt_with_double_dash(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "the goal", "-b", "codex")
    assert r.returncode == 0 and calls.startswith("codex\n")
    assert "[exec]" in calls and "[-i]" in calls and f"[{img}]" in calls
    lines = calls.splitlines()
    assert lines[-2:] == ["  [--]", "  [the goal]"]


def test_sh_codex_pdf_is_rasterized_and_pages_attached(bindir, tmp_path):
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    r, calls = sh(bindir, "-f", str(pdf), "-g", "g", "-b", "codex")
    assert r.returncode == 0
    assert "pdftoppm" in calls and "[-png]" in calls and "page-1.png]" in calls


def test_sh_codex_pdf_without_pdftoppm_names_the_dependency(bindir, tmp_path):
    (bindir / "pdftoppm").unlink()
    core = tmp_path / "core"          # only the utilities the script needs; no pdftoppm
    core.mkdir()
    for u in ("dirname", "basename", "mktemp", "rm", "cat", "python3"):
        (core / u).symlink_to(subprocess.check_output(["which", u], text=True).strip())
    pdf = tmp_path / "d.pdf"
    pdf.write_bytes(b"%PDF")
    r, _ = sh(bindir, "-f", str(pdf), "-g", "g", "-b", "codex", env_extra={"PATH": f"{bindir}:{core}"})
    assert r.returncode != 0 and "pdftoppm (poppler-utils) is required" in r.stderr


def test_sh_copilot_backend_pins_model(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", "-b", "copilot")
    assert r.returncode == 0 and "[gpt-5.4]" in calls and "[--allow-all-tools]" in calls


def test_sh_api_backend_passes_flags_to_python_script(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", "-b", "api", "-a", "-v", "-m", "m1")
    assert r.returncode == 0 and calls.startswith("uv\n")
    assert any(l.endswith("/look_at.py]") for l in calls.splitlines())
    assert "[--script]" in calls
    for tok in ("[--agentic]", "[--verbose]", "[--model]", "[m1]", "[--goal]", "[g]"):
        assert tok in calls


def test_sh_audio_routes_to_metered_api_with_notice(bindir, tmp_path):
    wav = tmp_path / "s.WAV"
    wav.write_bytes(b"x")
    r, calls = sh(bindir, "-f", str(wav), "-g", "g")
    assert "using --backend api (METERED)" in r.stderr and calls.startswith("uv\n")


def test_sh_consensus_needs_two_backends(bindir, img):
    r, calls = sh(bindir, "-f", str(img), "-g", "g", "--consensus", "agy")
    assert r.returncode == 1 and "at least two backends" in r.stderr and calls == ""


def test_sh_consensus_labels_each_backend_and_marks_failures(bindir, img):
    (bindir / "codex").write_text('#!/bin/sh\necho "codex broke" >&2\nexit 3\n')
    r, _ = sh(bindir, "-f", str(img), "-g", "g", "--consensus", "agy,codex,claude")
    assert r.returncode == 0   # consensus reports per-backend failure inline, never aborts
    assert "=== AGY (Antigravity) ===" in r.stdout and "agy-output" in r.stdout
    assert "=== CODEX ===" in r.stdout and "[ERROR] codex backend failed" in r.stdout
    assert "codex broke" in r.stdout
    assert "=== CLAUDE (claude-code) ===" in r.stdout and "claude-code-output" in r.stdout
    assert r.stdout.index("AGY") < r.stdout.index("CODEX") < r.stdout.index("CLAUDE")


def test_sh_consensus_flag_does_not_swallow_following_option(bindir, img):
    r, _ = sh(bindir, "-f", str(img), "-g", "g", "--consensus", "-v")
    # `-v` stays a flag; the default list of four CLI backends all ran
    assert r.returncode == 0 and "consensus: claude agy codex copilot" in r.stderr
    for label in ("=== CLAUDE (", "=== AGY (", "=== CODEX ===", "=== COPILOT ("):
        assert label in r.stdout
