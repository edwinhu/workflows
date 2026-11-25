#!/usr/bin/env python3
"""The legs package-check.sh runs, one per invocation. Stdlib only; run as `python3 -I -B`.

    package_check.py sha256 FILE
    package_check.py (archive|code|leak|rerun) --spec SPEC --extract DIR --tmp DIR

Exit 0 = the leg passed, 1 = it found a defect, 2 = it could not check (spec unusable, a tool or
an input missing, an unexpected error). Every message goes to stderr; the last line is the leg's
count line, `<leg>: N <unit> examined (...)`. The SPEC is references/production-spec.md.
"""
import ast
import collections
import csv
import json
import os
import re
import shlex
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import manifest  # noqa: E402
import strip_code  # noqa: E402

PASS, FAIL, CANNOT = 0, 1, 2
SCANNED_SUFFIXES = {".py", ".sh", ".md", ".txt", ".r"}
BUILTIN_LEAKS = [("/home/", re.compile(r"/home/")), ("/Users/", re.compile(r"/Users/")),
                 ("C:\\Users", re.compile(r"(?i)\bc:[\\/]+users\b"))]
APP_IDENTITY = ("Application", "AppVersion", "Company", "Manager", "Template", "LastModifiedBy",
                "HyperlinkBase")
CORE_KEEP = {("http://purl.org/dc/terms/", "created"), ("http://purl.org/dc/terms/", "modified")}
PDF_IDENTITY = ("Title", "Author", "Subject", "Keywords", "Creator", "Producer")
PNG_TEXT_CHUNKS = {b"tEXt", b"iTXt", b"zTXt", b"eXIf"}
CELL_ERRORS = frozenset({"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"})
TABLE_SUFFIXES = (".csv", ".parquet", ".feather", ".dta", ".tsv")
SCRIPT_SUFFIXES = (".py", ".sh", ".R", ".r")
RERUN_TIMEOUT = 300
SHOWN = 200


class SpecError(Exception):
    pass


class Leg:
    def __init__(self, name: str):
        self.name = name
        self.status = PASS
        self.failures = 0

    def _say(self, kind: str, msg: str) -> None:
        self.failures += 1
        if self.failures <= SHOWN:
            print(f"{self.name} {kind}: " + msg.replace("\n", "\n    "), file=sys.stderr)

    def fail(self, msg: str) -> None:
        self._say("FAIL", msg)
        self.status = max(self.status, FAIL)

    def cannot(self, msg: str) -> None:
        self._say("COULD-NOT-CHECK", msg)
        self.status = CANNOT

    def count(self, n: int, unit: str, detail: str) -> int:
        if self.failures > SHOWN:
            print(f"{self.name} FAIL: {self.failures - SHOWN} more finding(s) not shown", file=sys.stderr)
        print(f"{self.name}: {n} {unit} examined ({detail})", file=sys.stderr)
        return self.status


# --- spec ---------------------------------------------------------------------------------------

def _rel(value, key: str) -> str:
    if not isinstance(value, str) or not value:
        raise SpecError(f"{key} must be a non-empty package-relative path")
    p = Path(value)
    if p.is_absolute() or ".." in p.parts:
        raise SpecError(f"{key} = {value!r} must be relative to the package and stay inside it")
    return p.as_posix()


def _abs(value, key: str) -> Path:
    if not isinstance(value, str) or not os.path.isabs(value):
        raise SpecError(f"{key} must be an absolute path")
    return Path(value)


def _rel_list(spec: dict, key: str, required: bool) -> list[str]:
    if key not in spec or spec[key] is None:
        if required:
            raise SpecError(f"{key} is required")
        return []
    if not isinstance(spec[key], list):
        raise SpecError(f"{key} must be a list")
    return [_rel(v, f"{key}[{i}]") for i, v in enumerate(spec[key])]


def _str_list(spec: dict, key: str) -> list[str]:
    value = spec.get(key) or []
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise SpecError(f"{key} must be a list of non-empty strings")
    return value


