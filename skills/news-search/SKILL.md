---
name: news-search
description: "Use when the user says 'search Factiva', 'Factiva', 'Lexis news', 'Lexis+ News', 'news archive search', 'find press releases about a CEO change', 'who preceded the CEO', or 'newspaper coverage of a company'. NEGATIVE ROUTING: Lexis Public Records (entity status, liens, judgments) goes to workflows:lexis; case law goes to workflows:westlaw."
---

# News archive search: Lexis+ News and Factiva

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Read `${CLAUDE_SKILL_DIR}/references/news-search.md` before running anything: access, syntax, the per-engine procedure and the failure modes. Scripts are in `${CLAUDE_SKILL_DIR}/scripts/` (`lexis_q.py`; `fcheck3.js` + `cdpev.py` + `fwatch.py`); both engines run in the user's signed-in Chromium on CDP :9222.

<EXTREMELY-IMPORTANT>
**NEVER RUN A FACTIVA SCRIPT AND A LEXIS SCRIPT AT THE SAME TIME.** Both drive the one browser; a concurrent Lexis batch made every Factiva row return n=0 with no error. Check `ps -eo pid,args | grep '[l]exis_q'` first, and chain the two.
</EXTREMELY-IMPORTANT>

- Sign in only with the user's go-ahead for that service; approval for one does not cover the other. A signed-out tab is a stop-and-report.
- Pacing: one query at a time; 25 s between Lexis searches.
- Keep the Factiva tab in front while a batch runs; a background tab silently leaves the date at Last Year.
- Results persist per query (Lexis: `out.json` after every query; Factiva: `__f3_<tag>` in localStorage plus `fwatch.py` snapshots). An empty Factiva result from the pre-fix helper is not evidence of absence.
