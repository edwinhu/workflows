"""Canonical TSV(.gz) -> parquet converter for the EDGAR record-table parsers.

The Go binaries (``parse_13f``, ``parse_npx``) write headerless TSV, so the
column order has to come from somewhere. It comes from Go source at run time --
see :func:`go_columns` -- never from a list restated here. That is the whole
reason this module exists rather than a recipe in prose.

Memory: the real 13F input is 4,110 MB of gzipped TSV across many shards, so
nothing here holds the dataset. Shards are read line by line and each partition
is flushed to its own open ``ParquetWriter`` once its buffer fills.
"""

from __future__ import annotations

import datetime
import gzip
import io
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from parsers import MAX_YEAR_SLACK, MIN_YEAR, ParserSpec

# Rows buffered per partition before a row group is flushed.
FLUSH_ROWS = 50_000
# Ceiling on rows buffered across ALL partitions. Without it peak memory would
# scale with the partition count (13F has 38), which is what decides whether
# this survives the 4,110 MB corpus; with it, peak is independent of both the
# corpus size and the number of partitions.
MAX_BUFFERED_ROWS = 200_000
# Non-quarterly datasets roll to a new part file after this many rows.
ROWS_PER_PART = 5_000_000

COMPRESSION = "zstd"

_TRUE = {"true", "t", "1", "yes", "y"}
_FALSE = {"false", "f", "0", "no", "n"}


# ---------------------------------------------------------------------------
# The anti-drift mechanism.
# ---------------------------------------------------------------------------

def go_columns(types_go: Path, columns_var: str) -> list[str]:
    """Return the column order declared by a Go ``var <columns_var> = []string{...}``.

    Read from the file on every call, in source order. Raises if the var is
    absent -- a silently empty column list would mis-assign every field.
    """
    src = Path(types_go).read_text()
    m = re.search(
        r"var\s+" + re.escape(columns_var) + r"\s*=\s*\[\]string\{(.*?)\n\}",
        src,
        re.DOTALL,
    )
    if m is None:
        raise ValueError(f"{types_go}: no `var {columns_var} = []string{{...}}` block")
    body = "\n".join(line.split("//", 1)[0] for line in m.group(1).splitlines())
    columns = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
    if not columns:
        raise ValueError(f"{types_go}: `{columns_var}` declares no columns")
    return columns


# ---------------------------------------------------------------------------
# Partition key validation.
# ---------------------------------------------------------------------------

def year_of(value: str) -> int | None:
    """Return the plausible partition year for a YYYYMMDD string, else None.

    ``holdings_13f/`` on rjds carries a ``year=3006`` directory because nothing
    validated the key.
    """
    if not isinstance(value, str) or len(value) != 8 or not value.isdigit():
        return None
    year, month, day = int(value[:4]), int(value[4:6]), int(value[6:])
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    max_year = datetime.datetime.now(tz=datetime.timezone.utc).year + MAX_YEAR_SLACK
    if year < MIN_YEAR or year > max_year:
        return None
    return year


def _quarter_of(value: str) -> int:
    return (int(value[4:6]) - 1) // 3 + 1


# ---------------------------------------------------------------------------
# Typing.
# ---------------------------------------------------------------------------

def _arrow_type(column: str, spec: ParserSpec) -> pa.DataType:
    if column in spec.int_columns:
        return pa.int64()
    if column in spec.float_columns:
        return pa.float64()
    if column in spec.bool_columns:
        return pa.bool_()
    return pa.string()  # everything else, INCLUDING the dates


def _schema(columns: list[str], spec: ParserSpec) -> pa.Schema:
    return pa.schema([(c, _arrow_type(c, spec)) for c in columns])


def _to_bool(raw: str) -> bool | None:
    low = raw.strip().lower()
    if low == "":
        return None
    if low in _TRUE:
        return True
    if low in _FALSE:
        return False
    raise ValueError(f"not a boolean: {raw!r}")