def load_spec(path: Path) -> dict:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SpecError(f"cannot read spec {path}: {exc}") from exc
    if not isinstance(spec, dict):
        raise SpecError("spec must be one JSON object")
    name = spec.get("name")
    if not isinstance(name, str) or not name or "/" in name or name in (".", ".."):
        raise SpecError("name must be a plain folder name")
    out = {"name": name}
    out["stage"] = _abs(spec.get("stage"), "stage")
    if out["stage"].name != name:
        raise SpecError(f"stage basename {out['stage'].name!r} must equal name {name!r}")
    out["archive"] = _abs(spec.get("archive"), "archive")
    if out["archive"].is_relative_to(out["stage"]):
        raise SpecError("archive must not sit inside stage, or it would archive itself")
    out["entry_scripts"] = _rel_list(spec, "entry_scripts", True)
    if not out["entry_scripts"]:
        raise SpecError("entry_scripts must name at least one script")
    out["python_paths"] = _rel_list(spec, "python_paths", False)
    out["third_party"] = _str_list(spec, "third_party")
    sources = spec.get("sources") or {}
    if not isinstance(sources, dict):
        raise SpecError("sources must map package .py paths to absolute source paths")
    out["sources"] = {_rel(k, "sources key"): _abs(v, f"sources[{k!r}]") for k, v in sources.items()}
    out["extra_files"] = _rel_list(spec, "extra_files", True)
    out["workbook"] = _rel(spec.get("workbook"), "workbook")
    out["workbook_formulas"] = spec.get("workbook_formulas", True)
    if not isinstance(out["workbook_formulas"], bool):
        raise SpecError("workbook_formulas must be true or false")
    out["runbook_pdf"] = _rel(spec.get("runbook_pdf"), "runbook_pdf")
    out["runbook_source"] = _abs(spec.get("runbook_source"), "runbook_source")
    out["runbook_cwd"] = _rel(spec.get("runbook_cwd") or ".", "runbook_cwd")
    terms = spec.get("leak_terms")
    if not isinstance(terms, list) or not all(isinstance(t, str) and t for t in terms):
        raise SpecError("leak_terms must be a list of regex strings")
    try:
        out["leak_terms"] = [(t, re.compile(t)) for t in terms]
    except re.error as exc:
        raise SpecError(f"leak_terms holds an invalid regex: {exc}") from exc
    out["usernames"] = _str_list(spec, "usernames")
    reruns = spec.get("reruns")
    if reruns is not None and not isinstance(reruns, list):
        raise SpecError("reruns must be a list")
    out["reruns"] = [_rerun(r, i) for i, r in enumerate(reruns or [])]
    return out


def _rerun(r, i: int) -> dict:
    key = f"reruns[{i}]"
    if not isinstance(r, dict):
        raise SpecError(f"{key} must be an object")
    if not isinstance(r.get("name"), str) or not isinstance(r.get("cmd"), str) or not r["cmd"].strip():
        raise SpecError(f"{key} needs a name and a cmd")
    compare = r.get("compare")
    if compare != "bytes":
        if not (isinstance(compare, dict) and set(compare) == {"columns_drop"}
                and isinstance(compare["columns_drop"], list)
                and all(isinstance(c, str) for c in compare["columns_drop"])):
            raise SpecError(f'{key}.compare must be "bytes" or {{"columns_drop": [..]}}')
    timeout = r.get("timeout", RERUN_TIMEOUT)
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        raise SpecError(f"{key}.timeout must be a positive number of seconds")
    return {"name": r["name"], "cwd": _rel(r.get("cwd") or ".", f"{key}.cwd"), "cmd": r["cmd"],
            "output": _rel(r.get("output"), f"{key}.output"),
            "reference": _abs(r.get("reference"), f"{key}.reference"), "compare": compare,
            "timeout": timeout}


def _top(extract: Path, spec: dict, leg: Leg) -> Path | None:
    top = extract / spec["name"]
    if not top.is_dir():
        leg.cannot(f"no extracted tree at {top}; the archive leg could not build or extract it")
        return None
    return top


def _files(top: Path, suffixes: set[str]) -> list[Path]:
    out = []
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if d not in manifest.FORBIDDEN_DIRS)
        out += [Path(dirpath) / f for f in sorted(filenames) if Path(f).suffix.lower() in suffixes]
    return out


def _tool(name: str, leg: Leg) -> str | None:
    path = shutil.which(name)
    if path is None:
        leg.cannot(f"{name} is not on PATH")
    return path


# --- archive ------------------------------------------------------------------------------------

