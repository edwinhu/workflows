---
name: lexis
description: "Use when the user says 'Lexis Public Records', 'Secretary of State entity status via Lexis', 'corporate filings', 'is this company revoked / in good standing in Nevada', 'judgments and liens', 'UCC lookup', 'Lexis bankruptcy search', 'FEIN lookup', or 'locate a business'. Also use when the user says 'get this case from Lexis', 'pull it off Lexis+', 'export the opinion from Nexis', or names Lexis/Lexis+/Nexis/Protege as a case-retrieval source. NEGATIVE ROUTING: case and opinion retrieval is NOT implemented here — use workflows:westlaw; Delaware entity status is not available on Lexis at all."
---

# Lexis: Public Records measured; case retrieval not implemented

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

**There is no Lexis case-retrieval procedure here.** Nobody has driven the Lexis+ case-law UI, so
there are no measured selectors, endpoints or steps to follow for it.

**Use `workflows:westlaw`.** It is measured end to end and produces a publisher-keyed DOCX with star
pagination — the same artifact a Lexis route would be built to produce. If the case is available on
Westlaw, the answer to "get it from Lexis" is to get it from Westlaw.

## Public Records (measured)

Business records only; the account has no DPPA/GLBA permissible use, so person-level sources are closed. Facts, field ids and the worked example: `${CLAUDE_SKILL_DIR}/references/public-records.md` — read it before touching the UI. Entity lookups by filing number: `bun ${CLAUDE_SKILL_DIR}/scripts/corp-lookup.ts <in.csv> <out.csv> [--full]` (CDP :9222, signed-in tab, resumable; `--full` adds status date, annual list, `filing_history` JSON and last default/revocation/reinstatement dates; an out.csv from before that has a different header and is refused).
Judgments & liens by company/FEIN: `bun ${CLAUDE_SKILL_DIR}/scripts/jnl-lookup.ts <in.csv> <out.csv> [--max-records N] [--no-strict] [--fein-only | --debtor-segment] [--dry-run]` (`--debtor-segment` = Terms-and-Connectors `debtor("NAME")`; live-tested 2026-10-09 and it does NOT narrow: 0 hits for one firm, 1,448 loose hits for another, so do not use it to cut noise; `--dry-run` prints the queries offline; one row per record, 50 per query by default; filter on `debtor` afterwards, strict search did not narrow Troika; name+FEIN does not narrow either, a blank `company` with a `fein` runs a FEIN-only search, `--fein-only` ignores the company column — see references/public-records.md).

- **Delaware is not covered.** The jurisdiction dropdown has 50 states without it; do not look for Delaware status on Lexis.
- **Clear the form before every search.** It keeps the previous terms, and a stale company name ANDs with a new charter number into zero results.
- **Pacing is a hard limit:** one search at a time, at least 20 s apart, 100 per run by default and never more than 300 (the script refuses a shorter delay or a larger cap). No bulk export; this is for validation samples, not dataset construction.

| About to | Why wrong | Do instead |
|---|---|---|
| Write an ad-hoc CDP loop for entity lookups | It skips the form-clearing and pacing the script enforces | Run `corp-lookup.ts` |
| Sign in, or solve a CAPTCHA, in the user's Lexis tab | Credentials and sessions are the user's | Stop and report |
| Search Delaware or treat "no results" as "no such entity" | Delaware is not in coverage; check `coverage/CorpFil.html` | Report not covered |

## Case retrieval — what we know, UNVERIFIED

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
