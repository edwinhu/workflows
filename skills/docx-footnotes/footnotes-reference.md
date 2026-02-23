# Footnote XML Reference

Reference material for programmatic footnote manipulation in OOXML. Covers run-level editing gotchas, cloud editor damage repair, and direct ZIP surgery.

## 1. Run-Level Editing Gotchas

### NBSP (\xa0) Breaks Text Search

DOCX uses non-breaking spaces in abbreviations. Standard string search fails silently.

**Affected:** `No.\xa02106`, `Feb.\xa07`, `§\xa01001`, any abbreviation + number.

```python
def find_text_in_runs(runs, target):
    for run in runs:
        if target in run.text:
            return run
    nbsp_target = target.replace(' ', '\xa0')
    for run in runs:
        if nbsp_target in run.text:
            return run
    return None
```

### Italic/Roman Run Boundaries

Formatting changes split text across runs. `supra note 10` is two runs:
```xml
<w:r><w:rPr><w:i/></w:rPr><w:t>supra </w:t></w:r>
<w:r><w:t>note 10</w:t></w:r>
```

Single-run search for `"supra note 10"` will never match. Use cross-run concatenation:

```python
NSMAP = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def get_concatenated_text(runs):
    full_text, offsets = '', []
    for r in runs:
        t = r.find('.//w:t', NSMAP)
        if t is not None and t.text:
            start = len(full_text)
            full_text += t.text
            offsets.append((r, start, len(full_text)))
    return full_text, offsets
```

Common cross-run patterns: `*See* Smith v. Jones`, `*Id.* at 496`, `*supra* note 12, at 30`.

### Run-Splitting for Formatting Changes

To change formatting of a substring, split the run into prefix/target/suffix:

```python
from copy import deepcopy

def split_run_for_formatting(run, target_text, apply_format_fn):
    text = run.find('.//w:t', NSMAP).text
    idx = text.find(target_text)
    if idx == -1:
        return False
    prefix, suffix = text[:idx], text[idx + len(target_text):]
    parent = run.getparent()
    run_index = list(parent).index(run)

    mid_run = deepcopy(run)
    mid_run.find('.//w:t', NSMAP).text = target_text
    apply_format_fn(mid_run)

    run.find('.//w:t', NSMAP).text = prefix
    suf_run = deepcopy(run)
    suf_run.find('.//w:t', NSMAP).text = suffix

    for elem in [run, mid_run, suf_run]:
        elem.find('.//w:t', NSMAP).set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

    parent.insert(run_index + 1, mid_run)
    parent.insert(run_index + 2, suf_run)
    return True
```

### xml:space="preserve" Is Required

Any `<w:t>` with leading/trailing whitespace MUST have this attribute, or Word silently strips the spaces:
```python
t_elem.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
```

### The footnoteRef Space Run

The run after `<w:footnoteRef/>` often contains the full footnote text with a leading space (not a separate space run):
```xml
<!-- Common: space + content combined -->
<w:r><w:footnoteRef/></w:r>
<w:r><w:t xml:space="preserve"> See Smith v. Jones...</w:t></w:r>
```

When replacing all content, keep only the footnoteRef run and rebuild after it.

## 2. Cloud Editor Damage (Google Docs / Word Online)

Both Google Docs and Word Online re-serialize OOXML on every round-trip, stripping anything they don't understand. **This is by design** per Microsoft — Word Online is a "lightweight editing experience."

### What Gets Destroyed

| Feature | Damage | Frequency |
|---------|--------|-----------|
| Separator footnotes | `w:type="separator"` (id=-1) and `continuationSeparator` (id=0) stripped | Always |
| Custom footnote marks | `customMarkFollows="1"` → `"0"`, `w:sym` → plain text | Always |
| Paragraph styles | `pStyle` declarations removed, formatting flattened to inline `rPr` | Always |
| Footnote IDs | Shift down to fill gap left by missing separators | Always |
| TOC separator paragraph | Spacing/size revert to defaults, causes page spillover | Sometimes |
| Field codes (NOTEREF) | May survive or get corrupted | Sometimes |