def leg_archive(spec: dict, extract: Path, _tmp: Path) -> int:
    leg = Leg("archive")
    stage, archive, name = spec["stage"], spec["archive"], spec["name"]
    if not stage.is_dir():
        leg.cannot(f"stage {stage} is not a directory")
        return leg.status
    bsdtar = _tool("bsdtar", leg)
    if bsdtar is None:
        return leg.status
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        archive.unlink()
    made = subprocess.run([bsdtar, "--format", "7zip", "-cf", str(archive), "-C", str(stage.parent), name],
                          capture_output=True, text=True)
    if made.returncode != 0:
        leg.cannot(f"bsdtar could not build {archive}: {made.stderr.strip()}")
        return leg.status
    got = subprocess.run([bsdtar, "-xf", str(archive), "-C", str(extract)], capture_output=True, text=True)
    if got.returncode != 0:
        leg.cannot(f"bsdtar could not extract {archive}: {got.stderr.strip()}")
        return leg.status
    tops = sorted(p.name for p in extract.iterdir())
    if tops != [name]:
        leg.fail(f"archive top level is {tops}, not the single folder {name!r}")
    top = extract / name
    if not top.is_dir():
        leg.cannot(f"the archive holds no {name}/ folder")
        return leg.status

    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(top):
        base = Path(dirpath)
        for d in dirnames:
            rel = (base / d).relative_to(top).as_posix()
            if manifest.forbidden(rel):
                leg.fail(f"{rel}/ must not ship")
            if (base / d).is_symlink():
                leg.fail(f"{rel} is a symlink; a production ships files")
        for f in filenames:
            rel = (base / f).relative_to(top).as_posix()
            if manifest.forbidden(rel):
                leg.fail(f"{rel} must not ship")
            if (base / f).is_symlink():
                leg.fail(f"{rel} is a symlink; a production ships files")
            found.append(rel)

    rows = _manifest_rows(top, leg)
    listed = set()
    for row in rows:
        rel = row["path"]
        if rel in listed:
            leg.fail(f"MANIFEST.csv lists {rel} twice")
            continue
        listed.add(rel)
        if rel == manifest.NAME:
            leg.fail("MANIFEST.csv lists itself")
            continue
        path = top / rel
        if not path.is_file():
            leg.fail(f"MANIFEST.csv lists {rel}, which the archive does not hold")
            continue
        actual = dict(zip(manifest.HEADER, manifest.row(path, rel)))
        for key in ("bytes", "sha256", "modified_utc"):
            if row[key] != actual[key]:
                leg.fail(f"{rel}: {key} is {actual[key]} in the archive, {row[key]} in MANIFEST.csv")
    for rel in found:
        if rel != manifest.NAME and rel not in listed:
            leg.fail(f"{rel} is in the archive but not in MANIFEST.csv")
    for key in ("entry_scripts", "extra_files"):
        for rel in spec[key]:
            if not (top / rel).is_file():
                leg.fail(f"{key} names {rel}, which the archive does not hold")
    for key in ("workbook", "runbook_pdf"):
        if not (top / spec[key]).is_file():
            leg.fail(f"{key} {spec[key]} is not in the archive")
    _one_format_per_table(leg, found)
    return leg.count(len(found), "file(s)", f"{len(rows)} manifest row(s), rebuilt {archive.name}")


def _one_format_per_table(leg: Leg, found: list[str]) -> None:
    by_stem: dict[str, list[str]] = collections.defaultdict(list)
    for rel in found:
        p = PurePosixPath(rel)
        if p.suffix.lower() in TABLE_SUFFIXES:
            by_stem[p.with_suffix("").as_posix()].append(rel)
    for stem, rels in sorted(by_stem.items()):
        if len({PurePosixPath(r).suffix.lower() for r in rels}) > 1:
            leg.fail(f"{' and '.join(sorted(rels))}: one table in two formats (path stem {stem}); ship one")


def _manifest_rows(top: Path, leg: Leg) -> list[dict]:
    path = top / manifest.NAME
    if not path.is_file():
        leg.fail("the archive carries no MANIFEST.csv")
        return []
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header != manifest.HEADER:
            leg.fail(f"MANIFEST.csv header is {header}, not {','.join(manifest.HEADER)}")
            return []
        rows = []
        for n, rec in enumerate(reader, start=2):
            if len(rec) != len(manifest.HEADER):
                leg.fail(f"MANIFEST.csv line {n} has {len(rec)} field(s)")
                continue
            row = dict(zip(manifest.HEADER, rec))
            try:
                datetime.strptime(row["modified_utc"], manifest.STAMP).replace(tzinfo=timezone.utc)
            except ValueError:
                leg.fail(f"MANIFEST.csv line {n}: modified_utc {row['modified_utc']!r} is not {manifest.STAMP}")
                continue
            rows.append(row)
    return rows


