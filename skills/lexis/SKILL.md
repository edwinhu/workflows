---
name: lexis
description: "Use when the user says 'get this case from Lexis', 'pull it off Lexis+', 'export the opinion from Nexis', 'use Lexis instead of Westlaw', or names Lexis/Lexis+/Nexis/Protege as the retrieval source. NOT IMPLEMENTED — this skill exists only to route that request to workflows:westlaw, which is implemented. It retrieves nothing itself."
---

# Lexis: not implemented

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

**There is no Lexis retrieval procedure here.** Nobody has driven the Lexis UI, so there are no
measured selectors, endpoints or steps to follow.

**Use `workflows:westlaw`.** It is measured end to end and produces a publisher-keyed DOCX with star
pagination — the same artifact a Lexis route would be built to produce. If the case is available on
Westlaw, the answer to "get it from Lexis" is to get it from Westlaw.

## What we know — UNVERIFIED

Both flagged because they come from documentation and general knowledge, not from a session:

- Lexis offers delivery formats comparable to Westlaw's, including Word and RTF. Which dialog
  controls exist, whether star pagination is a separate option, and what OPC layout the export uses
  are all **unknown**.
- Lexis is rolling out an MCP connector (Protégé). If it delivers verbatim case text rather than
  synthesized research output, it may make browser driving unnecessary — but whether it does is
  **unverified**, and Thomson Reuters' CoCounsel connector notably does not (see the westlaw skill).

## If you implement this

Drive the UI and record what you measure. Do not write a plausible-looking procedure from the
Westlaw one by analogy — a wrong procedure for a real UI costs more than this stub does, because it
reads as authoritative and fails silently partway through.
