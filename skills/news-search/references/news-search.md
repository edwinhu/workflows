# News archive search: Lexis+ News and Factiva (measured)

Both run in the user's signed-in Chromium on CDP port 9222, driven by the scripts in `scripts/`.
They were measured on 2026-11-21/22 in the founder-ceo-ipo project, which asked who preceded each
IPO CEO and whether that person was a founder. The counts below come from that project's ledger
(`scratch/validate_claude/factiva_pilot.tsv`).

## Access

- **Lexis+ News**: `https://plus.lexis.com`, UVA account (Lexis sign-in page, 1Password item "Lexis (UVA)").
- **Factiva**: `https://app-dowjones-com.proxy1.library.virginia.edu/factiva/search`, through the UVA
  EZproxy, sign-in by NetBadge (1Password item "UVA Computing ID" in the Shared with Agents vault).
  No Duo prompt was observed when the device was already remembered.
- Both sessions die when Chromium restarts: every tab closes and both services sign out. A script
  then fails with `WebSocketConnectionClosedException` (Lexis) or `StopIteration` (no Factiva tab).
- Sign in only with the user's explicit go-ahead for that service; approval for one does not cover the other.

## Lexis+ News: `lexis_q.py`

`python3 scripts/lexis_q.py <queries.json> <out.json>`, where queries.json is `[[key, query], ...]`.

- URL search, no form: `https://plus.lexis.com/search/?pdmfid=1530671&pdsearchterms=<q>&pdtypeofsearch=searchboxclick&pdsearchtype=SearchBox&pdqttype=and`.
- Waits for the content-type row `button.contentTypeRow` whose text matches `^News\s*[\d,]+$`, clicks
  it, then reads up to 3 distinct `a.titleLink` articles.
- `n = null` in the output means no News row appeared (zero news hits, or the page did not load); it is not 0.
- Keeps every sentence with found/co-found/chief executive/CEO/president, regardless of name.
- Syntax that worked: `AND`/`OR`, quoted phrases, `!` truncation (`succeed!`), `date(bef MM/DD/YYYY)`,
  `date(aft MM/DD/YYYY)`, `hlead(...)`.
- Writes out.json after every query, so a crashed run keeps its results; it does not skip keys
  already present, so build a remaining-keys file before restarting.
- Pacing: one query at a time, 25 s sleep after each; about 1.5 min per query including 3 article reads.
- Exits 3 when the page redirects to sign-in.

## Factiva: `fcheck3.js` + `cdpev.py` + `fwatch.py`

The helper is injected into the Factiva tab and runs inside the page.

1. Inject: `python3 scripts/cdpev.py "($(cat scripts/fcheck3.js))()"`; it returns `"function"`.
   Re-inject after any reload or sign-in.
2. Start: `python3 scripts/cdpev.py "__go3(<batch json>, '<tag>')"`; the batch is
   `[[rid, query, surname_regex, to_date, max_articles], ...]` and `to_date` is **DD-MM-YYYY**.
3. Watch: `python3 scripts/fwatch.py <outdir> <tag>` snapshots results to `<outdir>/f3_<tag>.json` and
   exits when the tag is done. Results also persist in the page's localStorage under `__f3_<tag>`.

- Per query it opens Search Builder, sets Custom Date from 01-01-1985 to `to_date`, types the query with
  `execCommand('insertText')`, clicks Search, reads the headline count, then collects the result hrefs and reads up to `max_articles` of them (the `opened` field lists the headlines read).
- Keeps a sentence if it contains `surname_regex` **and** a role keyword (found, join, named, appoint,
  succeed, replac, step down, chief executive, CEO), **or** if it contains both a founder word (found/co-found) and a CEO word (CEO/chief executive).
- Syntax: Factiva Boolean, `*` truncation (`succeed*`); the date comes from the dialog, not the query.
- Pacing: about 25–40 s per query including article reads.

## Failure modes seen

| Symptom | Cause | Check |
|---|---|---|
| Every Factiva row returns n=0, no error | A Lexis batch was driving another tab at the same time; the typed query and custom date never applied | Snapshot the page: empty Search Field and "Last Year" in the date button. Never run the two at once; chain them |
| A Lexis or Factiva script dies mid-run | Chromium restarted; all tabs closed and both services signed out | `curl -s localhost:9222/json/list` shows no page targets |
| Factiva results dated after the cutoff, or zero hits, with no error | The Factiva tab was not in front (another tab selected), so the custom date stayed Last Year | The date button reads Last Year; bring the tab to front (chrome-devtools `select_page` with `bringToFront: true`); the guarded `fcheck3.js` now refuses to search in that state |
| Factiva lands on NetBadge | The EZproxy session expired | Sign in again (with the user's go-ahead), then re-inject the helper |

**Re-injection.** The guard in `fcheck3.js` reloads the page when the date did not apply. After any page reload (the guard's, or a manual one) the injected helper is gone and must be re-injected; `__go3` then resumes from the `__f3_<tag>` state in localStorage.

## Coverage: what the ledger does and does not show

The archives are close; the old Factiva helper read far less of each result list than the Lexis script.

**Same 21 queries on both engines** (2026-11-22; tech IPO CEO plus labelled predecessor plus succession words, cut off at the end of the IPO year):

| | Lexis+ News | Factiva |
|---|---|---|
| Articles returned, summed over the 21 queries | 296 | 232 |
| Queries with zero hits | 0 (one returned null) | 2 |
| Queries where a kept sentence confirmed or refuted the label (keyword screen) | 16 | 11 |

- Hit counts were within a factor of two on 19 of the 21 queries, and the decisive appointment releases (Medallia, Arteris, Tintri) were in both archives.
- Archive differences on single companies: Lexis had the 2016 Cyanogen (now Cyngn) coverage that Factiva lacked; Factiva had Dow Jones items that settled Coursera (Levin preceded Maggioncalda) and Udemy (Yang preceded Coccari), and TuSimple and Toast, where Lexis kept nothing.

**Why the old ledger made Factiva look weak:**

1. **The old Factiva helper read one article per query.** In every run, 330 queries in all, it kept at most one article (two articles once). After the first article, `history.back()` returns to Search Builder without the results list, so the next article link is never found. Lexis reads three. `fcheck3.js` in this skill is fixed (it collects the result hrefs first and reads each article in a hidden same-origin iframe, so the results list is never left).
2. **Narrow sentence filter.** The old helper kept only sentences containing `surname_regex`; Lexis kept any founder/CEO sentence (now widened, above). A founder sentence that names the founder but not the searched surname was dropped.
3. **Order.** Factiva ran first on every open case, and Lexis then ran on the residue with different query shapes; the pass-level rates (Factiva open-case pass 15 of 335 decisive, Lexis general news pass 7 of 93) are not comparable.
4. **Ledger labelling.** In founder-ceo-ipo `build.py` maps every pass tag without "Lexis" to source Factiva, so the S-1 prospectus and web passes count as Factiva.

So run both, and do not read an empty Factiva result from the old helper as evidence of absence.

## What worked for predecessor questions (both engines)

- Generic "<company> AND <IPO CEO> AND CEO" searches mostly return "X named CEO" releases that never name the predecessor.
- Searches anchored on a lead paid off: a named predecessor, a former company name, or an executive bio
  ("served as our Chief Executive Officer from", "co-founder and former CEO").
- Date-limit to the end of the IPO year; later coverage is dominated by earnings calls.
- A founding or interim CEO who is a partner at the backing VC firm is common in 2016–2024 biotech;
  appointment releases usually state the firm ("Longwood General Partner and founding CEO").
