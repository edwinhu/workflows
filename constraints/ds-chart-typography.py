#!/usr/bin/env python3
"""Lint chart typography (A5): one registered theme, no per-chart styling, one palette, vector
output, a serif face, and a raster of at least 300 DPI.

Decidable by construction — every finding is a line number, never a judgement about whether a
chart "looks right". The face is checked twice:

- statically, from every theme source the file names: `plt.style.use` (and the `.mplstyle` it
  resolves to, plus any `.mplstyle` in the scanned tree), `rcParams.update`, `rcParams[...] =`,
  `matplotlib.rc(...)`, `sns.set_theme(font=, rc=)`, and the font keys of an Altair or pyobsplot
  theme. A sans or monospace `font.family`, or a known sans face first in line, is a finding;
- with `--render`, by asking matplotlib which FILE it would draw with
  (`findfont(..., fallback_to_default=False)`). A missing serif does not fail loudly on its own:
  matplotlib silently draws DejaVu Sans. Here it is a finding.

The DPI check reads `savefig(..., dpi=N)` and `savefig.dpi`: below 300 fails; below 600 with no
SVG saved in the file warns (the raster is then terminal, and line art with type wants more).

The vector check reads the SOURCE only: a matplotlib save of a `.png` stem with no `.svg` save of
that stem anywhere in the file. Save paths are routinely computed, so a disk check would guess.
pyobsplot files are exempt; their output is SVG already.

A host document that is genuinely sans declares its face as `chart_font` (a name or a list) in the
project's `.claude-workflows.json`; those families are then accepted.

    python3 ds-chart-typography.py <file.py|file.ipynb|file.mplstyle|dir> [--render]
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# run-constraints scope: a writing hook runs that runner on every prose edit, and a chart walk is
# pure cost there.
APPLIES_TO = ["ds"]

CHART = re.compile(r"\balt\.Chart\b|\bplt\.(subplots|figure)\b|\bsns\.\w+plot\b|\.mark_\w+\(")
MPL_CHART = re.compile(r"\bplt\.(subplots|figure)\b|\bsns\.\w+plot\b")
ALT_THEME = re.compile(r"alt\.theme\.register|alt\.themes\.register")
THEME = re.compile(r"alt\.theme\.register|alt\.themes\.register|enable_theme|"
                   r"rcParams\.update|plt\.style\.use|sns\.set_theme")
# Per-chart styling: the hole a theme exists to close.
PER_CHART = re.compile(r"\.configure_(axis|legend|title|text|mark|view)\s*\(|"
                       r"\b(labelFont|titleFont|fontFamily|fontname)\s*=|"
                       r"\bplt\.rc\(")
PYOBSPLOT = re.compile(r"\bfrom\s+pyobsplot\b|\bimport\s+pyobsplot\b|\bPlot\.plot\s*\(")
# A save whose target extension is a literal in the call: savefig("out/fig1.png"), .save(p / "fig1.svg").
SAVE = re.compile(r"\b(?:savefig|save)\s*\([^)]*?[\"']([^\"']*?([\w.\-]+)\.(png|svg))[\"']")
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")
# A palette block is where hex is allowed: a run of assignments near the top of a file.
PALETTE_HINT = re.compile(r"^[A-Z][A-Z0-9_]{2,}\s*=\s*[\"']#[0-9a-fA-F]{6}[\"']")

# Every sans family fc-list reports on the reference machine carries the word "Sans" (Adwaita,
# Liberation, Nimbus, Noto, LM Sans), so the word is that list, host-independent. The seed adds the
# sans faces whose names do not say so.
SANS_SEED = ("arial", "helvetica", "helvetica neue", "liberation sans", "dejavu sans", "inter",
             "pt sans", "open sans", "roboto", "source sans", "source sans pro", "source sans 3",
             "noto sans", "lato", "montserrat", "verdana", "tahoma", "calibri", "segoe ui",
             "carlito", "arimo", "lucida grande", "trebuchet ms", "gill sans", "futura", "avenir",
             "franklin gothic", "ubuntu", "cantarell", "system-ui", "-apple-system",
             "blinkmacsystemfont", "ui-sans-serif")
MONO_SEED = ("courier", "courier new", "consolas", "menlo", "monaco", "cousine", "fira code",
             "jetbrains mono", "source code pro", "ui-monospace")
GENERIC = {"serif": "serif", "ui-serif": "serif", "sans-serif": "sans", "sans": "sans",
           "monospace": "mono", "mono": "mono", "cursive": "other", "fantasy": "other"}
FONT_KEYS = ("font.family", "font.serif", "font.sans-serif", "font.monospace",
             "font.cursive", "font.fantasy")
# Altair config and pyobsplot style keys that carry a CSS font-family.
CSS_FONT_KEYS = {"font", "labelFont", "titleFont", "fontFamily", "font-family"}
DPI_FLOOR, DPI_TERMINAL = 300, 600
_PRUNE = {".planning", "scratch", "__pycache__", ".pixi", "worktrees", "node_modules",
          "external", "vendor", "constraints", ".git", ".venv", "venv"}


def _norm(name: str) -> str:
    return name.strip().strip("'\"").strip().lower()


def face_class(name: str, allow: set[str]) -> str:
    """serif | sans | mono | other | ok (allowed) | unknown (a concrete face nothing marks sans)."""
    n = _norm(name)
    if n in allow:
        return "ok"
    if n in GENERIC:
        return GENERIC[n]
    if re.search(r"\bmono\b|\bcode\b", n) or any(n == s or n.startswith(s + " ") for s in MONO_SEED):
        return "mono"
    if re.search(r"\bsans\b", n) or any(n == s or n.startswith(s + " ") for s in SANS_SEED):
        return "sans"
    if re.search(r"\bserif\b", n):
        return "serif"
    return "unknown"


def families(value) -> list[str]:
    """A font-family value — mplstyle text, CSS list or python list — as a list of names."""
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [p.strip().strip("'\"") for p in str(value).split(",") if p.strip().strip("'\"")]


def chart_font_allow(start: Path) -> set[str]:
    """`chart_font` from the nearest .claude-workflows.json above `start`."""
    home = Path.home()
    p = start.resolve()
    for d in (p, *p.parents):
        cfg = d / ".claude-workflows.json"
        if cfg.is_file():
            try:
                v = json.loads(cfg.read_text()).get("chart_font")
            except (ValueError, OSError):
                return set()
            return {_norm(f) for f in families(v)} if v else set()
        if d == home or d == d.parent:
            break
    return set()


def cells(path: Path) -> list[tuple[int, str]]:
    """(line number, source line) for a .py, or for every code cell of a .ipynb."""
    if path.suffix == ".ipynb":
        nb = json.loads(path.read_text(errors="ignore"))
        out, n = [], 0
        for c in nb.get("cells", []):
            for line in ("".join(c.get("source", ""))).splitlines():
                n += 1
                if c.get("cell_type") == "code":
                    out.append((n, line))
        return out
    return list(enumerate(path.read_text(errors="ignore").splitlines(), start=1))


# ---- theme sources -------------------------------------------------------------------------
# A setting is (key, value, file, line). A source's settings are applied in order, later wins.

def read_mplstyle(path: Path) -> list[tuple[str, str, Path, int]]:
    out = []
    for n, raw in enumerate(path.read_text(errors="ignore").splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if ":" in line:
            k, v = line.split(":", 1)
            out.append((k.strip(), v.strip(), path, n))
    return out


def _const(node, names: dict):
    """A literal (str, number, or list of them), following module-level NAME = literal."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float)):
        return node.value
    if isinstance(node, (ast.List, ast.Tuple)):
        vals = [_const(e, names) for e in node.elts]
        return vals if all(v is not None for v in vals) else None
    if isinstance(node, ast.Name):
        return names.get(node.id)
    return None