# --- code ---------------------------------------------------------------------------------------

class _Closure:
    """The import closure of the entry scripts, resolved inside the extracted package."""

    def __init__(self, top: Path, roots: list[Path], allowed: set[str], leg: Leg):
        self.top, self.roots, self.allowed, self.leg = top, roots, allowed, leg
        self.seen: set[Path] = set()

    def _module(self, base: Path, parts: list[str]) -> list[Path] | None:
        """Files a dotted name under base needs (package __init__s plus the module), or None."""
        need: list[Path] = []
        here = base
        for i, part in enumerate(parts):
            last = i == len(parts) - 1
            pkg, mod = here / part, here / f"{part}.py"
            if (pkg / "__init__.py").is_file():
                need.append(pkg / "__init__.py")
                here = pkg
            elif last and mod.is_file():
                need.append(mod)
            elif pkg.is_dir():
                here = pkg
            else:
                return None
        return need

    def _absolute(self, dotted: str) -> list[Path] | None:
        for root in self.roots:
            hit = self._module(root, dotted.split("."))
            if hit is not None:
                return hit
        return None

    def walk(self, entry: Path) -> None:
        queue = [entry]
        while queue:
            path = queue.pop()
            if path in self.seen:
                continue
            self.seen.add(path)
            try:
                tree = ast.parse(strip_code.read_source(path))
            except (SyntaxError, ValueError, UnicodeDecodeError):
                continue
            queue += self._imports(path, tree)

    def _imports(self, path: Path, tree: ast.AST) -> list[Path]:
        rel = path.relative_to(self.top).as_posix()
        found: list[Path] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    found += self._need(rel, alias.name)
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                local = self._absolute(node.module)
                if local is None:
                    self._need(rel, node.module)
                    continue
                found += local
                for alias in node.names:
                    found += self._absolute(f"{node.module}.{alias.name}") or []
            elif isinstance(node, ast.ImportFrom):
                base = path.parent
                for _ in range(node.level - 1):
                    base = base.parent
                if not base.is_relative_to(self.top):
                    self.leg.fail(f"{rel}: relative import climbs out of the package")
                    continue
                if node.module:
                    hit = self._module(base, node.module.split("."))
                    if hit is None:
                        self.leg.fail(f"{rel}: relative import {'.' * node.level}{node.module} is not in the package")
                        continue
                    found += hit
                    base = base.joinpath(*node.module.split("."))
                for alias in node.names:
                    found += (self._module(base, [alias.name]) or []) if base.is_dir() else []
        return found

    def _need(self, rel: str, dotted: str) -> list[Path]:
        hit = self._absolute(dotted)
        if hit is not None:
            return hit
        head = dotted.split(".")[0]
        if head in sys.stdlib_module_names or head in self.allowed:
            return []
        self.leg.fail(f"{rel}: import {dotted} resolves neither inside the package nor to stdlib/third_party")
        return []


def _ruff(ruff: str, files: list[Path]) -> dict[str, collections.Counter] | None:
    if not files:
        return {}
    run = subprocess.run([ruff, "check", "--isolated", "--no-cache", "--ignore-noqa", "--select", "E9,F",
                          "--output-format", "json", "--exit-zero", *map(str, files)],
                         capture_output=True, text=True)
    if run.returncode != 0:
        print(run.stderr, file=sys.stderr)
        return None
    by_file: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for d in json.loads(run.stdout or "[]"):
        msg = re.sub(r"\bline \d+\b", "line N", d.get("message", ""))
        by_file[str(Path(d["filename"]).resolve())][(d.get("code") or "invalid-syntax", msg)] += 1
    return by_file


