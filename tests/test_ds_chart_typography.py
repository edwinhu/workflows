"""ds-chart-typography must see a sans-serif chart and a low-DPI raster, statically and rendered.

Run: python3 -m pytest tests/test_ds_chart_typography.py -v

On 2026-10-07 a founder-ceo-ipo theme set `font.family: sans-serif` (Liberation Sans, Arial) and
its figures saved PNGs at 200 dpi; the lint exited 0. `fixtures/ds-chart-typography/founder-v2`
holds that theme verbatim. The render cases shell out to matplotlib (this python's, else
`uv run --with matplotlib`), because only findfont knows a missing serif became DejaVu Sans.
"""

import importlib.util
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINT = os.path.join(ROOT, "constraints", "ds-chart-typography.py")
FIX = os.path.join(ROOT, "tests", "fixtures", "ds-chart-typography")

_SPEC = importlib.util.spec_from_file_location("ds_chart_typography", LINT)
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)


def _run(target, *flags):
    r = subprocess.run([sys.executable, LINT, str(target), *flags], capture_output=True, text=True,
                       timeout=300, check=False)
    return r.returncode, r.stdout + r.stderr


def _lint(tmp_path, files, *flags):
    for name, body in files.items():
        (tmp_path / name).write_text(body)
    return _run(tmp_path, *flags)


MPL = "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\n"


# ---- the founder-ceo-ipo v2 theme fails all three ------------------------------------------

def test_v2_theme_fails_the_static_font_check():
    rc, out = _run(os.path.join(FIX, "founder-v2"))
    assert rc == 1
    assert "paper.mplstyle:3: A5 font: font.family is sans-serif" in out


def test_v2_figure_fails_the_dpi_check():
    _, out = _run(os.path.join(FIX, "founder-v2"))
    assert "figure.py:12: A5 DPI: savefig(dpi=200) is below the 300 DPI raster floor" in out


def test_v2_theme_fails_the_render_check():
    rc, out = _run(os.path.join(FIX, "founder-v2"), "--render")
    assert rc == 1
    # Liberation Sans where installed; a fallback to DejaVu Sans where not. Either is a sans finding.
    assert "A5 render: font.family [sans-serif]" in out and ("a sans face" in out or "no installed face" in out)


def test_serif_twin_at_600_dpi_passes_static_and_render():
    for flags in ((), ("--render",)):
        rc, out = _run(os.path.join(FIX, "serif-600"), *flags)
        assert rc == 0, out
        assert "0 finding(s), 0 warning(s)" in out
        assert "chart-typography: 2 file(s) examined" in out


def test_uninstalled_serif_passes_static_but_fails_render():
    rc, out = _run(os.path.join(FIX, "uninstalled-serif"))
    assert rc == 0, out
    rc, out = _run(os.path.join(FIX, "uninstalled-serif"), "--render")
    assert rc == 1
    assert "paper.mplstyle:3: A5 render: no installed face for font.family [serif]" in out


# ---- every theme source the lint recognises ------------------------------------------------

def test_rcparams_update_with_a_concrete_sans_face(tmp_path):
    rc, out = _lint(tmp_path, {"f.py": "plt.rcParams.update({'font.family': 'DejaVu Sans'})\n" + MPL})
    assert rc == 1 and "f.py:1: A5 font: font.family names DejaVu Sans, a sans face" in out


def test_rcparams_subscript_and_a_constant(tmp_path):
    body = "FACE = 'Helvetica'\nplt.rcParams.update({})\nplt.rcParams['font.family'] = FACE\n" + MPL
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:3: A5 font: font.family names Helvetica" in out


def test_matplotlib_rc_call(tmp_path):
    body = "import matplotlib\nmatplotlib.rc('font', family='monospace')\nplt.style.use('ggplot')\n" + MPL
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:2: A5 font: font.family is monospace" in out


def test_serif_generic_with_a_sans_face_first_in_font_serif(tmp_path):
    body = "plt.rcParams.update({'font.family': 'serif', 'font.serif': ['Arial', 'Times']})\n" + MPL
    _, out = _lint(tmp_path, {"f.py": body})
    assert "font.serif puts Arial first" in out


def test_a_theme_that_never_sets_the_family_draws_dejavu_sans(tmp_path):
    rc, out = _lint(tmp_path, {"f.py": "plt.rcParams.update({'font.size': 12})\n" + MPL})
    assert rc == 1 and "f.py:1: A5 font: the theme never sets font.family" in out


def test_altair_theme_with_a_sans_font(tmp_path):
    body = ("import altair as alt\n@alt.theme.register('paper', enable=True)\ndef t():\n"
            "    return {'config': {'axis': {'labelFont': 'Inter, sans-serif'}}}\nc = alt.Chart(df)\n")
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:4: A5 font: theme key labelFont is 'Inter, sans-serif'" in out