def _strs(node) -> list[str]:
    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _is_rcparams(node) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr == "rcParams") or \
           (isinstance(node, ast.Name) and node.id == "rcParams")


def _dict_settings(d: ast.Dict, names, path, mapline):
    out = []
    for k, v in zip(d.keys, d.values):
        key, val = (_const(k, names) if k is not None else None), _const(v, names)
        if isinstance(key, str) and val is not None:
            out.append((key, val, path, mapline(v.lineno)))
    return out


def resolve_style(lit: str, path: Path, root: Path) -> Path | None:
    for base in (path.parent, *path.parent.parents, root, Path.cwd()):
        cand = (base / lit)
        if cand.is_file():
            return cand
    return None


class PySource:
    """What one python file says about its theme, read off its AST."""

    def __init__(self, path: Path, src: list[tuple[int, str]], root: Path):
        self.path, self.settings, self.styles, self.css, self.saves = path, [], [], [], []
        self.unresolved: list[tuple[int, str]] = []
        lines = [l if not l.lstrip().startswith(("%", "!")) else "" for _, l in src]
        lineno = [n for n, _ in src]
        mapline = lambda i: lineno[i - 1] if 0 < i <= len(lineno) else i
        self.tree = None
        try:
            self.tree = ast.parse("\n".join(lines))
        except SyntaxError as e:
            self.parse_error = f"{e.msg} at line {mapline(e.lineno or 0)}"
            return
        self.parse_error = None
        names: dict = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                v = _const(node.value, {})
                if v is not None:
                    names[node.targets[0].id] = v
        events = []  # (line, kind, payload) so styles and rc writes apply in source order
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Subscript) and _is_rcparams(t.value):
                        k, v = _const(t.slice, names), _const(node.value, names)
                        if isinstance(k, str) and v is not None:
                            events.append((node.lineno, "set", (k, v, path, mapline(node.lineno))))
            if isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    key = _const(k, names) if k is not None else None
                    if key in CSS_FONT_KEYS:
                        val = _const(v, names)
                        if isinstance(val, str):
                            self.css.append((key, val, mapline(v.lineno)))
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            fname = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else "")
            ln = mapline(node.lineno)
            if fname == "update" and isinstance(f, ast.Attribute) and _is_rcparams(f.value):
                for a in node.args:
                    if isinstance(a, ast.Dict):
                        events += [(node.lineno, "set", s) for s in _dict_settings(a, names, path, mapline)]
            elif fname == "rc" and node.args:
                group = _const(node.args[0], names)
                if isinstance(group, str):
                    for kw in node.keywords:
                        v = _const(kw.value, names)
                        if kw.arg and v is not None:
                            events.append((node.lineno, "set", (f"{group}.{kw.arg}", v, path, ln)))
            elif fname == "set_theme":
                for kw in node.keywords:
                    if kw.arg == "font":
                        v = _const(kw.value, names)
                        if v is not None:
                            events.append((node.lineno, "set", ("font.family", v, path, ln)))
                    if kw.arg == "rc" and isinstance(kw.value, ast.Dict):
                        events += [(node.lineno, "set", s) for s in _dict_settings(kw.value, names, path, mapline)]
            elif fname == "use" and isinstance(f, ast.Attribute) and isinstance(f.value, ast.Attribute) \
                    and f.value.attr == "style" and node.args:
                lits = [s for s in _strs(node.args[0]) if s.endswith(".mplstyle")]
                if lits:
                    for lit in lits:
                        p = resolve_style(lit, path, root)
                        if p is None:
                            self.unresolved.append((ln, lit))
                        else:
                            events.append((node.lineno, "style", p))
                elif not _strs(node.args[0]):
                    self.unresolved.append((ln, ast.unparse(node.args[0])))
                # a bare name ("ggplot", "seaborn-v0_8") is a built-in sheet: it sets no serif face
            elif fname == "savefig":
                dpi_node = next((kw.value for kw in node.keywords if kw.arg == "dpi"), None)
                dpi = _const(dpi_node, names) if dpi_node is not None else None
                exts = {m.group(1) for s in _strs(node) for m in [re.search(r"\.(png|svg|pdf|jpe?g)$", s)] if m}
                self.saves.append((ln, dpi_node is not None, dpi, exts))
        for _, kind, payload in sorted(events, key=lambda e: e[0]):
            if kind == "style":
                self.styles.append(payload)
                self.settings += read_mplstyle(payload)
            else:
                self.settings.append(payload)


