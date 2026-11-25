#!/usr/bin/env python3
"""Strip comments and docstrings from Python source bound for a production.

    strip_code.py SRC DEST              write SRC, stripped, to DEST (mode copied from SRC)
    strip_code.py --in-place FILE...    rewrite each FILE stripped

Comments are found with tokenize and docstrings with ast; nothing is matched by regex. A line-1
shebang stays. A module that reads `__doc__` keeps that text as a module-level `__doc__ = ...`
assignment (placed after any __future__ import), or `__doc__ = None` when it had no docstring, so
the script still runs. A body left empty becomes `pass`. The result is parsed and re-checked before
it is written; a file that would not parse, or still carries a comment or docstring, is refused
(exit 1). package-check.sh's code leg imports comment_tokens, docstring_nodes, reads_module_doc
and assigns_module_doc, so the stripper and the gate share one definition of each.
"""
import ast
import io
import shutil
import sys
import tokenize
from pathlib import Path

DOC_OWNERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
_SPAN_START = {getattr(tokenize, n) for n in ("FSTRING_START", "TSTRING_START") if hasattr(tokenize, n)}
_SPAN_END = {getattr(tokenize, n) for n in ("FSTRING_END", "TSTRING_END") if hasattr(tokenize, n)}


def read_source(path: Path) -> str:
    """Decode per PEP 263 (cookie or BOM, else UTF-8), newlines normalised to \\n."""
    with tokenize.open(path) as fh:
        return fh.read()


def comment_tokens(src: str) -> list[tokenize.TokenInfo]:
    """Every COMMENT token except a shebang at line 1, column 0."""
    return [
        t for t in tokenize.generate_tokens(io.StringIO(src).readline)
        if t.type == tokenize.COMMENT and not (t.start == (1, 0) and t.string.startswith("#!"))
    ]


def docstring_nodes(tree: ast.AST) -> list[tuple[ast.AST, ast.Expr]]:
    """(owner, statement) for every module, class and function whose first statement is a str literal."""
    out = []
    for node in ast.walk(tree):
        if isinstance(node, DOC_OWNERS) and node.body:
            first = node.body[0]
            if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                out.append((node, first))
    return out


def reads_module_doc(tree: ast.AST) -> bool:
    return any(isinstance(n, ast.Name) and n.id == "__doc__" and isinstance(n.ctx, ast.Load)
               for n in ast.walk(tree))


def assigns_module_doc(tree: ast.Module) -> bool:
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            targets = stmt.targets
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            targets = [stmt.target]
        else:
            continue
        if any(isinstance(t, ast.Name) and t.id == "__doc__" for t in targets):
            return True
    return False


class _Text:
    """Line table for one source string: converts ast (byte) and tokenize (char) positions to offsets."""

    def __init__(self, src: str):
        self.src = src
        self.lines = io.StringIO(src).readlines()
        self.starts = [0]
        for line in self.lines:
            self.starts.append(self.starts[-1] + len(line))

    def line_start(self, row: int) -> int:
        return self.starts[min(row - 1, len(self.lines))]

    def char(self, row: int, col: int) -> int:
        return self.line_start(row) + col

    def byte(self, row: int, col: int) -> int:
        line = self.lines[row - 1] if row - 1 < len(self.lines) else ""
        return self.line_start(row) + len(line.encode("utf-8")[:col].decode("utf-8", "ignore"))

    def line_end(self, row: int) -> int:
        """Offset of the line's newline (or end of text)."""
        line = self.lines[row - 1] if row - 1 < len(self.lines) else ""
        return self.line_start(row) + len(line.rstrip("\r\n"))


def _stmt_start_row(node: ast.stmt) -> int:
    return min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])])


def _doc_assignment(src: str, expr: ast.Expr | None) -> str:
    if expr is None:
        return "__doc__ = None"
    seg = ast.get_source_segment(src, expr.value)
    if seg is not None:
        try:
            parsed = ast.parse("__doc__ = " + seg)
            value = parsed.body[0].value
            if isinstance(value, ast.Constant) and value.value == expr.value.value:
                return "__doc__ = " + seg
        except SyntaxError:
            pass
    return "__doc__ = " + repr(expr.value.value)