### Detection

```python
def detect_issues(fn_xml, doc_xml):
    issues = []
    if 'w:type="separator"' not in fn_xml:
        issues.append("missing_separators")
    if 'customMarkFollows="0"' in doc_xml and 'customMarkFollows="1"' not in doc_xml:
        issues.append("custom_marks_broken")
    footnotes = re.findall(r'<w:footnote\s+w:id="(\d+)">(.*?)</w:footnote>', fn_xml, re.DOTALL)
    missing = sum(1 for fid, body in footnotes if 'w:pStyle' not in body)
    if missing > 0:
        issues.append(f"missing_pstyle({missing}/{len(footnotes)})")
    return issues
```

### Fix Script

`fix_gdocs_footnotes.py` (in `scripts/`) handles all damage:

```bash
pixi exec --spec python=3.13 --spec lxml -- python3 \
  fix_gdocs_footnotes.py path/to/file.docx --crossrefs
```

Flags: `--output`, `--dry-run`, `--bio-footnotes N`, `--crossrefs`.

### Author Bio Custom Marks

| Footnote | Mark | OOXML |
|----------|------|-------|
| 1 | * (asterisk) | `<w:sym w:font="Symbol" w:char="F02A"/>` |
| 2 | dagger | `<w:t>&#8224;</w:t>` |
| 3 | double-dagger | `<w:t>&#8225;</w:t>` |

## 3. Direct ZIP Surgery (Bypassing Document Libraries)

### When to Use

Document libraries (python-docx, custom Document class) parse XML into their own DOM. `doc.save()` re-serializes from the stale DOM, **overwriting raw XML changes**. Use direct ZIP manipulation for:

- Structural fixes (separators, custom marks, pStyle injection)
- Bulk regex replacements
- Changes libraries don't expose APIs for

Use Document library for: tracked changes, DOM operations, validation.

### Pattern

```python
import re, zipfile, tempfile, shutil

def patch_docx(docx_path, output_path=None):
    output_path = output_path or docx_path
    with zipfile.ZipFile(docx_path, 'r') as zf:
        fn_xml = zf.read('word/footnotes.xml').decode('utf-8')
        doc_xml = zf.read('word/document.xml').decode('utf-8')

    # Apply string/regex fixes here

    with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
        tmp_path = tmp.name
    with zipfile.ZipFile(docx_path, 'r') as zin:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == 'word/footnotes.xml':
                    zout.writestr(item, fn_xml.encode('utf-8'))
                elif item.filename == 'word/document.xml':
                    zout.writestr(item, doc_xml.encode('utf-8'))
                else:
                    zout.writestr(item, zin.read(item.filename))
    shutil.move(tmp_path, output_path)
```

### Key Regex Patterns

**ID shifting** (reverse to avoid collisions):
```python
for old_id in range(300, -1, -1):
    xml = xml.replace(f'w:id="{old_id}"', f'w:id="{old_id + 1}"')
```

**Inject after opening tag:**
```python
xml = re.sub(r'(<w:footnotes[^>]*>)', r'\1' + new_content, xml, count=1)
```

**Add missing pStyle** (negative lookahead):
```python
xml = re.sub(
    r'(<w:footnote\s+w:id="\d+">\s*<w:p[^>]*>\s*<w:pPr>)(?!\s*<w:pStyle)',
    r'\1\n        <w:pStyle w:val="FNStyleBest"/>',
    xml
)
```

**Idempotency:** Always check before fixing:
```python
if 'w:type="separator"' not in fn_xml:
    # apply separator fix
```

### Python Version

pack.py uses `match` (3.10+). Always use: `pixi exec --spec python=3.13 --spec defusedxml --spec lxml`
