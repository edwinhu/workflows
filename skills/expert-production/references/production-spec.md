# Production SPEC, MANIFEST.csv and the runbook command block

The production SPEC is the one input `package-check.sh` reads. It is one JSON object at
`production/<name>.spec.json` in the analysis repo's gitignored production directory, outside the
stage, never under the plans directory and covered by no task's writable paths. It is written before
plan mode; the plan records its sha256 and passes it as `--spec-sha256`.

```
package-check.sh --spec <spec.json> (--spec-sha256 <hex> | --no-spec-sha256)
```

A missing `--spec`, neither sha flag, or a sha mismatch exits 2. `--no-spec-sha256` is the explicit
opt-out for a hand run outside a plan; a plan always passes the hash. The script prints one
`leg <name> exit=<n>` line per leg on stdout (`archive`, `code`, `leak`, `rerun`, in that order) and
a count line per leg on stderr, runs every leg even when one fails, and exits with the maximum leg
status. A leg whose input is missing reports 2, never skips.

## SPEC keys

Paths marked **abs** are absolute; every other path is relative to the package's top folder. Keys
marked optional may be omitted; every other key is required.

| key | path | meaning |
|---|---|---|
| `name` | — | the top folder and the archive basename, e.g. `acme-production-YYYY-MM-DD` |
| `stage` | abs | the staged package directory; its basename must equal `name` |
| `archive` | abs | the `.7z` the archive leg (re)builds from `stage` with `bsdtar --format 7zip`; it lies outside `stage` |
| `entry_scripts` | relative | the deliverable's entry `.py` files |
| `python_paths` (optional) | relative | package dirs searched for local imports; default: the entry scripts' dirs, plus the dirs of the `.py` files runbook commands name |
| `third_party` (optional) | — | top-level module names allowed to resolve outside the package. Stdlib (`sys.stdlib_module_names`) is always allowed; any other unresolved import fails |
| `sources` (optional) | key relative, value abs | maps a package `.py` path to its source path: the ruff E9/F baseline. A packaged `.py` with no source has an empty baseline |
| `extra_files` | relative | non-code files that must be in the archive (processed data, etc.) |
| `workbook` | relative | the `.xlsx` |
| `workbook_formulas` (optional) | — | `true` (default) or `false`. With `true`, a workbook whose sheets hold no `<f>` formula element fails the leak leg; set `false` only for a workbook that by design recomputes nothing |
| `runbook_pdf` | relative | the runbook PDF |
| `runbook_source` | abs | the runbook Markdown — internal, never shipped |
| `runbook_cwd` (optional) | relative | the dir runbook script paths are relative to; default `.` |
| `leak_terms` | — | Python regexes: names, batch and job ids like `\bb\d{2,3}\b`, `decisions\.csv`, `¶`, footnote cites like `\bn\.\d+`. A term is a regex searched anywhere in each line of every scanned text, not a whole word, so anchor it: unanchored, a batch-id pattern also matches inside URLs, `b64encode` and variable names |
| `usernames` (optional) | — | literal usernames; `$USER` is always added |
| `reruns` | — | the offline re-runs, below. An empty or absent list FAILS the rerun leg (fail closed) |

### `reruns` entries

Each entry is `{name, cwd, cmd, output, reference, compare, timeout?}`:

| field | meaning |
|---|---|
| `name` | a label for the leg's messages |
| `cwd` | package-relative; `cmd` runs via bash there, inside a fresh COPY of the extracted tree, with proxy variables pointed at a dead local port |
| `cmd` | the command that regenerates the output |
| `output` | relative to `cwd` |
| `reference` | abs; the copy the output must equal |
| `compare` | `"bytes"`, or `{"columns_drop": [..]}` — CSV, equal after dropping those columns |
| `timeout` (optional) | seconds, default 300 |

### Which leg reads which key