def _column_values(raw: list[str], typ: pa.DataType) -> list:
    if pa.types.is_integer(typ):
        return [None if v == "" else int(v) for v in raw]
    if pa.types.is_floating(typ):
        return [None if v == "" else float(v) for v in raw]
    if pa.types.is_boolean(typ):
        return [_to_bool(v) for v in raw]
    return raw


def _table(rows: list[list[str]], schema: pa.Schema) -> pa.Table:
    arrays = []
    for i, field in enumerate(schema):
        column = [r[i] for r in rows]
        arrays.append(pa.array(_column_values(column, field.type), type=field.type))
    return pa.Table.from_arrays(arrays, schema=schema)


# ---------------------------------------------------------------------------
# Reading.
# ---------------------------------------------------------------------------

def _open_text(path: Path) -> io.TextIOBase:
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="")
    return open(path, "rt", encoding="utf-8", errors="replace", newline="")


def _rows(path: Path, ncolumns: int):
    """Yield (fields, raw_line) from a headerless TSV(.gz) shard.

    A row whose field count differs from the schema is an error: a headerless
    file mis-assigns every subsequent column in silence otherwise.
    """
    with _open_text(path) as fh:
        for lineno, line in enumerate(fh, 1):
            raw = line.rstrip("\r\n")
            if raw == "":
                continue
            fields = raw.split("\t")
            if len(fields) != ncolumns:
                raise ValueError(
                    f"{path}:{lineno}: expected {ncolumns} fields, got {len(fields)}"
                )
            yield fields, raw


# ---------------------------------------------------------------------------
# Writing.
# ---------------------------------------------------------------------------

class _PartitionSink:
    """One open parquet writer per partition, flushed as buffers fill."""

    def __init__(self, out_dir: Path, schema: pa.Schema, quarterly: bool):
        self.out_dir = Path(out_dir)
        self.schema = schema
        self.quarterly = quarterly
        self._buffers: dict[str, list[list[str]]] = {}
        self._writers: dict[str, pq.ParquetWriter] = {}
        self._written: dict[str, int] = {}
        self._part_no: dict[int, int] = {}
        self._buffered = 0

    def _path(self, year: int, key: str) -> Path:
        directory = self.out_dir / f"year={year}"
        directory.mkdir(parents=True, exist_ok=True)
        if self.quarterly:
            return directory / f"{key.split('/')[1]}.parquet"
        return directory / f"part-{self._part_no.setdefault(year, 0):03d}.parquet"

    def add(self, year: int, quarter: int | None, fields: list[str]) -> None:
        key = f"{year}/Q{quarter}" if self.quarterly else str(year)
        buf = self._buffers.setdefault(key, [])
        buf.append(fields)
        self._buffered += 1
        if len(buf) >= FLUSH_ROWS:
            self.flush(key, year)
        elif self._buffered >= MAX_BUFFERED_ROWS:
            # Many partitions each below the per-partition threshold still add
            # up. Drain the largest until the global ceiling is respected.
            while self._buffered >= MAX_BUFFERED_ROWS:
                biggest = max(self._buffers, key=lambda k: len(self._buffers[k]))
                if not self._buffers[biggest]:
                    break
                self.flush(biggest, int(biggest.split("/")[0]))

    def flush(self, key: str, year: int) -> None:
        rows = self._buffers.get(key)
        if not rows:
            return
        self._buffered -= len(rows)
        writer = self._writers.get(key)
        if writer is None:
            writer = pq.ParquetWriter(
                self._path(year, key), self.schema, compression=COMPRESSION
            )
            self._writers[key] = writer
            self._written[key] = 0
        writer.write_table(_table(rows, self.schema))
        self._written[key] += len(rows)
        self._buffers[key] = []
        if not self.quarterly and self._written[key] >= ROWS_PER_PART:
            writer.close()
            del self._writers[key]
            self._written[key] = 0
            self._part_no[year] = self._part_no.get(year, 0) + 1

    def close(self) -> None:
        for key in list(self._buffers):
            year = int(key.split("/")[0])
            self.flush(key, year)
        for writer in self._writers.values():
            writer.close()
        self._writers.clear()


