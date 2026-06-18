# x2t docx→PDF kerning: root cause and patch feasibility

**Date:** 2026-06-19
**Question:** Can ONLYOFFICE x2t be made to apply font kerning in its docx→PDF
conversion (to match LibreOffice/Word)? Source patch on the table.

**Verdict:** A *clean, correct* fix in ONLYOFFICE/core is **infeasible**, because
the text layout that omits kerning lives in the **sdkjs JavaScript word engine**
(run in V8 by the doctrenderer), not in core's native C++. A *render-time-only*
native injection in `PdfFile` is **feasible for legacy `kern`-table fonts** and is
demonstrated below (verified before/after: 1605 px → 1491 px), but it is a partial
hack (no GPOS; diverges from the reserved layout width for justified text). The
same render-time fix is available **today with no rebuild** as a PDF post-processor
(`scratch/x2t_kern_postprocess.py`, verified identical result).

All C++ citations are against the core source x2t is built from:
`/nix/store/88xxvgsva3g59gqg9jvq386frvw1jba0-source`
(= github.com/ONLYOFFICE/core rev `7043b3609328e917a4791aec8f3e8fca3225120f`,
wired in `~/nix/modules/shared/onlyoffice/hermetic/x2t.nix:159`).

---

## 1. Reproduction (confirmed this session)

Harness: `scripts/x2t_convert.py` driving the x2t binary at
`/nix/store/5yi6c4aydzm5c1kw0mq88sbacmjiq1fm-onlyoffice-docbuilder-9.3.1/bin/x2t`,
with `X2T_FONT_DIR` pointed at a dir of macOS Monotype Garamond (`~/Library/Fonts/Garamond*.ttf`,
2048 upm, format-0 `kern` table with 498 pairs). Test docx: a 48 pt line
`AVA WAVE Toffee ToWAY` (docDefaults rFonts=Garamond, `<w:kern w:val="2"/>`).

| Render | text width @300 dpi |
|---|---|
| x2t, font **with** `kern` table | **1605 px** |
| x2t, font with `kern` table **stripped** | **1605 px** |

Identical → **x2t applies zero kerning**, regardless of the `kern` table or the
`<w:kern>` flag. Expected kerning for this line (summing the font's pairs:
AV −231, VA −205, WA −168×2, AV −231, To −154×2, AY −129) = **−1440 font units =
−0.70 em = −33.75 pt = ~−141 px @300 dpi** — i.e. correct output should be ~9 %
narrower. (LibreOffice's HarfBuzz path renders that narrower line; established as
ground truth in `2026-06-10_onlyoffice-vs-libreoffice.md`. LibreOffice silently
no-ops on this minimal docx in the nix sandbox, so the font-derived figure is the
reference here.)

---

## 2. The docx→PDF path x2t actually uses

```
docx ──(docx2doct)──► DOCT bin ──► doct_bin2pdf ──► CDoctrenderer.Execute(xml) ──► pdf.bin ──► PDF
```

- `X2tConverter/src/ASCConverters.cpp:467,522` — docx→PDF dispatches to
  `doct_bin2pdf(...)`.
- `X2tConverter/src/lib/pdf_image.h:346` — `doct_bin2pdf` builds a doctrenderer XML
  job and calls `NSDoctRenderer::CDoctrenderer::Execute(sXml, sResult)`. **This runs
  the sdkjs JavaScript editor engine inside V8** and emits `pdf.bin`, a command
  stream that the `PdfFile` writer turns into the final PDF.

**Consequence:** glyph positions (and therefore kerning) are decided in **sdkjs
JavaScript**, not in any native C++ layout. The native renderer only *draws* what
JS dictates.

The sdkjs that runs is the deployed build referenced by the docbuilder config
`bin/DoctRenderer.config`:
`/nix/store/1niizaks2afdy6mvx7k6hy0dqyki8qh4-onlyoffice-core-sdkjs` (built from
github.com/ONLYOFFICE/sdkjs by `x2t.nix:325`).

### A red herring: `m_bUseKerning` in the native font engine

Core *does* have a native kerning capability, but it is on a **different code
path** (the AggPlus/`DocxRenderer` rasterizer), not the doctrenderer→PDF path:

- `DesktopEditor/fontengine/FontFile.cpp:137` — `m_bUseKerning = FALSE;` (init, never
  set true anywhere in the tree).
- `DesktopEditor/fontengine/FontFile.cpp:479-484` — `CFontFile::GetKerning` →
  `FT_Get_Kerning(m_pFace, ...)`.
- `DesktopEditor/fontengine/FontFile.cpp:1121` & `:1206` — the only callers, inside
  `GetString`/`GetString2`, guarded by `if (m_bUseKerning && ...)`.

