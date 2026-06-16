# Bright Data Web Archive API

Bright Data's own crawl archive (a Wayback-like corpus). Search is FREE; dump is PAID (~$0.001/page). Always search first, show `dump_cost_usd`, get explicit approval before any dump.

Base URL: `https://api.brightdata.com/webarchive`
Auth header: `Authorization: Bearer $BRIGHTDATA_API_TOKEN`

## Endpoints

### POST /webarchive/search  (FREE, async)
Body: `{"filters": { ... }}` → returns `{"search_id": "ucd_..."}`.

### GET /webarchive/search/<search_id>  (FREE)
Returns `status` ("in_progress" | "done"). When done:
- `files_count` — number of matching snapshots
- `dump_cost_usd` — cost to dump them (≈ files_count/1000)
- `estimate_batch_count` — dump batches

### POST /webarchive/dump  (PAID — DO NOT CALL WITHOUT EXPLICIT APPROVAL)
~$0.001 per page. Never invoke during exploration.

## Filters

`filters` object:
- **Date (required):** either `max_age` (e.g. `"7d"`, `"30d"`) OR both `min_date` + `max_date` (`"YYYY-MM-DD"`).
- `domain_whitelist`: array of exact hosts, e.g. `["brokercheck.finra.org"]`.
- `domain_like_whitelist`: array of SQL-LIKE patterns, e.g. `["%finra%"]`.
- `url_like_whitelist`: SQL-LIKE on full URL — scope a cheap subset, e.g. `["%/individual/summary/%"]`.
- `unique_url` (bool): dedupe to distinct URLs (use for a clean cross-section dump and lower cost).

## curl

```bash
TOKEN=${BRIGHTDATA_API_TOKEN:-$(cat ~/projects/batm/scratch/brd_token.txt)}

# launch
SID=$(curl -s -X POST https://api.brightdata.com/webarchive/search \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filters":{"min_date":"2015-01-01","max_date":"2026-06-10","domain_whitelist":["adviserinfo.sec.gov"],"unique_url":true}}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['search_id'])")

# poll
curl -s https://api.brightdata.com/webarchive/search/$SID -H "Authorization: Bearer $TOKEN"
```

## Parallel-poll Python harness (verified working)

Launch many searches at once, then poll until all done. Searches take 9+ minutes; poll every ~20s.

```python
import json, os, time, urllib.request

TOKEN = os.environ.get("BRIGHTDATA_API_TOKEN") or open(
    os.path.expanduser("~/projects/batm/scratch/brd_token.txt")).read().strip()
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

def launch(filters):
    req = urllib.request.Request(
        "https://api.brightdata.com/webarchive/search",
        data=json.dumps({"filters": filters}).encode(), method="POST", headers=H)
    return json.loads(urllib.request.urlopen(req).read())["search_id"]

def poll_one(sid):
    req = urllib.request.Request(
        f"https://api.brightdata.com/webarchive/search/{sid}", headers=H)
    return json.loads(urllib.request.urlopen(req).read())

ALL = {"min_date": "2015-01-01", "max_date": "2026-06-10"}
searches = {
    "brokercheck":  {**ALL, "domain_whitelist": ["brokercheck.finra.org"]},
    "adviserinfo":  {**ALL, "domain_whitelist": ["adviserinfo.sec.gov"]},
}

ids = {name: launch(f) for name, f in searches.items()}
results, pending, t0 = {}, dict(ids), time.time()
while pending:
    for name, sid in list(pending.items()):
        r = poll_one(sid)
        if r.get("status") == "done":
            results[name] = {k: r.get(k) for k in
                             ("files_count", "dump_cost_usd", "estimate_batch_count")}
            print(int(time.time()-t0), name, "DONE", results[name])
            del pending[name]
    if pending:
        time.sleep(20)
print(json.dumps(results, indent=1))
```

## Patterns

- **Get a clean current cross-section, cheaply:** run with `unique_url: true` (dedupes repeat snapshots → ~half the pages, half the cost).
- **Scope a subset dump:** combine `domain_whitelist` + `url_like_whitelist` (e.g. only individual broker summaries) and re-search to get that subset's exact cost before dumping.
- **Check recency / panel potential:** run year-bracketed searches (`min_date`/`max_date` = one year) to see the temporal distribution before assuming a time series exists.
- **Confirm cost arithmetic:** `dump_cost_usd ≈ files_count / 1000`. If it diverges wildly, re-check the filter.
