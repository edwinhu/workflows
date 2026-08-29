#!/usr/bin/env python3
"""Adjudicate accepted name matches with an LLM and drop the wrong ones.

WHY THIS IS PART OF THE PROCEDURE, NOT A SIDE CHECK

Cosine similarity cannot distinguish a fund from its sibling. Measured
2026-08-28 by judging ALL 18,975 accepted pairs:

    score band     judged same
      0.70-0.75        47.0%
      0.75-0.85        58.3%
      0.85-0.95        74.3%
      0.95-1.00        93.3%
      1.00             99.8%

    overall, by vote rows: 94.91% correct

The errors are same-family, different-portfolio, and they sit at HIGH scores:
`Royce Value Trust` vs `Royce Value Fund` (closed-end vs open-end) at 0.95,
`PROSHARES ULTRA RUSSELL 3000` vs `Ultra Russell 2000 ProShares` at 0.84,
`TIAA-CREF SMALL-CAP GROWTH INDEX` vs `TIAA-CREF Large-Cap Growth Index` at
0.73. No threshold separates them, so no amount of matcher tuning removes them.

Running this takes the panel from 98.84% linked to 97.16% linked-AND-CHECKED,
which is a materially better dataset than the larger number.

A NOTE ON THE PER-BAND FIGURES. A negative control -- hiding the seriesid of
funds ISS did tag and re-matching them -- put the same bands 20 points higher
(68.9% where this says 47.0%). The control is systematically easier: those funds
are modern, well-formed, and 69% match exactly. Trust the judged numbers for the
untagged population; the control flatters it.

COST: $1.55 for 18,975 pairs on gemini-3.5-flash-lite batch (6.74M input +
0.43M output tokens). Judging everything is cheaper than reasoning about a
sample.

Usage:
    python judge_matches.py build   pairs.csv out_dir/    # write request JSONL
    python judge_matches.py submit  out_dir/              # upload + create jobs
    python judge_matches.py collect out_dir/ pairs.csv    # verdicts + rejects
"""

from __future__ import annotations

import csv
import json
import pathlib
import sys
from collections import defaultdict

MODEL = "gemini-3.5-flash-lite"

#: thinking_level MINIMAL is load-bearing: Gemini 3.x defaults to HIGH, and an
#: unpinned batch returns empty content on MAX_TOKENS with no useful error.
#: Measured: 0 truncated responses over 18,975 requests, 0 thinking tokens.
GENERATION_CONFIG = {
    "temperature": 0,
    "response_mime_type": "application/json",
    "thinking_config": {"thinking_level": "MINIMAL"},
}

#: The prompt must make "different" an easy answer. Asked "do these match?", a
#: model finds a way to say yes -- every pair here is a fund name sharing heavy
#: industry boilerplate. The negative examples are the four errors a human found
#: by eye in the 0.68-0.93 range; the judge reproduced all four (8/8 on a mixed
#: gate set) before any batch was submitted.
PROMPT = """You compare two US mutual fund names and decide whether they name \
THE SAME FUND (the same portfolio / series), or two DIFFERENT funds.

Fund families reuse their brand across dozens of distinct portfolios, so a \
shared manager name is NOT evidence of a match. Judge the PORTFOLIO.

Different funds, even though the names look similar:
  - a numbered or lettered sibling: "Convertible & Income Fund II" vs "Convertible Fund"
  - a different asset class: "Total Return Strategy" (equity) vs "Total Return Bond"
  - a different mandate: "Global Utility Income" vs "Real Estate Income"
  - a different cap or style: "Small-Cap Value" vs "All Cap"

The same fund, despite differing text:
  - a rename: "Dreyfus Municipal Bond Fund" vs "BNY Mellon Municipal Bond Fund"
  - a sub-adviser or share class appended: "Core Fund - SUB-ADVISER: X" vs "Core Fund"
  - an internal code prefixed: "6721 500 Index B" vs "500 Index Fund"
  - the registrant's name prefixed: "Equity Income Portfolio" vs \
"Northwestern Mutual Series Fund Equity Income Portfolio"

Reply with ONLY a JSON object:
{"verdict": "same" | "different" | "uncertain", "why": "<12 words or fewer>"}

Fund A (from a proxy-voting record): <<A>>
Fund A's manager: <<MGR>>
Fund B (from the SEC series register): <<B>>"""

