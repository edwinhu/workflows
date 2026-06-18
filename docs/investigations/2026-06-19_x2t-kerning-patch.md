# x2t docx→PDF kerning: root cause and patch feasibility

**Date:** 2026-06-19
**Question:** Can ONLYOFFICE x2t be made to apply font kerning in its docx→PDF
conversion (to match LibreOffice/Word)? Source patch on the table. The kerning
that matters in practice is **lowercase body text** (GPOS), not the showy capital
pairs.

**Verdict:**
1. **x2t applies zero pair kerning** — neither legacy `kern` table nor GPOS — for
   caps *and* lowercase. (Proven cache-proof below; my first pass measured this with
   a confounded harness and must not be trusted — see §1a.)
2. The omission lives in the **sdkjs JavaScript word engine** (run in V8 by the
   doctrenderer), not in core's native C++, so a clean small patch to ONLYOFFICE/core
   cannot fix the layout.
3. A **render-time PDF injection is feasible and demonstrated**. Because most real
   body fonts (incl. **EB Garamond**, the production render font) carry their kerning
   in **GPOS**, the injector must shape with **HarfBuzz** — a legacy-`kern`-table
   reader does nothing for them. Verified on EB Garamond: caps line −10 %, **lowercase
   line −1.8 %** (`scratch/x2t_kern_postprocess.py`, no rebuild required).

C++ citations are against the core source x2t is built from:
`/nix/store/88xxvgsva3g59gqg9jvq386frvw1jba0-source`
(= github.com/ONLYOFFICE/core rev `7043b3609328e917a4791aec8f3e8fca3225120f`,
`~/nix/modules/shared/onlyoffice/hermetic/x2t.nix:159`).

---

## 1. Reproduction (cache-proof)

Harness: `scripts/x2t_convert.py` → the hermetic nix x2t
(`/nix/store/5yi6c4aydzm5c1kw0mq88sbacmjiq1fm-onlyoffice-docbuilder-9.3.1/bin/x2t`).
Two paragraphs at 48 pt: caps `AVA WAVE Toffee ToWAY` and lowercase
`wavy avocado offer query yellow vex`.

To prove x2t *actually rendered each test font* (see §1a), each variant was given a
**distinct family name** and the embedded subset's MD5 was checked — distinct MD5s
confirm x2t used the supplied file rather than a cache/fallback.

| Variant (distinct family) | embedded MD5 | line widths px@300 |
|---|---|---|
| EB Garamond, **GPOS on** | `0c3c22fb65` | **[1571, 674, 1469, 1263]** |
| EB Garamond, **GPOS stripped** | `8b472fc2a9` | **[1571, 674, 1469, 1263]** |
| macOS Garamond 1000 upm, **kern on** | `dfef1a794e` | **[1603, 670, 1518, 1282]** |
| macOS Garamond 1000 upm, **kern stripped** | `815c6339e4` | **[1603, 670, 1518, 1282]** |

Within each font, **stripping the kern data changes nothing** → x2t applies neither
GPOS nor the legacy `kern` table. (Distinct MD5s prove the fonts really were used;
distinct widths between EB and macOS prove the matcher resolved them, not a fallback.)

For reference, the kerning x2t *should* apply (HarfBuzz, EB Garamond):
caps line **−0.99 em** (10 kerned pairs), lowercase line **−0.20 em** (10 kerned
pairs). The lowercase pairs are subtle individually but pervasive in body text.

### 1a. Harness pitfall that invalidated the first pass (recorded so it isn't repeated)

In the hermetic build, x2t resolves font *names* through the **build-time
`AllFonts.js`** index (referenced absolutely in `bin/DoctRenderer.config`), which
itself **ships a "Garamond"**. So a docx asking for "Garamond" got the *bundled*
Garamond regardless of `X2T_FONT_DIR`/`m_sFontDir` — every PDF in the first pass
embedded the **same** subset (MD5 `becc80e8…`), making "identical width with/without
kern" meaningless (same font twice). There is also a **family-name-keyed cache**: once
a name→file mapping is cached, swapping the file under that name reuses the old
subset. **Fix:** give every test font a unique family name and verify the embedded
MD5 differs before trusting any width.

---

## 2. The docx→PDF path x2t uses

```
docx ──(docx2doct)──► DOCT bin ──► doct_bin2pdf ──► CDoctrenderer.Execute(xml) ──► pdf.bin ──► PDF
```