def test_a_stray_mplstyle_in_the_tree_is_judged_alone(tmp_path):
    rc, out = _lint(tmp_path, {"other.mplstyle": "font.family: sans-serif\nsavefig.dpi: 150\n"})
    assert rc == 1
    assert "other.mplstyle:1: A5 font" in out and "other.mplstyle:2: A5 DPI: savefig.dpi is 150" in out


def test_serif_faces_pass(tmp_path):
    body = ("plt.rcParams.update({'font.family': 'serif', 'font.serif': ['Liberation Serif']})\n" + MPL
            + "fig.savefig('a.svg')\nfig.savefig('a.png', dpi=600)\n")
    rc, out = _lint(tmp_path, {"f.py": body})
    assert rc == 0, out


def test_chart_font_in_claude_workflows_json_allows_a_declared_sans_host(tmp_path):
    body = "plt.rcParams.update({'font.family': 'sans-serif', 'font.sans-serif': ['Inter']})\n" + MPL
    rc, out = _lint(tmp_path, {"f.py": body})
    assert rc == 1
    (tmp_path / ".claude-workflows.json").write_text(json.dumps({"chart_font": "Inter"}))
    rc, out = _run(tmp_path)
    assert rc == 0, out


# ---- DPI -----------------------------------------------------------------------------------

def test_dpi_from_a_constant_at_the_floor_passes(tmp_path):
    body = ("plt.rcParams.update({'font.family': 'serif'})\nDPI = 300\n" + MPL
            + "for e in ('svg', 'png'):\n    fig.savefig(p.with_suffix('.' + e), dpi=DPI)\n")
    rc, out = _lint(tmp_path, {"f.py": body})
    assert rc == 0, out


def test_png_with_no_dpi_anywhere_is_100_dpi(tmp_path):
    body = "plt.rcParams.update({'font.family': 'serif'})\n" + MPL + "fig.savefig('a.svg')\nfig.savefig('a.png')\n"
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:5: A5 DPI: a .png saved with no dpi=" in out


def test_savefig_dpi_in_the_theme_is_read(tmp_path):
    body = ("plt.rcParams.update({'font.family': 'serif', 'savefig.dpi': 200})\n" + MPL
            + "fig.savefig('a.svg')\nfig.savefig('a.png')\n")
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:1: A5 DPI: savefig.dpi is 200" in out
    assert "no dpi=" not in out


def test_below_600_with_no_svg_warns_without_failing(tmp_path):
    body = "plt.rcParams.update({'font.family': 'serif'})\n" + MPL + "fig.savefig(out, dpi=300)\n"
    rc, out = _lint(tmp_path, {"f.py": body})
    assert rc == 0, out
    assert "f.py:4: A5 DPI (warn): savefig(dpi=300) with no SVG saved" in out


# ---- the four checks that predate this file still fire --------------------------------------

def test_no_theme(tmp_path):
    rc, out = _lint(tmp_path, {"f.py": MPL})
    assert rc == 1 and "charts but no registered theme" in out


def test_per_chart_styling(tmp_path):
    body = "plt.rcParams.update({'font.family': 'serif'})\n" + MPL + "ax.set_title('x', fontname='Times')\n"
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:4: per-chart styling overrides the theme" in out


def test_png_without_a_same_stem_svg(tmp_path):
    body = "plt.rcParams.update({'font.family': 'serif'})\n" + MPL + "fig.savefig('out/fig1.png', dpi=600)\n"
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:4: figure saved as .png with no .svg at the same stem (fig1.svg)" in out


def test_hex_outside_the_palette_block(tmp_path):
    body = ("INK = '#0b0b0b'\nplt.rcParams.update({'font.family': 'serif'})\n" + MPL
            + "ax.plot(x, y, color='#ff0000')\n")
    _, out = _lint(tmp_path, {"f.py": body})
    assert "f.py:5: hex colour outside the palette block" in out


# ---- runners -------------------------------------------------------------------------------

def test_no_chart_code_is_nothing_in_scope_not_a_pass_over_nothing(tmp_path):
    rc, out = _lint(tmp_path, {"f.py": "x = 1\n"})
    assert rc == 0
    assert "chart-typography: 0 file(s) examined — nothing in scope (no chart code or style sheet)" in out


def test_run_constraints_context_scans_the_directory(tmp_path):
    (tmp_path / "f.py").write_text("plt.rcParams.update({'font.family': 'Arial'})\n" + MPL)
    got = _MOD.check({"cwd": str(tmp_path)})
    assert len(got) == 1 and "font.family names Arial" in got[0]