def effective(settings) -> dict:
    """key -> (value, file, line), later writes winning."""
    out = {}
    for k, v, f, n in settings:
        out[k] = (v, f, n)
    return out


def font_findings(eff: dict, allow: set[str], where: str) -> list[str]:
    """The static face check over one theme's effective settings."""
    if "font.family" not in eff:
        return []
    v, f, n = eff["font.family"]
    fams = families(v)
    if not fams:
        return []
    first = fams[0]
    cls = face_class(first, allow)
    fix = ("fix: font.family: serif with font.serif naming the manuscript's face (A5: every glyph "
           "matches the document's type; the host of an exhibit is the manuscript, never the channel; "
           "a genuinely sans manuscript declares chart_font in .claude-workflows.json)")
    if cls in ("sans", "mono") and _norm(first) in GENERIC:
        gen_key = "font.sans-serif" if cls == "sans" else "font.monospace"
        if gen_key in eff and families(eff[gen_key][0]) and face_class(families(eff[gen_key][0])[0], allow) == "ok":
            return []
        return [(f"{f}:{n}: A5 font: font.family is {first} — the chart draws a "
                 f"{'sans' if cls == 'sans' else 'monospace'} face beside serif prose{where}; {fix}")]
    if cls in ("sans", "mono"):
        return [f"{f}:{n}: A5 font: font.family names {first}, a {cls} face{where}; {fix}"]
    if cls == "serif" and _norm(first) in GENERIC and "font.serif" in eff:
        sv, sf, sn = eff["font.serif"]
        sfams = families(sv)
        if sfams and face_class(sfams[0], allow) in ("sans", "mono"):
            return [(f"{sf}:{sn}: A5 font: font.serif puts {sfams[0]} first, a sans face, so "
                     f"'serif' draws sans{where}; {fix}")]
    return []