CHUNK = 9500  # a single JSONL is capped at 10,000 requests


def build(pairs_csv: str, out_dir: str) -> None:
    rows = list(csv.DictReader(open(pairs_csv)))  # noqa: SIM115
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for start in range(0, len(rows), CHUNK):
        part = rows[start:start + CHUNK]
        p = out / f"requests_{start // CHUNK:02d}.jsonl"
        with p.open("w") as fh:
            for r in part:
                # The SCORE IS DELIBERATELY WITHHELD. Telling the judge the
                # matcher already accepted this invites agreement, which is the
                # one thing that would make the verdicts worthless.
                body = (PROMPT.replace("<<A>>", r["iss_fundname"])
                              .replace("<<MGR>>", r["iss_institution"])
                              .replace("<<B>>", r["sec_name"]))
                fh.write(json.dumps({
                    # keyed by fundid: batch output order is NOT guaranteed
                    "key": r["fundid"],
                    "request": {
                        "contents": [{"parts": [{"text": body}], "role": "user"}],
                        "generation_config": GENERATION_CONFIG,
                    },
                }) + "\n")
        print(f"{p}: {len(part):,} requests")


def submit(out_dir: str) -> None:
    from google import genai

    client = genai.Client()
    jobs = {}
    for p in sorted(pathlib.Path(out_dir).glob("requests_*.jsonl")):
        up = client.files.upload(file=str(p),
                                 config={"mime_type": "application/jsonl"})
        job = client.batches.create(
            model=MODEL, src=up.name,
            config={"display_name": f"npx-match-judge-{p.stem}"})
        jobs[p.name] = job.name
        print(f"{p.name} -> {job.name} [{job.state}]")
    (pathlib.Path(out_dir) / "jobs.json").write_text(json.dumps(jobs, indent=2))


def collect(out_dir: str, pairs_csv: str) -> None:
    from google import genai

    client = genai.Client()
    jobs = json.loads((pathlib.Path(out_dir) / "jobs.json").read_text())
    verdicts, bad = {}, 0
    for name in jobs.values():
        job = client.batches.get(name=name)
        dest = getattr(job.dest, "file_name", None)
        if not dest:
            print(f"{name}: no output ({job.state})")
            continue
        for line in client.files.download(file=dest).decode("utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            try:
                # a batch response is raw JSON, not a hydrated class -- .text
                # is undefined, so read the parts directly
                txt = row["response"]["candidates"][0]["content"]["parts"][0]["text"]
                verdicts[row["key"]] = json.loads(txt)["verdict"].strip().lower()
            except (KeyError, IndexError, TypeError, json.JSONDecodeError):
                bad += 1

    pairs = {r["fundid"]: r for r in csv.DictReader(open(pairs_csv))}  # noqa: SIM115
    agg = defaultdict(lambda: [0, 0])
    for k, v in verdicts.items():
        if k in pairs:
            agg[v][0] += 1
            agg[v][1] += int(pairs[k]["vote_rows"])
    tot = sum(a[1] for a in agg.values())
    print(f"verdicts {len(verdicts):,}  unparseable {bad:,}")
    for v, (n, r) in sorted(agg.items(), key=lambda x: -x[1][1]):
        print(f"  {v:<11}{n:>8,} fundids{r:>14,} rows{100*r/tot:>7.1f}%")

    rej = pathlib.Path(out_dir) / "rejected.csv"
    with rej.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["fundid", "iss_fundname", "sec_name", "score", "vote_rows"])
        for k, v in verdicts.items():
            if v == "different" and k in pairs:
                r = pairs[k]
                w.writerow([k, r["iss_fundname"], r["sec_name"], r["score"],
                            r["vote_rows"]])
    print(f"wrote {rej} -- DROP these links from the crosswalk")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd == "build":
        build(sys.argv[2], sys.argv[3])
    elif cmd == "submit":
        submit(sys.argv[2])
    elif cmd == "collect":
        collect(sys.argv[2], sys.argv[3])
    else:
        sys.exit(f"unknown command {cmd!r}")
