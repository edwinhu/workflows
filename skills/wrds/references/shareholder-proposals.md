# Shareholder Proposals (Rule 14a-8) — US SIF Proxy Proposal Archive

**Not on WRDS.** The US SIF Proxy Proposal Archive (https://www.ussif.org/research/proxy-proposal-archive)
is a free, public, unauthenticated JSON API. It lives in this skill because a shareholder-proposal
question also needs ISS Voting Analytics (`iss-voting.md`), and the two answer different halves.

## Which source answers what

| Question | Source |
|---|---|
| For/against/abstain counts, base-conditional support %, mgmt rec, 2003+ | ISS `risk.vavoteresults` with `sponsor = 'Shareholder'` (`iss-voting.md`) |
| Proposals that never reached a vote — **withdrawn**, **omitted** (SEC no-action concurrence), not in proxy | US SIF only; ISS has voted items only |
| Full WHEREAS and RESOLVED text, proponent name, topic coding | US SIF |
| Why an omitted proposal was excluded (14a-8(i)(7) ordinary business, (i)(3) vague, (i)(12) resubmission…) | US SIF `notes`, plus the SEC correspondence PDFs in `downloads` |
| Coverage before 2010 | ISS only |

US SIF is not a census: 7,229 proposals 2010-2025 against roughly 17K ISS shareholder items 2003-2025, weighted toward ESG, social and governance topics. Link to ISS or CRSP by `company.ticker` + meeting date — there is no CIK or CUSIP.

## API

Base `https://www.ussif.org/api/proxy-proposal-archive`. Verified 2026-10-22 with curl (plain `Mozilla/5.0` User-Agent, no auth, no cookies):

```bash
B=https://www.ussif.org/api/proxy-proposal-archive
curl -s "$B/actions?page=1&sortBy=meetingDate&sortOrder=desc"   # list: {"total":7229,"results":[25 rows]}
curl -s "$B/actions?page=1&status=omitted"                       # filter by status
curl -s "$B/action?id=7960"                                      # one proposal, full record
```

- **25 rows per page, fixed** — `pageSize=100` is ignored. 7,229 rows → 290 pages; page 290 held 4 rows, the oldest meeting 12 January 2010. Newest meeting 9 December 2025.
- `status` filter values and totals seen: `voted on` 3,501 · `withdrawn` 2,758 · `omitted` 886 · `not in proxy` 22. The remaining 62 carry other statuses; enumerate them from a full pull, not from this list.
- A full pull is 290 list calls + 7,229 detail calls. Run the detail calls with a small thread pool and a polite rate; there is no bulk export.

## Fields

List row (`results[]`): `id`, `meetingDate`, `status`, `company` (name string), `issue` (string), `topics` (list of strings), `downloads` (**a count**, not the list), `proponent` (string).

Detail record (`/action?id=`) is nested differently:

| field | shape / note |
|---|---|
| `id`, `status`, `meetingLocation` | scalar |
| `meetingDate`, `proxyDate` | **prose dates** (`"9 December 2025"`) — parse with `%d %B %Y`; `proxyDate` can precede the meeting by more than a year |
| `company.name`, `company.ticker` | ticker on every record |
| `proponent.name` | lead filer only |
| `issue.name`, `issue.topics[].{id,name}` | e.g. `Social (Human Rights)` |
| `proposal` | the WHEREAS text |
| `resolvedClause` | the RESOLVED text |
| `notes` | analyst commentary; for omitted items it names the exclusion argument |
| `votes` | support %, float. **`0` (not null) when no vote was held** — filter on `status == 'voted on'` before using it |
| `downloads[].{id,filename,type}` | `type` seen: `Proxy Statement`, `Exempt Solicitation`, `Action Report`, `SEC Correspondence`. URL = `https://www.ussif.org` + URL-encoded `filename` (returns `application/pdf`) |

There is no `has_sec_decision` field in the API: derive it as "any `downloads[].type == 'SEC Correspondence'`". All 6 omitted records sampled carried one or more SEC Correspondence PDFs (the no-action request and the staff response).

## Gotchas

1. **Snake-case names in older pulls are not the API's.** A 2026-04 pull saved `proposal_text`, `resolved_clause`, `votes_pct`, `has_sec_decision`; the API returns `proposal`, `resolvedClause`, `votes` and a `downloads` list. Map them at the pull, don't assume them.
2. **List `downloads` is a count, detail `downloads` is a list** — the list endpoint cannot tell you which items have SEC correspondence.
3. **`omitted` ≠ every no-action letter.** It is the proposals US SIF tracked where the company won exclusion. A request the staff denied leaves no `omitted` row, so for the full no-action universe use the SEC's own 14a-8 response pages.