class _Quarantine:
    """Rows whose partition key failed validation. Counted, never dropped."""

    def __init__(self, directory: Path | None):
        self.dir = Path(directory) if directory else None
        self._handles: dict[str, io.TextIOBase] = {}
        self._made_dir = False
        self.count = 0

    def add(self, source: Path, raw: str) -> None:
        self.count += 1
        if self.dir is None:
            return
        if not self._made_dir:
            # Once per run, not once per row: a corrupt partition key can affect
            # millions of rows, and the write path amortizes its equivalent call
            # the same way. Still lazy, so a clean run creates no directory.
            self.dir.mkdir(parents=True, exist_ok=True)
            self._made_dir = True
        name = Path(source).name.replace(".gz", "") + ".quarantine.tsv"
        fh = self._handles.get(name)
        if fh is None:
            fh = open(self.dir / name, "w", encoding="utf-8")  # noqa: SIM115 -- pooled, closed in close()
            self._handles[name] = fh
        fh.write(raw + "\n")

    def close(self) -> None:
        for fh in self._handles.values():
            fh.close()
        self._handles.clear()


# ---------------------------------------------------------------------------
# Public conversions.
# ---------------------------------------------------------------------------

def convert(
    tsv_paths: list[Path],
    spec: ParserSpec,
    out_dir: Path,
    scripts_root: Path,
    quarantine: Path | None = None,
) -> dict:
    """Convert headerless TSV(.gz) shards into a Hive-partitioned parquet dataset.

    Streams shard by shard; peak memory is the per-partition buffers, not the
    corpus. Returns a stats dict with ``rows`` (written) and ``quarantined``.
    """
    columns = go_columns(Path(scripts_root) / spec.types_go, spec.columns_var)
    year_idx = columns.index(spec.year_column)
    schema = _schema(columns, spec)
    sink = _PartitionSink(Path(out_dir), schema, spec.quarterly)
    quarantined = _Quarantine(quarantine)
    rows = 0
    try:
        for path in tsv_paths:
            path = Path(path)
            for fields, raw in _rows(path, len(columns)):
                year = year_of(fields[year_idx])
                if year is None:
                    quarantined.add(path, raw)
                    continue
                quarter = _quarter_of(fields[year_idx]) if spec.quarterly else None
                sink.add(year, quarter, fields)
                rows += 1
    finally:
        sink.close()
        quarantined.close()
    return {
        "rows": rows,
        "quarantined": quarantined.count,
        "shards": len(list(tsv_paths)),
        "dataset": str(out_dir),
    }


def convert_manifest(tsv_paths: list[Path], spec: ParserSpec, out_path: Path,
                     scripts_root: Path) -> dict:
    """Convert manifest TSV(.gz) shards into a single parquet file.

    The manifest is one row per filing, not a record table, so it is neither
    partitioned nor typed beyond the parser's own table.
    """
    columns = go_columns(Path(scripts_root) / spec.types_go, "manifestColumns")
    schema = _schema(columns, spec)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = 0
    writer = pq.ParquetWriter(out_path, schema, compression=COMPRESSION)
    try:
        buf: list[list[str]] = []
        for path in tsv_paths:
            for fields, _raw in _rows(Path(path), len(columns)):
                buf.append(fields)
                rows += 1
                if len(buf) >= FLUSH_ROWS:
                    writer.write_table(_table(buf, schema))
                    buf = []
        if buf:
            writer.write_table(_table(buf, schema))
    finally:
        writer.close()
    return {"rows": rows, "quarantined": 0, "manifest": str(out_path)}
