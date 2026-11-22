---
name: edgar
description: "ALWAYS use before getting SEC EDGAR filings or writing code that does - 'pull filings', 'download the 10-Ks', '10-K / 10-Q / 8-K / DEF 14A / S-1 text', 'filing text', 'get the exhibits', 'charters and bylaws', 'credit / employment / stockholder agreements from filings', 'EX-3.1 / EX-10', 'list a company's filings', or any script touching sec.gov/Archives or data.sec.gov/submissions. Use even when the user names sec.gov or a filing URL, or a filing fetch returns 403. NEGATIVE ROUTING: SEC rules releases, SEC web pages and XBRL company-facts APIs go to sec-fetch; WRDS datasets other than filing documents go to wrds."
---

# EDGAR filings

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

<EXTREMELY-IMPORTANT>
**BULK IN ROUNDS, NEVER ONE REQUEST PER DOCUMENT. NO FILING TEXT THROUGH SQL.** More than one filing, or code that could be run over more than one, comes from WRDS by one `rclone copy --files-from` per round. A fetch that discovers its targets as it parses is still a bulk job. A per-document loop is not helpful: each `rclone cat` opens a new SFTP connection (1-2 s), and each sec.gov request spends the user's rate limit and risks an IP block.
</EXTREMELY-IMPORTANT>

## Route by shape

| The need | Source |
|---|---|
| Many filings, their exhibits, or a list of filings | WRDS, below |
| Phrase search inside filings | `${CLAUDE_PLUGIN_ROOT}/skills/wrds/references/sec-text-search.md` |
| One filing, looked at once, not from a script | sec.gov is allowed, through `sec-fetch`; WRDS works too |
| Filings newer than `max(fdate)` in `wrdssec_all.wrds_forms` (it lags about a business day) | `sec-fetch`, for those filings only, after running that query |
| SEC rules releases and web pages; data.sec.gov APIs with no WRDS equivalent | `sec-fetch` |

## WRDS route

Before writing the pull, read § "Download Filing Text via WRDS rclone" in `${CLAUDE_PLUGIN_ROOT}/skills/wrds/references/edgar.md`.

1. **First list by SQL:** `cik, accession, form, fdate, wrdsfname` from `wrdssec_all.wrds_forms`. `cik` is a 10-digit string.
2. **One bulk copy:** `wrdsfname` is the path under both roots, `wrds:/wrds/sec/archives` (raw SGML with every exhibit) and `wrds:/wrds/sec/wrds_clean_filings` (markup stripped). Clean is for text; **discovery needs raw**, because clean drops the hrefs to referenced filings. Clean also empties GRAPHIC, XBRL, XML, EXCEL and ZIP bodies, so those need raw too.
3. **Parse locally for the next list** (referenced accessions), copy that list in one go, and repeat until no new targets.
4. **Extract locally:** both copies keep the `<DOCUMENT>`, `<TYPE>` and `<FILENAME>` tags.

```bash
E="${CLAUDE_SKILL_DIR}/scripts/edgar_filing.py"
python3 "$E" fetch pairs.tsv out/ [--clean]           # one round: "cik accession" lines in, local paths out
python3 "$E" resolve pairs.tsv                        # the list alone, on stdout; over 10K files feed it to edgar.md's tar route
python3 "$E" extract <local path> --list
python3 "$E" extract <local path> --type EX-3.1       # or --filename d123dex31.htm
python3 "$E" path <cik> <accession> [--clean]         # offline
```

In Python, `fetch_round(pairs, dest)` is one round and `fetch_rounds(seeds, dest, discover)` repeats it: `discover` gets a round's local paths and returns the next pairs.

- Raw submissions are large (1,150 filings = 6.2 GB). When only a few `<DOCUMENT>` blocks per filing are needed, use clean, or extract on WRDS in a grid array job (`edgar.md` § "SGE Submission Pattern"; this script is stdlib-only) and copy back only those blocks.
- An exhibit incorporated by reference names the accession of the filing that carries it, often under another CIK (predecessor, parent, filer agent prefix). `resolve` finds it by accession; a path built from the citing firm's CIK silently misses it.
- A missing file under WRDS is not a reason to switch the batch to sec.gov. Report the residue, and send only filings past `max(fdate)` to `sec-fetch`.

## Red flags

| About to | Why wrong | Do instead |
|---|---|---|
| Call `rclone cat` / `requests.get` inside a loop over filings | One connection per document | Collect the round's list, then `fetch` it once |
| Put a `sec.gov/Archives` URL in a script | It becomes a per-filing loop on the next run | `resolve`, then one `rclone copy` |
| Read `data.sec.gov/submissions` to list filings | `wrds_forms` has the list for every CIK in one query | Query `wrds_forms` |
| Fetch each exhibit by URL | The submission file already contains it | `extract` |
| Fix a 403 on a batch of filings with a User-Agent | It repairs the wrong route | Move the batch to WRDS |