def leg_code(spec: dict, extract: Path, _tmp: Path) -> int:
    leg = Leg("code")
    top = _top(extract, spec, leg)
    if top is None:
        return leg.status
    py, sh = _files(top, {".py"}), _files(top, {".sh"})
    parsed: dict[Path, ast.Module] = {}
    for path in py:
        rel = path.relative_to(top).as_posix()
        try:
            src = strip_code.read_source(path)
            tree = ast.parse(src)
        except (SyntaxError, ValueError, UnicodeDecodeError) as exc:
            leg.fail(f"{rel} does not parse: {exc}")
            continue
        parsed[path] = tree
        for tok in strip_code.comment_tokens(src):
            leg.fail(f"{rel}:{tok.start[0]}: comment left: {tok.string[:60]!r}")
        for _, expr in strip_code.docstring_nodes(tree):
            leg.fail(f"{rel}:{expr.lineno}: docstring left")
        if strip_code.reads_module_doc(tree) and not strip_code.assigns_module_doc(tree):
            leg.fail(f"{rel} reads __doc__ but carries no module-level __doc__ = assignment")

    starts = []
    for entry in spec["entry_scripts"]:
        if (top / entry).is_file():
            starts.append(top / entry)
        else:
            leg.fail(f"entry script {entry} is not in the archive")
    named = _runbook_named_py(leg, spec, top)
    starts += [p for p in named if p not in starts]
    roots = [top / p for p in spec["python_paths"]] or sorted({p.parent for p in starts})
    closure = _Closure(top, roots, set(spec["third_party"]), leg)
    for start in starts:
        closure.walk(start)
    for path in py:
        if path not in closure.seen:
            leg.fail(f"{path.relative_to(top).as_posix()} is imported by no entry script and named by no "
                     "runbook command; dead code does not ship")

    ruff = _tool("ruff", leg)
    if ruff is not None:
        _ruff_baseline(leg, ruff, top, list(parsed), spec["sources"])

    for path in sh:
        rel = path.relative_to(top).as_posix()
        n = subprocess.run(["bash", "-n", rel], cwd=top, capture_output=True, text=True)
        if n.returncode != 0:
            leg.fail(f"{rel} fails bash -n: {n.stderr.strip()}")
    return leg.count(len(py) + len(sh), "file(s)",
                     f"{len(py)} .py, {len(sh)} .sh, {len(closure.seen)} in the import closure, "
                     f"{len(named)} named by the runbook")


def _runbook_named_py(leg: Leg, spec: dict, top: Path) -> list[Path]:
    """Packaged .py files a runbook command names, resolved under runbook_cwd."""
    source = spec["runbook_source"]
    if not source.is_file():
        leg.cannot(f"runbook_source {source} does not exist, so the scripts its commands name are unknown")
        return []
    base = top / spec["runbook_cwd"]
    out: list[Path] = []
    for cmd in runbook_commands(source.read_text(encoding="utf-8")):
        for cand in script_paths(cmd):
            if not cand.endswith(".py") or os.path.isabs(cand):
                continue
            path = Path(os.path.normpath(base / cand))
            if path.is_file() and path.is_relative_to(top) and path not in out:
                out.append(path)
    return out


def _ruff_baseline(leg: Leg, ruff: str, top: Path, files: list[Path], sources: dict[str, Path]) -> None:
    pairs = {}
    for path in files:
        rel = path.relative_to(top).as_posix()
        src = sources.get(rel)
        if src is not None and not src.is_file():
            leg.cannot(f"sources[{rel!r}] = {src} does not exist, so its ruff baseline is unknown")
            continue
        pairs[path] = src
    packaged = _ruff(ruff, files)
    baseline = _ruff(ruff, sorted({s for s in pairs.values() if s is not None}))
    if packaged is None or baseline is None:
        leg.cannot("ruff did not run")
        return
    for path, src in pairs.items():
        extra = packaged.get(str(path.resolve()), collections.Counter())
        if src is not None:
            extra = extra - baseline.get(str(src.resolve()), collections.Counter())
        for (code, msg), n in sorted(extra.items()):
            leg.fail(f"{path.relative_to(top).as_posix()}: ruff {code} {msg} (x{n}) is not in the source's baseline")


# --- leak ---------------------------------------------------------------------------------------

def _patterns(spec: dict) -> list[tuple[str, re.Pattern]]:
    pats = list(BUILTIN_LEAKS) + list(spec["leak_terms"])
    names = list(spec["usernames"])
    if os.environ.get("USER"):
        names.append(os.environ["USER"])
    for u in dict.fromkeys(names):
        pats.append((f"username {u}", re.compile(rf"(?i)(?<![A-Za-z0-9]){re.escape(u)}(?![A-Za-z0-9])")))
    return pats