| leg | reads |
|---|---|
| `archive` | `stage`, `archive`, `name`, the stage's `MANIFEST.csv`; `entry_scripts`, `extra_files`, `workbook` and `runbook_pdf` must be in the archive |
| `code` | `entry_scripts`, `python_paths`, `third_party`, `sources`, and `runbook_source` with `runbook_cwd` for the scripts its commands name |
| `leak` | `leak_terms`, `usernames`, `workbook`, `workbook_formulas`, `runbook_pdf`, every PNG |
| `rerun` | `reruns`, `runbook_source`, `runbook_pdf`, `runbook_cwd` |

### Scope and workbook rules

Three rules of the legs decide scope and the workbook; each prints a `FAIL` line on stderr naming the file:

- **Unreached `.py`** (`code`) — the allowed set is the import closure of `entry_scripts` plus every
  `.py` a runbook command names (resolved under `runbook_cwd`) and that script's own closure. Any
  other packaged `.py` fails the leg: dead code does not ship. A `.py` that only a shipped `.sh`
  runs is not reached that way, so list it in `entry_scripts`.
- **Workbook error cells, or no formulas** (`leak`) — a cell with `t="e"`, or a cached value of
  `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, `#NUM!` or `#NULL!`, fails. A workbook with no
  `<f>` element in any sheet fails unless the SPEC sets `workbook_formulas: false`.
- **One table in two formats** (`archive`) — two archived files sharing a path stem with different
  table extensions among `.csv`, `.parquet`, `.feather`, `.dta` and `.tsv` (`data/x.csv` beside
  `data/x.parquet`) fail.

### An invented example

```json
{
  "name": "acme-production",
  "stage": "/srv/acme-study/production/acme-production",
  "archive": "/srv/acme-study/production/acme-production.7z",
  "entry_scripts": ["code/build_summary.py"],
  "python_paths": ["code"],
  "third_party": ["pandas"],
  "sources": {"code/build_summary.py": "/srv/acme-study/src/build_summary.py"},
  "extra_files": ["data/processed_input.csv"],
  "workbook": "acme-workbook.xlsx",
  "workbook_formulas": true,
  "runbook_pdf": "RUNBOOK.pdf",
  "runbook_source": "/srv/acme-study/production/acme-production-runbook/runbook.md",
  "runbook_cwd": ".",
  "leak_terms": ["\\bb\\d{2,3}\\b", "decisions\\.csv", "¶", "\\bn\\.\\d+"],
  "usernames": [],
  "reruns": [
    {"name": "summary", "cwd": ".", "cmd": "python3 code/build_summary.py --input data/processed_input.csv --output out/summary.csv",
     "output": "out/summary.csv", "reference": "/srv/acme-study/output/summary.csv",
     "compare": {"columns_drop": ["run_seconds"]}}
  ]
}
```

## MANIFEST.csv

Header `path,bytes,sha256,modified_utc`; one row per file in the top folder. `path` is relative to
the top folder with `/`; `modified_utc` is ISO 8601 `YYYY-MM-DDTHH:MM:SSZ`, compared at whole-second
resolution; MANIFEST.csv does not list itself.

```
path,bytes,sha256,modified_utc
README.md,2048,<64 hex>,YYYY-MM-DDTHH:MM:SSZ
code/build_summary.py,913,<64 hex>,YYYY-MM-DDTHH:MM:SSZ
```

`manifest.py <stage>` (this skill's `scripts/`) writes it and refuses a stage holding a cache or VCS
entry. The archive leg compares every file of a fresh extraction to it: sha256, bytes and mtime
equal; no unlisted file; no listed-but-absent file; no `__pycache__`, `.ruff_cache`,
`.pytest_cache`, `.git` or `*.pyc`.

## The runbook command block

In the runbook source, each command sits in a fenced block whose info string is `command`; a line
ending in ` \` continues onto the next, and the logical command is the joined line.

````markdown
```command
python3 code/build_summary.py \
  --input data/processed_input.csv --output out/summary.csv
```
````

`build-runbook.sh` breaks each command to its `--width` (default 80) only before a flag, ending each
broken line with ` \`, so no token is split. The rerun leg then requires every logical command in the
source to appear intact in the PDF text — both whitespace-normalized, with `\`+newline continuations
joined — and every script path (`*.py`, `*.sh`, `*.R`) a command names to exist in the archive under
`runbook_cwd`.