def _edits(src: str, tree: ast.Module) -> list[tuple[int, int, str]]:
    text = _Text(src)
    edits: list[tuple[int, int, str]] = []

    for tok in comment_tokens(src):
        row, col = tok.start
        line = text.lines[row - 1]
        end = text.char(row, col) + len(tok.string)
        if line[:col].strip() == "":
            edits.append((text.line_start(row), text.line_start(row + 1), ""))
        else:
            edits.append((text.line_start(row) + len(line[:col].rstrip()), end, ""))

    module_doc = None
    for owner, expr in docstring_nodes(tree):
        if owner is tree:
            module_doc = expr
        s = text.byte(expr.lineno, expr.col_offset)
        t = text.byte(expr.end_lineno, expr.end_col_offset)
        if len(owner.body) == 1 and owner is not tree:
            edits.append((s, t, "pass"))
            continue
        rest = src[t:text.line_end(expr.end_lineno)]
        if rest.lstrip().startswith(";"):
            t += len(rest) - len(rest.lstrip()) + 1
            rest = src[t:text.line_end(expr.end_lineno)]
        before = src[text.line_start(expr.lineno):s]
        if before.strip() == "" and rest.strip() == "":
            s, t = text.line_start(expr.lineno), text.line_start(expr.end_lineno + 1)
        edits.append((s, t, ""))

    if reads_module_doc(tree) and not assigns_module_doc(tree):
        assignment = _doc_assignment(src, module_doc)
        body = [b for b in tree.body if b is not module_doc]
        future = []
        for stmt in body:
            if isinstance(stmt, ast.ImportFrom) and stmt.module == "__future__":
                future.append(stmt)
            else:
                break
        if future:
            at = text.line_start(future[-1].end_lineno + 1)
            prefix = "" if text.src[:at].endswith("\n") or at == 0 else "\n"
            edits.append((at, at, prefix + assignment + "\n"))
        elif body:
            at = text.line_start(_stmt_start_row(body[0]))
            edits.append((at, at, assignment + "\n"))
        else:
            edits.append((len(src), len(src), assignment + "\n"))
    return edits


def _apply(src: str, edits: list[tuple[int, int, str]]) -> str:
    ordered = sorted(edits, key=lambda e: (e[0], e[1]))
    for (s1, t1, _), (s2, _, _) in zip(ordered, ordered[1:]):
        if s2 < t1:
            raise ValueError(f"overlapping edits at offsets {s1}-{t1} and {s2}")
    out = src
    for s, t, rep in reversed(ordered):
        out = out[:s] + rep + out[t:]
    return out


def _string_rows(src: str) -> set[int]:
    """Rows (1-based) that begin inside a multi-line string, which must be left byte-for-byte."""
    rows: set[int] = set()
    stack: list[int] = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.STRING and tok.end[0] > tok.start[0]:
            rows.update(range(tok.start[0] + 1, tok.end[0] + 1))
        elif tok.type in _SPAN_START:
            stack.append(tok.start[0])
        elif tok.type in _SPAN_END and stack:
            rows.update(range(stack.pop() + 1, tok.end[0] + 1))
    return rows


def _tidy(src: str) -> str:
    """Drop whitespace-only lines the edits left, leading blank lines, and blank runs over two."""
    protected = _string_rows(src)
    out: list[str] = []
    blank_run = 0
    seen_code = False
    for row, line in enumerate(io.StringIO(src).readlines(), start=1):
        if row in protected:
            out.append(line)
            blank_run = 0
            continue
        if line.strip() == "":
            if line.rstrip("\r\n") != "" or not seen_code or blank_run >= 2:
                continue
            blank_run += 1
            out.append(line)
            continue
        blank_run = 0
        seen_code = seen_code or not (row == 1 and line.startswith("#!"))
        out.append(line)
    text = "".join(out).rstrip("\n")
    return text + "\n" if text else ""


def verify(out: str, needs_doc: bool) -> list[str]:
    """Problems with stripped output; empty when it parses, is clean, and keeps __doc__ defined."""
    try:
        tree = ast.parse(out)
    except SyntaxError as exc:
        return [f"output does not parse: {exc}"]
    problems = [f"comment left at line {t.start[0]}" for t in comment_tokens(out)]
    problems += [f"docstring left at line {e.lineno}" for _, e in docstring_nodes(tree)]
    if needs_doc and not assigns_module_doc(tree):
        problems.append("module reads __doc__ but carries no module-level __doc__ assignment")
    return problems


def strip_source(src: str) -> str:
    tree = ast.parse(src)
    out = _tidy(_apply(src, _edits(src, tree)))
    problems = verify(out, reads_module_doc(tree))
    if problems:
        raise ValueError("; ".join(problems))
    return out


def _strip_file(src_path: Path, dest: Path) -> bool:
    try:
        out = strip_source(read_source(src_path))
    except (SyntaxError, ValueError, UnicodeDecodeError) as exc:
        print(f"strip_code.py: {src_path}: {exc}", file=sys.stderr)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(out, encoding="utf-8")
    if dest != src_path:
        shutil.copymode(src_path, dest)
    return True


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "--in-place":
        files = [Path(a) for a in argv[1:]]
        if not files:
            print(__doc__)
            return 2
        ok = [_strip_file(f, f) for f in files]
        return 0 if all(ok) else 1
    if len(argv) != 2:
        print(__doc__)
        return 2
    return 0 if _strip_file(Path(argv[0]), Path(argv[1])) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