- `X2tConverter/src/ASCConverters.cpp:467,522` — docx→PDF → `doct_bin2pdf`.
- `X2tConverter/src/lib/pdf_image.h:346` — `doct_bin2pdf` runs
  `NSDoctRenderer::CDoctrenderer::Execute(...)`: **the sdkjs JS editor engine inside
  V8**, emitting `pdf.bin` for the `PdfFile` writer.

So glyph positions — and the decision not to kern — are made in **sdkjs JavaScript**
(`bin/DoctRenderer.config` `<sdkjs>` =
`/nix/store/1niizaks2afdy6mvx7k6hy0dqyki8qh4-onlyoffice-core-sdkjs`, built from
github.com/ONLYOFFICE/sdkjs by `x2t.nix:325`), not in any native C++ layout.

### Native `m_bUseKerning` is a red herring

`DesktopEditor/fontengine/FontFile.cpp:137` `m_bUseKerning = FALSE` (never set true);
`:479` `GetKerning`→`FT_Get_Kerning`; `:1121`/`:1206` the only callers, in
`GetString`/`GetString2`. That path is the native AggPlus/`DocxRenderer` rasterizer —
**not** the doctrenderer→PDF path. Flipping it does nothing for docx→PDF (and it is
`kern`-table-only anyway, never GPOS).

---

## 3. Why sdkjs emits unkerned positions

The JS-facing text measurer (`DesktopEditor/doctrenderer/embed/TextMeasurerEmbed.*`):

- `FT_GetKerningX(face,g1,g2)` — registered **unconditionally**
  (`embed/v8/v8_TextMeasurerEmbed.cpp:63`); legacy-`kern` only.
- `HB_ShapeText(...)` — HarfBuzz shaping, registered **only** under
  `#ifdef SUPPORT_HARFBUZZ_SHAPER` (`v8_TextMeasurerEmbed.cpp:43-45`), and that macro
  is **Android/iOS-only** (`embed/TextMeasurerEmbed.h:6-8`:
  `#if defined(__ANDROID__) || defined(_IOS)`). → On the desktop/server build that
  produces x2t, **HarfBuzz shaping is not exposed to JS at all**.

In the deployed sdkjs the kerning binding is aliased but **never invoked** by the word
layout (`sdkjs/word/sdk-all-min.js:1302` aliases `FT_GetKerningX`; the measurer sums
per-glyph `FT_Load_Glyph` advances with no pair adjustment). Net:
**HarfBuzz compiled out on desktop → sdkjs uses nominal per-glyph advances → no
kerning of any kind reaches the PDF.**

---

## 4. Where kerning *can* be injected

`PdfFile/PdfWriter.cpp:715` `CommandDrawText` → `DrawText` (`:3461`); `/Widths` come
from `EncodeString`→`MeasureChar2`→`GetChar` (nominal, no kern); `CCommandManager::Flush`
(`PdfFile/SrcWriter/States.cpp`) coalesces runs into a PDF `TJ` array. The actual
stream confirms it — one `TJ` of Identity-H GIDs with **sub-unit** corrections:

```
[<0001>-83.006<0002>-125.002<0001>-333.003 ... ]TJ
```

Those numbers are grid corrections, **not** kerning. Widening the inter-glyph
adjustments here is exactly how kerning would be added.

---

## 5. Demonstrated fix — HarfBuzz/GPOS render-time injection

`scratch/x2t_kern_postprocess.py`: for each `TJ` run, recover the text via the font's
`/ToUnicode`, shape it with **HarfBuzz** twice (kern on/off), and inject the per-glyph
advance difference as extra `TJ` adjustments. HarfBuzz is the same shaper Word and
LibreOffice use, so this covers **GPOS** (and `kern`, and respects feature settings).

**Verified on EB Garamond (the production render font — GPOS-only, no `kern` table):**

| line | before | after injection |
|---|---|---|
| caps `AVA WAVE Toffee ToWAY` | 1571 px | **1407 px** (−10 %) |
| lowercase `wavy avocado offer query yellow vex` | 1469 px | **1442 px** (−1.8 %) |

(Visual: `scratch/x2t_kern_before_after.png`.) The lowercase reduction is the
body-text kerning that matters; a legacy-`kern`-table reader produces **0** here
because EB Garamond has no `kern` table.

### 5a. Equivalent in-core patch (code-level proposal, compile-unverified)

The same idea belongs in `PdfFile/SrcWriter/States.cpp::CCommandManager::Flush`
(or `CTextLine::Add`), folding a pair adjustment into the inter-glyph `TJ` shift. But
to match the demo it must use **GPOS**, i.e. HarfBuzz — and core *has* HarfBuzz linked
(`x2t.nix` deps), just not wired into this writer. This is more than a 1-liner
(resolve embedded-subset GID→original face, shape per run) and needs a full
docbuilder rebuild to verify (FlakeHub token expired ⇒ multi-hour from-source build),
so it is left as a proposal; §5's post-processor is the verified, deployable form.