def css_findings(path: Path, css, allow: set[str]) -> list[str]:
    out = []
    for key, val, n in css:
        fams = families(val)
        if fams and face_class(fams[0], allow) in ("sans", "mono"):
            out.append(f"{path}:{n}: A5 font: theme key {key} is {val!r}, a "
                       f"{face_class(fams[0], allow)} face first; fix: name the manuscript's serif face "
                       "first, with a serif generic after it")
    return out


def dpi_findings(path: Path, ps: PySource, eff: dict, has_svg: bool) -> tuple[list[str], list[str]]:
    bad, warn = [], []
    theme_dpi = None
    if "savefig.dpi" in eff:
        v, f, n = eff["savefig.dpi"]
        try:
            theme_dpi = float(v)
        except (TypeError, ValueError):
            theme_dpi = None  # 'figure': the figure's own dpi, read per call below
        if theme_dpi is not None and theme_dpi < DPI_FLOOR:
            bad.append(f"{f}:{n}: A5 DPI: savefig.dpi is {v} — the raster floor is {DPI_FLOOR}; "
                       f"fix: savefig.dpi: {DPI_TERMINAL} (or derive it from the placed width)")
    for n, has_kw, dpi, exts in ps.saves:
        if exts and exts <= {"svg", "pdf"}:
            continue
        if has_kw and isinstance(dpi, (int, float)):
            if dpi < DPI_FLOOR:
                bad.append(f"{path}:{n}: A5 DPI: savefig(dpi={dpi:g}) is below the {DPI_FLOOR} DPI raster "
                           f"floor; fix: dpi={DPI_TERMINAL}, or derive it from the placed width and assert "
                           f">= {DPI_FLOOR}")
            elif dpi < DPI_TERMINAL and not has_svg:
                warn.append(f"{path}:{n}: A5 DPI (warn): savefig(dpi={dpi:g}) with no SVG saved in this file "
                            f"— the raster is terminal, and line art with type wants {DPI_TERMINAL}")
        elif not has_kw and "png" in exts and theme_dpi is None:
            bad.append(f"{path}:{n}: A5 DPI: a .png saved with no dpi= and no savefig.dpi in the theme — "
                       f"matplotlib writes figure.dpi (100); fix: dpi={DPI_TERMINAL}")
    return bad, warn


# ---- render probe --------------------------------------------------------------------------

PROBE = r"""
import json, sys
import matplotlib
matplotlib.use("Agg")
from matplotlib import font_manager as fm
out = []
for item in json.load(sys.stdin):
    with matplotlib.rc_context(item["rc"]):
        try:
            p = fm.findfont(fm.FontProperties(family=item["family"]), fallback_to_default=False)
            out.append({"file": p, "family": fm.get_font(p).family_name})
        except Exception as e:
            out.append({"error": str(e).split(":style=")[0]})
print(json.dumps(out))
"""


def probe_cmd() -> list[str] | None:
    if importlib.util.find_spec("matplotlib") is not None:
        return [sys.executable, "-c", PROBE]
    if shutil.which("uv"):
        return ["uv", "run", "-q", "--with", "matplotlib", "python3", "-c", PROBE]
    return None


