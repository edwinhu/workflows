# A. Package / OOXML wiring repair

Google Docs' `.docx` export emits OOXML that strict consumers reject while lenient ones (x2t) accept. Two recurring, concrete defects:

1. **Case-mismatched OPC part references** — the export spells the folder `customXML` (capital) in `document.xml.rels` and `[Content_Types].xml` but stores the part as `customXml` (lowercase). OPC part names are **case-sensitive**, so the part is unreferenced/untyped → Word says the document is corrupt.
2. **`<w:evenAndOddHeaders/>` left in `settings.xml`** → Word renders phantom blank pages.

`scripts/docx_repair.py` (at plugin root — it's a shared library `doc_render.py` composes, so it lives there, not in this skill's `scripts/`) fixes both, cheapest-first: case-normalize part references → drop the Word-breaking directive → if still structurally broken, reserialize via ONLYOFFICE docbuilder (clean OOXML, watermark-free, at the cost of a re-layout; opt out with `--no-reserialize`).

```bash
# CLI — detect + repair (in-place if dirty)
python3 "$SKILL_DIR/../../scripts/docx_repair.py" returned.docx fixed.docx
python3 "$SKILL_DIR/../../scripts/docx_repair.py" returned.docx --dry-run   # report only
```
```python
import sys; sys.path.insert(0, "<plugin>/scripts")
from docx_repair import repair_docx, opc_integrity_issues
issues = opc_integrity_issues("returned.docx")   # [] = clean
repair_docx("returned.docx", "fixed.docx")        # -> RepairResult
```