### 5b. Limitations of any render-time approach

1. **Layout/render width mismatch.** sdkjs reserved each line at *unkerned* width.
   Kerned glyphs render tighter than the box: invisible for left/center text; for
   **justified** text the last glyph stops short of the right margin by the line's
   kern sum. Word/LibreOffice avoid this by kerning *during* layout (the sdkjs JS).
2. Needs the **original** font files (subsets usually drop GPOS); the script matches
   them to runs by PostScript/family name.
3. One-glyph-per-char assumption (Latin). Ligatures/complex scripts are skipped
   (`liga=False`, glyph-count guard).

---

## 6. The only *correct* fixes, and why they're impractical

1. **Enable HarfBuzz shaping on desktop** — drop the `__ANDROID__||_IOS` gate
   (`embed/TextMeasurerEmbed.h:6-8`) *and* make sdkjs route Latin runs through
   `HB_ShapeText` (its default measurer doesn't). Correct and GPOS-complete, but spans
   core C++ **+** minified sdkjs JS **+** a full rebuild — a real feature.
2. **Implement kerning in the sdkjs word layout** (`FT_GetKerningX`/GPOS between
   adjacent glyphs). Layout and render agree, but it's a substantial change in
   separately-built JS that ONLYOFFICE has deliberately not shipped.

Both touch sdkjs, which is not ONLYOFFICE/core — so neither is the hoped-for single
small core patch.

---

## 7. Resolution — wired into `scripts/x2t_convert.py`

The HarfBuzz/GPOS injector is now integrated (no rebuild, no core patch):

- `scripts/x2t_kern.py` — standalone HarfBuzz/GPOS injector (the shaping logic).
  Run via **`uv`** so its deps (`uharfbuzz`/`pikepdf`/`fontTools`) need not be in
  the ambient python.
- `_inject_kerning(pdf, font_dir)` in `x2t_convert.py` — shells out to
  `uv run --with uharfbuzz --with pikepdf --with fonttools python3 x2t_kern.py …`,
  fed the **staged render faces** from `_doc_focused_dir(src)` (the exact files x2t
  embedded, GPOS intact, so names match). Best-effort: skipped if `uv` is absent.
- `_docx_is_justified(src)` — scans `word/document.xml` + `word/styles.xml` for
  `w:jc w:val="both"`.
- `convert(..., kern=None)` — `kern=None` (default) is **auto**: inject for x2t
  docx→PDF **unless the doc justifies any paragraph** (§5b.1 margin undershoot).
  `kern=True/False` forces; `$X2T_KERN=1/0` and CLI `--kern`/`--no-kern` override.
  Soffice output is untouched (it already kerns). Best-effort: silently skipped if
  `uharfbuzz`/`pikepdf` are absent.

**End-to-end verification** (EB Garamond as the render font, via the real wrapper):

| invocation | caps line | lowercase line |
|---|---|---|
| `--no-kern` (x2t raw) | 1571 px | 1469 px |
| auto-kern (non-justified) | **1407 px** | **1442 px** |
| justified doc, auto | 1795 px (skipped ✓) | 1798 px (skipped ✓) |
| justified doc, `--kern` | 1631 px (forced) | 1771 px (forced) |

**Remaining limit:** justified text is deliberately skipped by default — for true
justified fidelity the only fix is in sdkjs layout (§6.1). If a justified law-review
PDF needs kerning, run with `--kern`/`X2T_KERN=1` and accept the slight right-margin
undershoot, or switch that draft to ragged-right.

**Harness note for future work:** always rename test fonts uniquely and assert the
embedded MD5 changed (§1a) — the bundled `AllFonts.js` "Garamond" and the family-name
cache otherwise silently serve the wrong font.

## Artifacts
- `scripts/x2t_kern.py` — standalone HarfBuzz/GPOS injector (run via uv); usable
  ad-hoc on any x2t PDF: `uv run --with uharfbuzz --with pikepdf --with fonttools
  python3 scripts/x2t_kern.py out.pdf <font-or-dir>`.
- `scripts/x2t_convert.py` — `_inject_kerning` / `_docx_is_justified` / `convert(kern=)`
  (the shipped integration; calls `x2t_kern.py` via uv).
- `scratch/x2t_kern_before_after.png` — EB Garamond before/after (caps + lowercase).
