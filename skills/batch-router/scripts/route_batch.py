#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Rank batch providers for one job: soonest-expiring prepaid credit first, then cheapest pay-per-token.

Never submits anything and makes no network call. Balances are never stored: pass what the Console
shows as --balance <account>=<usd>; without it the balance is UNVERIFIED (assumed <= the monthly credit).

Usage:
  route_batch.py --requests 5000 --in-tokens 3000 --out-tokens 300 [--tier cheap] [--needs web-search]
  route_batch.py --jsonl requests.jsonl [--out-tokens 300] [--balance uva=200] [--json]
Exit codes: 0 ranked (at least one usable candidate), 1 nothing usable, 2 argument error.
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from batchlib import (
    CAPABILITIES,
    LIMITS,
    MODELS,
    SEARCH_USD,
    Account,
    accounts_path,
    batch_cost,
    key_status,
    load_accounts,
    measure_jsonl,
    shards_needed,
)

SKILLS = Path(__file__).resolve().parents[2]
MARGIN = 0.20
GEMINI_FREE_SEARCHES = 5000  # per month across Gemini 3; account-dependent, treated as unspent


def next_command(provider: str, account: str | None, model: str) -> str:
    if provider == "anthropic":
        s = SKILLS / "claude-batch/scripts/claude_batch.py"
        return f"uv run {s} validate <jsonl>  # then verify, then submit --account {account} --run"
    if provider == "openai":
        s = SKILLS / "openai-batch/scripts/openai_batch.py"
        return f"uv run {s} validate <jsonl>  # then verify, then submit --run (model {model})"
    return f"Skill workflows:gemini-vertex  # Cloud Batch, model publishers/google/models/{model}"


def pick_model(provider: str, tier: str, model: str | None) -> str | None:
    if model:
        return model if MODELS.get(model, {}).get("provider") == provider else None
    for mid, m in MODELS.items():
        if m["provider"] == provider and m["tier"] == tier:
            return mid
    return None


def rank(args, accounts: dict[str, Account], today: date) -> list[dict]:
    balances = dict(args.balance)
    needs = set(args.needs)
    nbytes = args.bytes or int(args.requests * (args.in_tokens * 4 + 400))
    est_searches = round(args.requests * args.searches_per_row) if "web-search" in needs else 0

    # Gemini needs no account entry: Vertex is pay-per-token on GCP and always the fallback.
    pools = list(accounts.values())
    if not any(a.provider == "gemini" for a in pools):
        pools.append(Account(name="vertex", provider="gemini", label="Vertex AI (pay-per-token)", key="adc"))

    out = []
    for acct in pools:
        prov = acct.provider
        model = pick_model(prov, args.tier, args.model)
        row = {"account": acct.name, "provider": prov, "label": acct.label, "model": model, "notes": []}
        if model is None:
            row.update(group=4, reason=f"no {args.model or args.tier} model on {prov}")
            out.append(row)
            continue
        missing = needs - CAPABILITIES[prov]
        cost = batch_cost(model, args.requests, args.in_tokens, args.out_tokens)
        searches = est_searches
        if prov == "gemini":
            searches = max(0, est_searches - GEMINI_FREE_SEARCHES)
        cost += searches * SEARCH_USD[prov]
        shards = shards_needed(prov, args.requests, nbytes)
        row.update(cost_usd=round(cost, 4), shards=shards)
        if shards > 1:
            lim = LIMITS[prov]
            row["notes"].append(f"shard into {shards} batches (limit {lim[0]:,} req / {lim[1] // 2**20} MB)")
        if est_searches:
            row["notes"].append(f"~{est_searches:,} searches priced at ${SEARCH_USD[prov] * 1000:.0f}/1k"
                                + (" after 5k free" if prov == "gemini" else ""))
        if missing:
            row.update(group=4, reason=f"batch path lacks: {', '.join(sorted(missing))}")
            out.append(row)
            continue
        usable, kdesc = (True, "ADC") if acct.key == "adc" else key_status(acct)
        if not usable:
            row.update(group=4, reason=f"{kdesc}")
            if acct.monthly_credit_usd:
                row["notes"].append(f"${acct.monthly_credit_usd:.0f} credit idle until a key is added")
            out.append(row)
            continue
        if acct.prepaid:
            renews = acct.cycle_renews
            days = (renews - today).days if renews else None
            if acct.name in balances:
                bal, verified = balances[acct.name], True
            else:
                bal, verified = acct.monthly_credit_usd, False
            row.update(balance_usd=bal, balance_verified=verified, expires=str(renews) if renews else None,
                       days_left=days)
            if days is not None and days < 0:
                row["notes"].append(f"cycle_renews {renews} has passed: update accounts.toml; balance unknown")
                verified = False
                row["balance_verified"] = False
            if not verified:
                row["notes"].append(f"balance UNVERIFIED: assumed <= ${acct.monthly_credit_usd:.0f} monthly credit")
            if days is not None and 0 <= days < 1:
                row["notes"].append("credit expires within 24h: a batch may outlive it")
            if cost * (1 + MARGIN) <= bal and (days is None or days >= 1):
                row.update(group=1, reason=f"prepaid covers ${cost:.2f} +20% (balance ${bal:.2f})")
            else:
                row.update(group=2, reason=f"prepaid, but ${cost:.2f} +20% exceeds ${bal:.2f} or expiry too near")
        else:
            row.update(group=3, reason="pay-per-token" + (" (credit not linked/confirmed)"
                                                          if acct.monthly_credit_usd else ""))
        row["next"] = next_command(prov, acct.name, model)
        out.append(row)

    def key(r):
        g = r["group"]
        if g in (1, 2):
            return (g, r.get("days_left") if r.get("days_left") is not None else 10**6, r["cost_usd"])
        if g == 3:
            # Gemini Vertex wins ties: it is the house fallback.
            return (g, r["cost_usd"], 0 if r["provider"] == "gemini" else 1)
        return (g, 0, 0)

    return sorted(out, key=key)