def render_findings(themes, allow: set[str]) -> list[str]:
    """themes: [(label, file, line, eff)]. One findfont per theme that sets a family."""
    items, meta = [], []
    for label, f, n, eff in themes:
        fam = families(eff["font.family"][0]) if "font.family" in eff else ["sans-serif"]
        rc = {k: families(eff[k][0]) for k in FONT_KEYS if k in eff}
        rc["font.family"] = fam
        items.append({"rc": rc, "family": fam})
        meta.append((label, f, n, fam))
    if not items:
        return []
    cmd = probe_cmd()
    if cmd is None:
        raise RuntimeError("--render needs matplotlib, and neither this python nor uv can supply it")
    r = subprocess.run(cmd, input=json.dumps(items), capture_output=True, text=True, timeout=300,
                       check=False)
    if r.returncode != 0:
        raise RuntimeError(f"render probe failed: {r.stderr.strip()[-400:]}")
    out = []
    for (label, f, n, fam), res in zip(meta, json.loads(r.stdout.strip().splitlines()[-1])):
        want = ", ".join(fam)
        if "error" in res:
            out.append(f"{f}:{n}: A5 render: no installed face for font.family [{want}] ({label}) — "
                       "matplotlib silently falls back to DejaVu Sans; fix: install the serif, or name "
                       "one `fc-list : family | grep -i serif` lists")
            continue
        cls = face_class(res["family"], allow)
        if cls in ("sans", "mono"):
            out.append(f"{f}:{n}: A5 render: font.family [{want}] ({label}) resolves to "
                       f"{res['family']} ({Path(res['file']).name}), a {cls} face; fix: font.family: "
                       "serif with font.serif naming the manuscript's face")
    return out


# ---- per file ------------------------------------------------------------------------------

def check(path, root: Path | None = None, allow: set[str] | None = None, themes=None,
          warnings: list[str] | None = None) -> list[str]:
    """Findings for one file. A run-constraints context ({"cwd": dir}) scans that directory."""
    if isinstance(path, dict):
        return scan(Path(path.get("cwd", ".")))[0]
    path = Path(path)
    root = root or (path if path.is_dir() else path.parent)
    allow = chart_font_allow(root) if allow is None else allow
    if path.suffix == ".mplstyle":
        eff = effective(read_mplstyle(path))
        if themes is not None and "font.family" in eff:
            themes.append(("style sheet", path, eff["font.family"][2], eff))
        bad = font_findings(eff, allow, "")
        if "savefig.dpi" in eff:
            v, f, n = eff["savefig.dpi"]
            try:
                if float(v) < DPI_FLOOR:
                    bad.append(f"{f}:{n}: A5 DPI: savefig.dpi is {v} — the raster floor is {DPI_FLOOR}; "
                               f"fix: savefig.dpi: {DPI_TERMINAL}")
            except ValueError:
                pass
        return bad

    src = cells(path)
    body = "\n".join(l for _, l in src)
    if not CHART.search(body):
        return []

    bad: list[str] = []
    if not THEME.search(body):
        bad.append(f"{path}: charts but no registered theme — style is set chart by chart, "
                   "so the next chart added will silently keep the library default")

    for n, line in src:
        if line.lstrip().startswith("#"):
            continue
        if PER_CHART.search(line):
            bad.append(f"{path}:{n}: per-chart styling overrides the theme — {line.strip()[:70]}")

    if not PYOBSPLOT.search(body):
        svg_stems = {m.group(2) for _, l in src for m in SAVE.finditer(l) if m.group(3) == "svg"}
        for n, line in src:
            if line.lstrip().startswith("#"):
                continue
            for m in SAVE.finditer(line):
                if m.group(3) == "png" and m.group(2) not in svg_stems:
                    bad.append(f"{path}:{n}: figure saved as .png with no .svg at the same stem "
                               f"({m.group(2)}.svg) — the vector is the artifact of record")

    palette_lines = {n for n, l in src if PALETTE_HINT.match(l.strip())}
    loose = [(n, l) for n, l in src
             if HEX.search(l) and n not in palette_lines and not l.lstrip().startswith("#")]
    if loose and palette_lines:
        for n, l in loose[:8]:
            bad.append(f"{path}:{n}: hex colour outside the palette block — {l.strip()[:70]}")

    ps = PySource(path, src, root)
    if ps.parse_error:
        bad.append(f"{path}: A5 font: could not parse ({ps.parse_error}), so its theme's face and DPI "
                   "are unchecked; fix the syntax error")
        return bad
    for n, lit in ps.unresolved:
        bad.append(f"{path}:{n}: A5 font: plt.style.use({lit}) resolves to no file, so the face is "
                   "unchecked; fix: pass a path to the .mplstyle that exists from this file or the project")
    eff = effective(ps.settings)
    mpl = bool(MPL_CHART.search(body))
    where = f" (theme of {path.name})" if ps.styles and eff.get("font.family", (0, path))[1] != path else ""
    bad += font_findings(eff, allow, where)
    bad += css_findings(path, ps.css, allow)
    first_theme = next((n for n, l in src if THEME.search(l)), None)
    if mpl and first_theme is not None and "font.family" not in eff and not ps.unresolved:
        bad.append(f"{path}:{first_theme}: A5 font: the theme never sets font.family, so matplotlib draws "
                   "its default DejaVu Sans; fix: font.family: serif with font.serif naming the "
                   "manuscript's face")
    if ALT_THEME.search(body) and not ps.css:
        bad.append(f"{path}:{next(n for n, l in src if ALT_THEME.search(l))}: A5 font: the Altair theme "
                   "sets no font, so Vega draws its sans default; fix: font, labelFont and titleFont "
                   "naming the manuscript's serif face")
    has_svg = bool(re.search(r"[\"'](?:[^\"']*\.)?svg[\"']", body))
    dbad, dwarn = dpi_findings(path, ps, eff, has_svg)
    bad += dbad
    if warnings is not None:
        warnings += dwarn
    if themes is not None and mpl and first_theme is not None:
        if "font.family" in eff:
            themes.append((f"theme of {path.name}", eff["font.family"][1], eff["font.family"][2], eff))
        elif not ps.unresolved:
            themes.append((f"theme of {path.name}", path, first_theme, eff))
    return bad