def _scan(leg: Leg, where: str, text: str, pats: list[tuple[str, re.Pattern]]) -> None:
    for label, pat in pats:
        for lineno, line in enumerate(text.splitlines(), start=1):
            m = pat.search(line)
            if m:
                leg.fail(f"{where}:{lineno}: {label!r} hit: {line.strip()[:120]!r}")


def _local(tag: str) -> tuple[str, str]:
    if tag.startswith("{"):
        ns, _, local = tag[1:].partition("}")
        return ns, local
    return "", tag


def _workbook(leg: Leg, path: Path, rel: str, pats, need_formulas: bool) -> None:
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        leg.fail(f"{rel} is not a readable workbook: {exc}")
        return
    with zf:
        names = zf.namelist()
        cells: list[str] = []
        formulas = 0
        for part in names:
            sheet = part.startswith("xl/worksheets/") and part.endswith(".xml")
            if part == "xl/sharedStrings.xml" or sheet:
                root = ElementTree.fromstring(zf.read(part))
                for el in root.iter():
                    local = _local(el.tag)[1]
                    if local in ("t", "f") and el.text:
                        cells.append(el.text)
                    if sheet and local == "f":
                        formulas += 1
                    if local != "c":
                        continue
                    v = next((c for c in el if _local(c.tag)[1] == "v"), None)
                    value = (v.text or "").strip() if v is not None else ""
                    if el.get("t") in ("str", "inlineStr", "e") and value:
                        cells.append(value)
                    if sheet and (el.get("t") == "e" or (el.get("t") != "s" and value in CELL_ERRORS)):
                        leg.fail(f"{rel} {part} {el.get('r', '?')}: error cell {value or '(no cached value)'}")
        if need_formulas and not formulas:
            leg.fail(f"{rel}: no sheet carries a formula (<f>); headline numbers must be live formulas, "
                     "or the spec sets workbook_formulas: false")
        if "xl/workbook.xml" in names:
            root = ElementTree.fromstring(zf.read("xl/workbook.xml"))
            cells += [el.get("name", "") for el in root.iter() if _local(el.tag)[1] == "sheet"]
        _scan(leg, f"{rel} cells", "\n".join(cells), pats)
        if "docProps/core.xml" in names:
            for el in ElementTree.fromstring(zf.read("docProps/core.xml")):
                if _local(el.tag) not in CORE_KEEP and ((el.text or "").strip() or len(el)):
                    leg.fail(f"{rel} docProps/core.xml carries {_local(el.tag)[1]} = {(el.text or '').strip()!r}")
        if "docProps/app.xml" in names:
            for el in ElementTree.fromstring(zf.read("docProps/app.xml")):
                if _local(el.tag)[1] in APP_IDENTITY and (el.text or "").strip():
                    leg.fail(f"{rel} docProps/app.xml {_local(el.tag)[1]} = {el.text.strip()!r} is not empty")


def _pdf_text(path: Path, leg: Leg) -> str | None:
    tool = _tool("pdftotext", leg)
    if tool is None:
        return None
    run = subprocess.run([tool, "-enc", "UTF-8", str(path), "-"], capture_output=True, text=True)
    if run.returncode != 0:
        leg.fail(f"pdftotext cannot read {path.name}: {run.stderr.strip()}")
        return None
    return run.stdout


def _pdf_meta(leg: Leg, path: Path, rel: str) -> None:
    tool = _tool("pdfinfo", leg)
    if tool is None:
        return
    info = subprocess.run([tool, str(path)], capture_output=True, text=True)
    if info.returncode != 0:
        leg.fail(f"pdfinfo cannot read {rel}: {info.stderr.strip()}")
        return
    for line in info.stdout.splitlines():
        key = line.split(":", 1)[0]
        if key in PDF_IDENTITY:
            leg.fail(f"{rel} carries {line.strip()!r}")
    meta = subprocess.run([tool, "-meta", str(path)], capture_output=True, text=True)
    if meta.stdout.strip():
        leg.fail(f"{rel} carries an XMP metadata stream")