def parse_balance(s: str) -> tuple[str, float]:
    try:
        name, usd = s.split("=", 1)
        return name.strip(), float(usd)
    except ValueError:
        raise argparse.ArgumentTypeError(f"--balance wants <account>=<usd>, got {s!r}") from None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--requests", type=int, help="number of requests in the job")
    ap.add_argument("--in-tokens", type=float, help="mean input tokens per request")
    ap.add_argument("--out-tokens", type=float, help="mean output tokens per request")
    ap.add_argument("--jsonl", type=Path, help="measure requests / input tokens / bytes from this file")
    ap.add_argument("--needs", action="append", default=[],
                    choices=["vision", "pdf", "web-search", "long-context"])
    ap.add_argument("--tier", default="cheap", choices=["cheap", "mid", "top", "frontier"])
    ap.add_argument("--model", help="exact model id; restricts each provider to it")
    ap.add_argument("--searches-per-row", type=float, default=2.0, help="with --needs web-search")
    ap.add_argument("--balance", action="append", default=[], type=parse_balance,
                    help="<account>=<usd> as seen in the Console today")
    ap.add_argument("--today", type=date.fromisoformat, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    args.bytes = None
    if args.jsonl:
        m = measure_jsonl(args.jsonl)
        args.requests = args.requests or m["rows"]
        args.in_tokens = args.in_tokens or m["in_tokens"]
        args.out_tokens = args.out_tokens or m["out_tokens"]
        args.bytes = m["bytes"]
    if not args.requests or args.in_tokens is None or args.out_tokens is None:
        print("usage: route_batch.py --requests N --in-tokens T --out-tokens T  (or --jsonl FILE)",
              file=sys.stderr)
        return 2
    if args.model and args.model not in MODELS:
        print(f"unknown model {args.model}; known: {', '.join(MODELS)}", file=sys.stderr)
        return 2

    today = args.today or datetime.now().astimezone().date()
    accounts, _ = load_accounts()
    ranked = rank(args, accounts, today)
    usable = [r for r in ranked if r["group"] < 4]

    if args.json:
        print(json.dumps({"today": str(today), "accounts_file": str(accounts_path()),
                          "job": {"requests": args.requests, "in_tokens": args.in_tokens,
                                  "out_tokens": args.out_tokens, "needs": args.needs, "tier": args.tier},
                          "candidates": ranked}, indent=2, default=str))
        return 0 if usable else 1

    print(f"job: {args.requests:,} requests × {args.in_tokens:,.0f} in / {args.out_tokens:,.0f} out tokens"
          f"; tier {args.model or args.tier}; needs {', '.join(args.needs) or 'nothing extra'}; today {today}")
    if not accounts:
        print(f"(no accounts file at {accounts_path()}: only the Gemini fallback is known)")
    groups = {1: "prepaid, covers", 2: "prepaid, short", 3: "pay-per-token", 4: "blocked"}
    print(f"{'#':>2}  {'account':<8} {'provider':<9} {'model':<22} {'est $':>9}  {'group':<16} reason")
    for i, r in enumerate(ranked, 1):
        cost = f"{r['cost_usd']:.2f}" if "cost_usd" in r else "-"
        print(f"{i:>2}  {r['account']:<8} {r['provider']:<9} {r['model'] or '-':<22} {cost:>9}  "
              f"{groups[r['group']]:<16} {r['reason']}")
        for n in r["notes"]:
            print(f"{'':>4}  · {n}")
    if usable:
        print(f"\nnext: {usable[0]['next']}")
        print("house rule: one sync verify, then a 5-10 row pilot whose results --input exits 0, then Eddy's yes to this cost.")
        return 0
    print("\nno usable candidate", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