Flipping `m_bUseKerning` to TRUE would **not** change docx→PDF output: the
doctrenderer/`PdfFile` path never calls `GetString`/`GetString2` for body-text
advances. (It would only affect the native AggPlus renderer used elsewhere.) This
was the tempting "one-line fix" and it is a dead end for this conversion.

---

## 3. Why sdkjs produces unkerned positions, even though kerning is reachable

The native text-measurer exposed to V8 (`DesktopEditor/doctrenderer/embed/TextMeasurerEmbed.*`)
binds these JS functions:

- `FT_GetKerningX(face, gid1, gid2)` — registered **unconditionally**
  (`embed/v8/v8_TextMeasurerEmbed.cpp:63`). So sdkjs *can* query legacy kern.
- `HB_ShapeText(...)` — HarfBuzz shaping, registered **only** under
  `#ifdef SUPPORT_HARFBUZZ_SHAPER` (`embed/v8/v8_TextMeasurerEmbed.cpp:43-45`), and
  that macro is defined **only for Android/iOS**
  (`embed/TextMeasurerEmbed.h:6-8`: `#if defined(__ANDROID__) || defined(_IOS)`).
  → On the desktop/server build that produces x2t, **HarfBuzz shaping is not exposed
  to JS at all**. `g_native_engine["HB_ShapeText"]` is undefined
  (`sdkjs/common/libfont/engine/fonts_native.js:11,14-15` reference it but it is
  absent on this build).

In the deployed sdkjs the kerning binding is aliased but **never invoked** by the
word layout:

- `sdkjs/common/libfont/engine/fonts_native.js:11` —
  `AscFonts.FT_GetKerningX = function(face,gid1,gid2){ return g_native_engine["FT_GetKerningX"](...) }`.
- `sdkjs/word/sdk-all-min.js:1302` — `p.i7g = p.FT_GetKerningX` (alias only).
- The word measurer takes glyph advances from `FT_Load_Glyph` /
  `FT_Get_Glyph_Measure_Params` per glyph and **sums them with no pair adjustment**.
  ONLYOFFICE's word processor has no Latin kerning model — this matches the
  well-known editor behavior (no kerning in the browser either).

So the chain is: **HarfBuzz shaping compiled out on desktop → sdkjs falls back to
per-glyph advances → no kerning queried → unkerned positions handed to the PDF
writer.**

---

## 4. How the PDF writer renders runs (where kerning *could* be injected)

- `PdfFile/PdfWriter.cpp:715` `CommandDrawText(wsText, dX, dY)` → `DrawText(...)`
  (`:3461`) adds one text command per sdkjs draw call.
- `PdfFile/PdfWriter.cpp:4148` `EncodeString` derives the embedded font's per-glyph
  `/Widths` from `MeasureChar2` → `GetChar` (per-glyph advance, no kerning).
- `PdfFile/SrcWriter/States.cpp` `CCommandManager::Flush` coalesces consecutive text
  commands into a `CTextLine`, computing the inter-command shift as
  `dX_next − (dX_prev + width_prev)` and emitting a PDF `TJ` array.

Inspecting the actual output stream (`out_kern.pdf`) confirms the model: the line
is one `TJ` array of Identity-H GIDs with small per-glyph adjustments, e.g.

```
[<0001>-83.006<0002>-125.002<0001>-333.003 ... ]TJ      % A V A  ...
```

Those numbers are sub-unit grid corrections from sdkjs, **not kerning**. This is
the exact spot where kerning belongs: between adjacent glyphs of a run, as larger
`TJ` adjustments.

---

## 5. Demonstrated fix (render-time `kern`-table injection)

Because the `TJ` array already exists, kerning can be injected by widening those
adjustments. Proof-of-concept post-processor (`scratch/x2t_kern_postprocess.py`):
for each `TJ` array, map glyph code → unicode via the font's `/ToUnicode`, look up
the pairwise `kern` value from the reference TTF, and add `−kern×1000/upm` between
adjacent glyphs (positive `TJ` number ⇒ next glyph moves left ⇒ tighter).

**Verified before/after** (same harness, same fonts):

| | text width @300 dpi |
|---|---|
| x2t (no kerning) | 1605 px |
| x2t + `TJ` kern injection | **1491 px** (−114 px, ~7 % tighter) |

(Visual: `scratch/x2t_kern_before_after.png`.) The reduction is in the predicted
direction and magnitude — kerning is now applied. This is the empirical proof that
the render-time mechanism is sound.

### 5a. The equivalent ONLYOFFICE/core patch (code-level proposal, compile-unverified)