def _png(leg: Leg, path: Path, rel: str) -> None:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        leg.fail(f"{rel} is not a PNG")
        return
    i = 8
    while i + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[i:i + 8])
        if kind in PNG_TEXT_CHUNKS:
            leg.fail(f"{rel} carries a {kind.decode()} chunk")
        if kind == b"IEND":
            return
        i += 12 + length
    leg.fail(f"{rel} ends without an IEND chunk")


def leg_leak(spec: dict, extract: Path, _tmp: Path) -> int:
    leg = Leg("leak")
    top = _top(extract, spec, leg)
    if top is None:
        return leg.status
    pats = _patterns(spec)
    texts = _files(top, SCANNED_SUFFIXES)
    for path in texts:
        rel = path.relative_to(top).as_posix()
        _scan(leg, rel, path.read_text(encoding="utf-8", errors="replace"), pats)
    n = len(texts)
    pdf = top / spec["runbook_pdf"]
    if pdf.is_file():
        n += 1
        text = _pdf_text(pdf, leg)
        if text is not None:
            _scan(leg, f"{spec['runbook_pdf']} text", text, pats)
        _pdf_meta(leg, pdf, spec["runbook_pdf"])
    else:
        leg.fail(f"runbook_pdf {spec['runbook_pdf']} is not in the archive, so it was not scanned")
    book = top / spec["workbook"]
    if book.is_file():
        n += 1
        _workbook(leg, book, spec["workbook"], pats, spec["workbook_formulas"])
    else:
        leg.fail(f"workbook {spec['workbook']} is not in the archive, so it was not scanned")
    pngs = _files(top, {".png"})
    for path in pngs:
        _png(leg, path, path.relative_to(top).as_posix())
    return leg.count(n + len(pngs), "item(s)",
                     f"{len(texts)} text file(s), runbook PDF, workbook, {len(pngs)} PNG(s)")


# --- rerun --------------------------------------------------------------------------------------

def runbook_commands(md: str) -> list[str]:
    """Logical commands in ```command fences: ` \\`-continued lines joined, whitespace normalised."""
    cmds: list[str] = []
    fence = None
    is_cmd = False
    pending = ""
    for line in md.splitlines():
        stripped = line.strip()
        if fence is None:
            m = re.match(r"^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)", line)
            if m:
                fence, is_cmd, pending = m.group(1), m.group(2) == "command", ""
            continue
        if stripped.startswith(fence[0] * len(fence)) and stripped.strip(fence[0]) == "":
            if is_cmd and pending.strip():
                cmds.append(" ".join(pending.split()))
            fence = None
            continue
        if not is_cmd:
            continue
        body = line.rstrip()
        if body.endswith("\\"):
            pending += body[:-1] + " "
            continue
        pending += body
        if pending.strip():
            cmds.append(" ".join(pending.split()))
        pending = ""
    return cmds


def script_paths(cmd: str) -> list[str]:
    """Every token of a logical command (or the value of a `--flag=` token) naming a script."""
    try:
        tokens = shlex.split(cmd)
    except ValueError:
        tokens = cmd.split()
    out: list[str] = []
    for tok in tokens:
        out += [c for c in dict.fromkeys([tok, tok.split("=", 1)[-1]]) if c.endswith(SCRIPT_SUFFIXES)]
    return out


def _joined(text: str) -> str:
    return " ".join(re.sub(r"\\[ \t]*\r?\n", " ", text).split())


def _dead_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _offline_env() -> dict:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    proxy = f"http://127.0.0.1:{_dead_port()}"
    for key in ("http_proxy", "https_proxy", "all_proxy", "ftp_proxy"):
        env[key] = env[key.upper()] = proxy
    env["no_proxy"] = env["NO_PROXY"] = ""
    return env


