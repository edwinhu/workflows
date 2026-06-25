# Document skill group

The document toolchain in `workflows`: Anthropic's vendored Office skills plus
the project's own repair/build/render utilities. These are **not** a separate
plugin — Claude Code discovers skills at `skills/<name>/SKILL.md`, so they live
flat in `skills/` and are grouped here by convention (this index), not by
directory. Think of it as one pipeline with decoupled stages:

```
  EXTRACT → CREATE/EDIT → REPAIR → BUILD → RENDER → VERIFY
```

Each stage is an independent concern — you can run any one on any `.docx`
without the others. The deliberate decoupling (2026-06-23): **footnote repair**,
**OOXML package repair**, and **PDF export** are three separate things that the
`law-review-docx` build happens to chain.

## Stages

### Extract — get content/data out
| Skill / tool | Role |
|---|---|
| `look-at` | Visual/semantic read of PDFs, images, charts, screenshots |
| `pdf` (vendored) | PDF text/table extraction, form fill, page ops |
| `scripts/prose_extract.py` | Pull clean prose from .docx/.md for analysis |

### Create / edit — author or modify content (Anthropic vendored)
| Skill | Role |
|---|---|
| `docx` | Word doc creation, editing, tracked changes, comments |
| `pptx` | Presentation creation/editing, layouts, speaker notes |
| `xlsx` | Spreadsheet creation/editing, formulas, recalc |

Vendored from [anthropics/skills](https://github.com/anthropics/skills) under
`external/anthropic-skills/`. They also ship the **OOXML validator + schemas**
(`external/anthropic-skills/skills/docx/ooxml/`) the repair stage relies on.

### Repair — make a damaged .docx acceptable to strict consumers
| Skill / tool | Fixes |
|---|---|
| **`docx-repair`** (skill) | **Front door for both repair tracks.** Track A: OOXML package corruption (composes `docx_repair.py`). Track B: footnote structure + NOTEREF cross-refs after Google Docs / Word Online round-trips. |
| `scripts/docx_repair.py` | **Track A library** — Google Docs exports' case-broken `customXML` part paths, `evenAndOddHeaders` phantom pages. Case-normalize → docbuilder reserialize fallback. Importable (`repair_docx`, `reserialize_docx`, `opc_integrity_issues`) + CLI. Lives at plugin root because `doc_render.py` composes it as a render preflight. |
| `bluebook-audit/scripts/fix_gdocs_footnotes.py` | Deprecated shim — forwards to `docx-repair`'s `fix_footnotes.py` (consolidated 2026-06-25). |

The two tracks are **distinct concerns** under one front door — package wiring
(never touches content) vs. footnote markup. A file can need either, both, or
neither. See `docs/investigations/2026-06-23_gdocs-customxml-case.md`.

### Build — generate a formatted .docx from source
| Skill | Role |
|---|---|
| `law-review-docx` | Markdown/legal draft → law-review-styled Word doc (pandoc + template; chains footnote repair, NOTEREF, widow control) |

### Render — export to PDF/PNG
| Skill / tool | Role |
|---|---|
| `docx-render` | The faithful .docx→PDF path (Word's engine, incl. from background jobs) |
| `pptx-render` | .pptx→PDF/PNG |
| `scripts/doc_render.py` | Shared converter: **Word > LibreOffice > x2t** by fidelity, each with its fixes. Word path **composes `docx_repair`** as a preflight so a Google export "just renders." |

### Verify — confirm rendered output
| Skill | Role |
|---|---|
| `visual-verify` | Render-and-review of visual output (slides, docs, charts) |

## Shared libraries (`scripts/`)
- `doc_render.py` — the three-engine converter (imports `docx_repair`).
- `docx_repair.py` — OOXML package repair (no deps beyond stdlib; lazy-imports
  `doc_render._run_docbuilder` for the reserialize fallback).
- `x2t_kern.py` — render-time GPOS/kern injection for x2t output.

Skills reach these via `sys.path.insert(0, <plugin_root>/scripts)`. Keeping them
in one `scripts/` dir is why the group stays a single plugin: relocating a skill
into a sub-plugin would break those relative imports.

## If this grows into its own plugin later
A marketplace can host multiple plugins, so a sibling `documents` plugin (in
this repo's `marketplace.json`) is the idiomatic "plugin within the plugin" if
independent install/versioning is ever wanted. The migration cost is relocating
these skills **with** `scripts/doc_render.py` + `scripts/docx_repair.py` and
re-pointing the shared-script imports. Until then, this index is the group.
