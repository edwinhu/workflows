# Faithful Word docx→PDF from background/headless jobs (cmux dispatch)

**Date:** 2026-06-22
**Files:** `scripts/doc_render.py`, `skills/law-review-docx/scripts/build_docx.py`

## Problem

`doc_render.convert(..., renderer="word")` drives Microsoft Word via AppleScript
to get gold-standard PDF fidelity: native kerning/layout, live field updates
(REF/NOTEREF/PAGEREF/TOC), and faithful table rendering.

It works from a foreground/interactive terminal but **fails from a Claude
background job** (cwd under `~/.claude/jobs/...`): the `open`/`activate`/`save as`
AppleEvents return **-600 "Application isn't running"**, and `convert()` silently
falls back to LibreOffice/x2t.

## Table-fidelity context (don't overstate "only Word")

Earlier work already made LibreOffice and x2t grid-faithful **for tables this
codebase builds**:

- **LibreOffice table collapse** (`ec349c5`, `dfb4f1d`): LibreOffice-headless
  collapses a whole table to a single stacked column whenever a cell must
  **auto-wrap** (content wider than its column); Word/x2t wrap and keep the grid.
  Fix: `wrap_cell()` in `build_docx.py`'s `style_tables` greedy-fills each cell
  and inserts explicit `<w:br/>` at wrap points so nothing auto-wraps → soffice
  AND x2t render the grid.
- **x2t kerning** (`714e2b2`, `5ba751b`, `9b48e05`): x2t applies no pair kerning,
  mis-scales non-1000-upm fonts, and mis-renders macOS Garamond. `doc_render`
  injects GPOS/`kern`, normalizes render faces to 1000 upm, and substitutes EB
  Garamond.

So for **build-generated** tables, all three engines are grid-faithful and Word
is preferred only for line-exact polish (widow detection), not table integrity.

Word still matters for **hand-authored** docx whose tables never pass through
`wrap_cell` — e.g. the Mirror Voting draft (Hu/Bishop/Partnoy). Verified
2026-06-22: LibreOffice collapses its p23 table to a single stacked column; Word
renders the proper 7-column grid. That is the case the Word path covers.

## Root cause of the -600 (two independent barriers)

The prior memory note attributed this to "no Aqua/GUI session"; a later guess
blamed "screen asleep." **Both are wrong.** Empirically:

1. **Session split.** A Claude background job is daemonized (reparented to
   `launchd`). GUI apps it launches land in a **separate GUI session**
   (`lsappinfo` ASN `0x1-*`) with **no WindowServer**; the console desktop is
   `0x0-*`. Word can't create the document window it needs to export a PDF in
   `0x1` → **-600**. (`get version` succeeds — it needs no window — a red
   herring.) Ruled out: audit session (`auditd` off → `asid=0` for everything);
   screen lock / display sleep (failed with screen unlocked and display on).
2. **TCC Automation.** `kTCCServiceAppleEvents → com.microsoft.Word` is granted
   only to the foreground terminals (wezterm, cmux, bun, Finder), not to the
   background job's responsible process (`com.anthropic.claude-code`).

A foreground terminal clears both: a GUI-app process in session `0x0` AND
TCC-granted. That is why "foreground works, background doesn't."

## Solution: dispatch the render into a cmux pane

cmux is a GUI terminal running in the console session (`0x0`) and TCC-granted to
control Word; its panes are children of the cmux GUI process, so a command run
inside a cmux pane inherits the working session + grant. From a background job:

1. Connect to the cmux control socket (needs `automation.socketControlMode` ≠
   `"cmuxOnly"` in `~/.config/cmux/cmux.json`).
2. `cmux new-pane --direction right --focus false` → a non-focused helper pane.
3. Stage the docx + an osascript runner in Word's container, then
   `cmux send --surface <ref> -- 'bash <runner>\n'` (literal `\n` = Enter).
4. Poll for a sentinel file, copy the PDF out, `cmux close-surface`.

`_run_word` tries the **direct** AppleEvent path first (foreground/granted) and
only falls back to cmux dispatch on failure. Disable with `$DOC_RENDER_NO_CMUX=1`.

## Validation

From a Claude background job: `convert("…Mirror Voting.docx", out,
renderer="word")` → Producer `macOS … Quartz PDFContext` (**Word's** signature,
not `LibreOffice …`), 45 pages, tables pp. 23/40/44 rendered as clean grids
(`look-at` verified), where LibreOffice collapses p23.

## Prerequisites (one-time, on the host)

- cmux socket control: `automation.socketControlMode` ≠ `"cmuxOnly"` in
  `~/.config/cmux/cmux.json`, then `cmux reload-config` (a normal relaunch/reboot
  also picks it up).
- Microsoft Word granted to cmux under Privacy & Security → Automation (and to
  `com.anthropic.claude-code` for foreground Claude renders); Word in Full Disk
  Access.

## Notes / gotchas

- `hs.osascript.applescript` (in-process Hammerspoon) reaches Word but
  **deadlocks** on multi-step renders (blocks the runloop Word's reply needs →
  instant -1712); only fast property reads work in-process. `hs.task` children do
  `get version` but not window ops. Hence cmux panes, not Hammerspoon.
- cmux is in the console session (`0x0`) from any normal launch (login item,
  Dock, Spotlight, reboot). The only degenerate case: a detached/background
  process relaunching it via `open -a` inherits the job's non-GUI session
  (`0x1`), window-less, no socket. Don't relaunch cmux from inside a background
  job — a normal launch/reboot restores it.
- `cmux send` Enter needs a **literal** `\n` (backslash-n), not an actual
  newline, and must target a ready shell pane (not a TUI/busy pane).