def _csv_rows(path: Path, drop: list[str]) -> list[list[str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return rows
    keep = [i for i, h in enumerate(rows[0]) if h not in drop]
    return [[r[i] if i < len(r) else None for i in keep] for r in rows]


def _rerun_one(leg: Leg, top: Path, tmp: Path, r: dict) -> None:
    if not r["reference"].is_file():
        leg.cannot(f"rerun {r['name']}: reference {r['reference']} does not exist")
        return
    copy_root = Path(tempfile.mkdtemp(prefix="rerun.", dir=tmp))
    copy = copy_root / top.name
    shutil.copytree(top, copy, symlinks=True)
    cwd = copy / r["cwd"]
    if not cwd.is_dir():
        leg.fail(f"rerun {r['name']}: cwd {r['cwd']} is not a directory in the archive")
        return
    try:
        run = subprocess.run(["bash", "-c", r["cmd"]], cwd=cwd, env=_offline_env(), capture_output=True,
                             text=True, timeout=r["timeout"], stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        leg.fail(f"rerun {r['name']}: timed out after {r['timeout']}s")
        return
    if run.returncode != 0:
        tail = "\n".join((run.stdout + run.stderr).splitlines()[-15:])
        leg.fail(f"rerun {r['name']}: exited {run.returncode}\n{tail}")
        return
    out = cwd / r["output"]
    if not out.is_file():
        leg.fail(f"rerun {r['name']}: produced no {r['output']}")
        return
    if r["compare"] == "bytes":
        if out.read_bytes() != r["reference"].read_bytes():
            leg.fail(f"rerun {r['name']}: {r['output']} differs from {r['reference'].name} byte for byte")
        return
    drop = r["compare"]["columns_drop"]
    got, want = _csv_rows(out, drop), _csv_rows(r["reference"], drop)
    if got != want:
        first = next((i for i, (a, b) in enumerate(zip(got, want)) if a != b), min(len(got), len(want)))
        leg.fail(f"rerun {r['name']}: {r['output']} differs from {r['reference'].name} "
                 f"after dropping {drop} (first difference at CSV row {first + 1})")


def leg_rerun(spec: dict, extract: Path, tmp: Path) -> int:
    leg = Leg("rerun")
    top = _top(extract, spec, leg)
    if top is None:
        return leg.status
    if not spec["reruns"]:
        leg.fail("reruns is empty or absent; nothing proves the package re-runs offline")
    for r in spec["reruns"]:
        _rerun_one(leg, top, tmp, r)

    source = spec["runbook_source"]
    if not source.is_file():
        leg.cannot(f"runbook_source {source} does not exist")
        return leg.count(len(spec["reruns"]), "item(s)", "runbook not read")
    cmds = runbook_commands(source.read_text(encoding="utf-8"))
    if not cmds:
        leg.fail(f"{source.name} has no ```command block")
    pdf = top / spec["runbook_pdf"]
    text = _pdf_text(pdf, leg) if pdf.is_file() else None
    if not pdf.is_file():
        leg.fail(f"runbook_pdf {spec['runbook_pdf']} is not in the archive")
    if text is not None:
        flat = _joined(text)
        for cmd in cmds:
            if cmd not in flat:
                leg.fail(f"runbook command is not intact in {spec['runbook_pdf']}: {cmd!r}")
    base = top / spec["runbook_cwd"]
    paths = 0
    for cmd in cmds:
        for cand in script_paths(cmd):
            paths += 1
            if os.path.isabs(cand) or not (base / cand).is_file():
                leg.fail(f"runbook command names {cand}, which is not in the archive under {spec['runbook_cwd']}")
    return leg.count(len(spec["reruns"]) + len(cmds) + paths, "item(s)",
                     f"{len(spec['reruns'])} rerun(s), {len(cmds)} runbook command(s), {paths} script path(s)")


# --- entry --------------------------------------------------------------------------------------

LEGS = {"archive": leg_archive, "code": leg_code, "leak": leg_leak, "rerun": leg_rerun}


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "sha256":
        print(manifest.sha256(Path(argv[1])))
        return PASS
    if not argv or argv[0] not in LEGS:
        print(__doc__, file=sys.stderr)
        return CANNOT
    name, opts = argv[0], dict(zip(argv[1::2], argv[2::2]))
    if set(opts) != {"--spec", "--extract", "--tmp"} or len(argv) != 7:
        print(__doc__, file=sys.stderr)
        return CANNOT
    try:
        spec = load_spec(Path(opts["--spec"]))
    except SpecError as exc:
        print(f"{name} COULD-NOT-CHECK: spec: {exc}", file=sys.stderr)
        return CANNOT
    try:
        return LEGS[name](spec, Path(opts["--extract"]), Path(opts["--tmp"]))
    except Exception:
        print(f"{name} COULD-NOT-CHECK: the leg crashed\n{traceback.format_exc()}", file=sys.stderr)
        return CANNOT


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