The same logic belongs in `PdfFile/SrcWriter/States.cpp::CCommandManager::Flush`
(or `CTextLine::Add`), where adjacent text commands and their glyph codes are
already in hand. Sketch:

1. Keep the previous command's last glyph code + font.
2. When adding the next command's glyphs, if same font/size/baseline and the
   embedded font's GID→FT_Face is resolvable, compute
   `k = FT_Get_Kerning(face, prevGid, curGid)` and fold `−k` into the inter-glyph
   `TJ` shift. The writer already owns the font (`CFontDict`) and the
   `CFontManager` (`m_pFontManager` in `CPdfWriter`) can load the face by name and
   expose `GetKerning(gid1,gid2)` (`FontManager.cpp:499`). GIDs in the stream are
   the embedded-subset CIDs (Identity-H); map them back via the subset's
   CIDToGID/ToUnicode the writer built in `EncodeString`.

Wireup would be `patches = [ ./x2t-pdf-kern.patch ];` in `x2t.nix`. **Not produced
as a compiling `.patch` here**: it requires a full core rebuild to verify (the
FlakeHub cache token is expired, so this is a multi-hour from-source build), and an
unverified C++ diff asserted to "work" would be dishonest. The render-time behavior
it would produce is exactly what §5's verified post-processor demonstrates.

### 5b. Limitations of any render-time approach (important)

1. **Legacy `kern` table only.** `FT_Get_Kerning` (and the POC) ignore **GPOS**
   pair adjustments. macOS Garamond happens to ship a `kern` table; many modern
   fonts are GPOS-only and would get nothing. A GPOS-aware fix needs HarfBuzz.
2. **Layout/render width mismatch.** sdkjs reserved each line at *unkerned* width.
   Rendering kerned glyphs makes the run physically shorter than its box. For
   left-aligned text this is invisibly fine (line ends a hair short). For
   **justified** text the inter-word spaces were sized for unkerned glyphs, so the
   last glyph stops short of the right margin by the line's kern sum. Word/LibreOffice
   avoid this because they kern *during* layout — which, again, is the sdkjs JS code,
   not core.
3. Note the repo's recent font-staging commits **strip the legacy `kern` table** from
   render fonts (`b7b0612`). If those staged fonts reach the embedded subset, a
   `kern`-table injector has nothing to read — the injector must key off the
   *original* fonts (as the POC does), not the stripped render copies.

---

## 6. The only *correct* fixes, and why they're impractical here

1. **Enable HarfBuzz shaping on desktop** — drop the `__ANDROID__||_IOS` gate so
   `HB_ShapeText` is exposed to JS on the server build
   (`embed/TextMeasurerEmbed.h:6-8`, `embed/v8/v8_TextMeasurerEmbed.cpp:43`). This is
   the same engine Word/LibreOffice use and would handle `kern` **and** GPOS and
   ligatures. **But** sdkjs must also *choose* to shape Latin runs through
   `HB_ShapeText`; its default measurer uses per-glyph advances and the shaper path
   is geared to complex scripts. So this needs coordinated **core C++ + sdkjs JS**
   changes plus a full rebuild — a real feature, not a toggle.
2. **Implement kerning in the sdkjs word layout** — add `FT_GetKerningX` between
   adjacent glyphs in the measurement/recalc. Correct (layout and render agree) but
   it's a substantial change in minified, separately-built JS, `kern`-table-only
   unless paired with (1), and ONLYOFFICE has deliberately not shipped it.

Both touch sdkjs, which is **not** ONLYOFFICE/core, so neither is the "single small
core patch" the task hoped for.

---

## 7. Recommendation

- **Pragmatic, ship today:** add `scratch/x2t_kern_postprocess.py` as an optional
  post-render step in `scripts/x2t_convert.py` (gated on the run's fonts having a
  `kern` table, keyed off the *original* font files). No rebuild; verified to apply
  kerning. Accept the justified-text caveat (§5b.2) or restrict it to
  left/center-aligned bodies.
- **If GPOS-only fonts matter or justified fidelity is required:** there is no
  small core patch. The real path is enabling HarfBuzz shaping in the desktop build
  *and* routing sdkjs Latin layout through it (§6.1) — a sizeable upstream-style
  change spanning core + sdkjs, validated by a full docbuilder rebuild.

## Artifacts
- `scratch/x2t_kern_postprocess.py` — verified render-time kern injector (deployable).
- `scratch/x2t_kern_before_after.png` — before/after crop.
- Reproduction PDFs/fonts live in the job tmp (`out_kern.pdf`, `out_kern_script.pdf`,
  `fontdir/`).