def walk(target: Path) -> list[Path]:
    if not target.is_dir():
        return [target]
    out = []
    for d, dirs, files in os.walk(target):
        # Another session's worktree, a vendored upstream and a build tree are not ours to judge.
        # `constraints` too: a checker ABOUT charts is not a file that draws one.
        dirs[:] = sorted(x for x in dirs if x not in _PRUNE and not x.startswith("."))
        out += [Path(d) / f for f in sorted(files) if Path(f).suffix in {".py", ".ipynb", ".mplstyle"}]
    return out


def scan(target: Path, render: bool = False) -> tuple[list[str], list[str], int]:
    """(findings, warnings, files examined: charted files plus style sheets)."""
    root = target if target.is_dir() else target.parent
    allow = chart_font_allow(root)
    files = walk(target)
    themes, warnings, findings = [], [], []
    examined = 0
    for p in files:
        if p.suffix == ".mplstyle":
            continue
        got = check(p, root, allow, themes, warnings)
        findings += got
        if CHART.search("\n".join(l for _, l in cells(p))):
            examined += 1
    # A sheet a charted file loads has already been judged through that file; the rest stand alone.
    used = {t[1].resolve() for t in themes if isinstance(t[1], Path)}
    for p in files:
        if p.suffix == ".mplstyle":
            examined += 1
            if p.resolve() in used:
                continue
            findings += check(p, root, allow, themes if render else None)
    findings = list(dict.fromkeys(findings))
    if render:
        uniq, keys = [], set()
        for t in themes:
            key = (str(t[1]), t[2], json.dumps({k: str(v[0]) for k, v in t[3].items() if k in FONT_KEYS}))
            if key not in keys:
                keys.add(key)
                uniq.append(t)
        findings += render_findings(uniq, allow)
    return findings, warnings, examined


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--render"]
    if not args:
        print(__doc__)
        return 2
    target = Path(args[0])
    if not target.exists():
        print(f"COULD-NOT-RUN: no file or directory named {target}", file=sys.stderr)
        return 2
    try:
        findings, warnings, examined = scan(target, render="--render" in sys.argv)
    except RuntimeError as e:
        print(f"COULD-NOT-CHECK: {e}", file=sys.stderr)
        return 2
    for f in findings:
        print(f)
    for w in warnings:
        print(w)
    print(f"\n{len(findings)} finding(s), {len(warnings)} warning(s)")
    if examined:
        print(f"chart-typography: {examined} file(s) examined (charted files and style sheets)")
    else:
        print("chart-typography: 0 file(s) examined — nothing in scope (no chart code or style sheet)")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
