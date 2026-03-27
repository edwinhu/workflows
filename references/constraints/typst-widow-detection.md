---
name: typst-widow-detection
description: Every compile MUST be followed by PDF widow detection — source-level checks are not ground truth
applies-to: [workshop, workshop-revise]
---

## Rule

<EXTREMELY-IMPORTANT>
**EVERY COMPILE MUST BE FOLLOWED BY PDF WIDOW DETECTION. This is not negotiable.**

Source-level checks estimate widow risk; Typst's line-breaking algorithm is the final arbiter. The PDF check is ground truth.

After every successful compilation:
```bash
DETECT_WIDOWS=$(command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1) && python3 "$DETECT_WIDOWS" slides.pdf
```

Exit code 1 = widows found. Gate does NOT pass until 0 widows.

**Widow Fix Strategies (in order):**
1. **Tighten wording** — remove redundant words
2. **`~` (non-breaking space)** — tie last 2-3 words: `gun-jumping~rules.`
3. **`#box[]` for unbreakable units** — when `~` fails at en-dashes: `#box[(CP 515--520)]`
4. **Restructure clause** — reorder words for different break points

**CRITICAL: `~` does NOT prevent breaks at en-dashes (`--`).** Use `#box[]` instead for units containing en-dashes.

Never pad with filler words.
</EXTREMELY-IMPORTANT>
