#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""perma.cc archiving that bills the sponsored quota instead of the personal one.

    permacc.py folders                      # which folder is sponsored, and by whom
    permacc.py archive URL [URL ...] --folder 376861
    permacc.py archive --from-json inv.json --folder 376861
    permacc.py status                       # who the key belongs to

WHY THIS EXISTS RATHER THAN `requests.post(...)` INLINE

Two facts about the API are invisible from its responses, and getting either
wrong produces the SAME error -- HTTP 400 "You've reached your usage limit" --
which reads as "your account is too small" no matter which one is actually
wrong. Both were found by bisecting a live 400 against a sponsored account.

  1. `folder` must be sent in the JSON BODY. As a query parameter
     (`?folder=123`) perma accepts the request, silently ignores the folder,
     bills the PERSONAL quota, and 400s once that quota is gone. Verified
     side by side against one URL: query param -> 400, body field -> 201.

  2. Registrar sponsorship hangs off the FOLDER, not the organization.
     `GET /v1/organizations/` reported `registrar: None` for an account that
     was already sponsored; the affiliation was on a folder in `GET /v1/user/`
     carrying `registrar: 16`. Diagnosing a cap from the organizations
     endpoint therefore concludes "not sponsored" about an account that is.

Send an archive with no folder and it lands in the personal root, capped at
10 links/month on the free tier -- so a script that "works" for the first ten
links of a cite-check and dies on the eleventh is the default behavior.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

API = "https://api.perma.cc/v1"


def _headers(key: str) -> dict[str, str]:
    # Perma uses its own scheme, NOT Bearer. A Bearer header authenticates as
    # anonymous and fails later with a permission error rather than a 401.
    return {"Authorization": f"ApiKey {key}"}


def read_key(arg: str | None) -> str:
    """--api-key, then PERMACC_API_KEY, then PERMACC_API_KEY_FILE.

    The *_FILE indirection is the agenix convention: the environment carries a
    path to the decrypted secret, not the secret. Accepting only the value
    would make every caller write `$(cat $PERMACC_API_KEY_FILE)` and get it
    wrong in a non-login shell where neither is set.
    """
    import os

    if arg:
        return arg.strip()
    if v := os.environ.get("PERMACC_API_KEY"):
        return v.strip()
    if (p := os.environ.get("PERMACC_API_KEY_FILE")) and Path(p).exists():
        return Path(p).read_text().strip()
    sys.exit("error: no key — pass --api-key, or set PERMACC_API_KEY[_FILE]")


def folders(key: str) -> list[dict]:
    r = requests.get(f"{API}/user/", headers=_headers(key), timeout=30)
    r.raise_for_status()
    # The key is `top_level_folders`, not `folders`; a wrong guess here
    # returns [] and reports a sponsored account as unsponsored.
    return r.json().get("top_level_folders", [])


def sponsored_folder(key: str) -> int | None:
    """The first folder carrying a registrar, or None.

    This is the lookup `GET /v1/organizations/` cannot answer — see the module
    docstring. Returning None means genuinely unsponsored, not "unknown".
    """
    for f in folders(key):
        if f.get("registrar"):
            return f["id"]
    return None


def archive(url: str, key: str, folder: int | None, timeout: int = 120) -> dict:
    """Create one archive. `folder` goes in the BODY; see the module docstring."""
    payload: dict[str, object] = {"url": url}
    if folder:
        payload["folder"] = int(folder)
    r = requests.post(f"{API}/archives/", json=payload,
                      headers=_headers(key), timeout=timeout)
    if r.status_code == 201:
        return r.json()
    detail = r.text[:300]
    if r.status_code == 400 and "usage limit" in detail:
        detail += ("\n    NOTE: this is also what a folder sent as a QUERY PARAM "
                   "looks like, and what an unsponsored folder looks like. "
                   "Run `permacc.py folders` and pass --folder <sponsored id>.")
    raise RuntimeError(f"HTTP {r.status_code}: {detail}")


def capture_status(guid: str, key: str, tries: int = 6, delay: float = 5.0) -> str:
    """'success', 'failed', or 'pending' for the PRIMARY capture.

    201 means perma MINTED A LINK, not that it fetched the page. The two come
    apart on any site that blocks crawlers: SSRN sits behind Cloudflare, so
    every SSRN archive returns 201 and then captures the challenge page --
    `primary: failed`, title `ssrn.com` instead of a paper title. Six such
    links were recorded as archived in a law review manuscript before anyone
    opened one.

    Capture is asynchronous, so the status right after 201 is `pending` and a
    single check would call a good archive bad. Poll instead.
    """
    for i in range(tries):
        r = requests.get(f"{API}/archives/{guid}/", headers=_headers(key), timeout=30)
        if r.ok:
            prim = [c for c in r.json().get("captures", [])
                    if c.get("role") == "primary"]
            st = prim[0].get("status") if prim else "pending"
            if st in ("success", "failed"):
                return st
        if i < tries - 1:
            time.sleep(delay)
    return "pending"


def delete(guid: str, key: str) -> tuple[bool, int]:
    r = requests.delete(f"{API}/archives/{guid}/", headers=_headers(key), timeout=30)
    return r.status_code == 204, r.status_code


def make_private(guid: str, key: str) -> bool:
    """Perma's remedy for a link too old to delete.

    `private_reason` is a closed enum the API will not enumerate -- a wrong
    value 400s with a message that lists nothing usable. `user` is the one
    that applies to "I no longer want this link public".
    """
    r = requests.patch(f"{API}/archives/{guid}/", headers=_headers(key), timeout=30,
                       json={"is_private": True, "private_reason": "user"})
    return r.status_code == 200


def do_delete(args, key: str) -> int:
    """Delete links, falling back to private for the ones perma will not delete.

    A perma link is deletable for 24 HOURS after creation and permanent after
    that -- which is the point of the service, not a bug. So a cleanup that
    assumes DELETE works will half-succeed on any set spanning more than a
    day, exactly the shape of a manuscript's archive set.
    """
    targets: list[tuple[str, str]] = [(g, g) for g in args.urls]
    rec: dict[str, dict] = {}
    if args.out and args.out.exists():
        rec = json.loads(args.out.read_text())
        if args.failed:
            targets += [(r["guid"], u) for u, r in rec.items()
                        if r.get("capture") not in (None, "success")]
    if not targets:
        sys.exit("error: nothing to delete — pass GUIDs, or --out FILE --failed")

    if args.dry_run:
        for g, u in targets:
            print(f"  would delete {g}  {u[:70]}")
        return 0

    removed, made_private, stuck = [], [], []
    for g, u in targets:
        ok, code = delete(g, key)
        if ok:
            removed.append(g)
            print(f"  {g}  deleted")
        elif code == 403 and args.private_if_undeletable:
            if make_private(g, key):
                made_private.append(g)
                print(f"  {g}  older than 24h — made PRIVATE instead")
            else:
                stuck.append(g)
                print(f"  {g}  403 and could not be made private", file=sys.stderr)
        else:
            stuck.append(g)
            print(f"  {g}  HTTP {code}"
                  + (" (older than 24h; --private-if-undeletable is the remedy)"
                     if code == 403 else ""), file=sys.stderr)

    if rec and args.out:
        # Drop only what is actually gone. A private link still exists and is
        # still the wrong thing to cite, so it stays in the record, flagged.
        for u, r in list(rec.items()):
            if r["guid"] in removed:
                del rec[u]
            elif r["guid"] in made_private:
                r["private"] = True
        args.out.write_text(json.dumps(rec, indent=2))

    print(f"\n{len(removed)} deleted, {len(made_private)} made private, "
          f"{len(stuck)} untouched")
    return 1 if stuck else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command",
                    choices=("folders", "archive", "status", "verify", "delete"))
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--api-key")
    ap.add_argument("--folder", help="sponsored folder id; `folders` finds it")
    ap.add_argument("--auto-folder", action="store_true",
                    help="use the first sponsored folder found")
    ap.add_argument("--from-json", type=Path,
                    help='{"url_inventory":[{"url":...,"fn_id":...}]} or a bare list')
    ap.add_argument("--out", type=Path, help="merge results into this JSON map")
    ap.add_argument("--delay", type=float, default=3.0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-verify", action="store_true",
                    help="skip the capture check (a 201 alone proves nothing)")
    ap.add_argument("--failed", action="store_true",
                    help="delete: target every entry in --out whose capture failed")
    ap.add_argument("--private-if-undeletable", action="store_true",
                    help="delete: on 403 (older than 24h), make the link private instead")
    args = ap.parse_args()

    key = read_key(args.api_key)

    if args.command == "status":
        r = requests.get(f"{API}/user/", headers=_headers(key), timeout=30)
        r.raise_for_status()
        d = r.json()
        print(d.get('full_name', '?'))
        f = sponsored_folder(key)
        print(f"sponsored folder: {f}" if f else
              "sponsored folder: NONE — archives will bill the personal quota "
              "(10/month on the free tier)")
        return 0

    if args.command == "folders":
        for f in folders(key):
            mark = "SPONSORED" if f.get("registrar") else "personal "
            reg = f.get("registrar_name") or ""
            print(f"  [{mark}] id={f['id']:<8} {f.get('name', '')!r} {reg}")
        if not sponsored_folder(key):
            print("\nNo sponsored folder. A registrar (e.g. a law library) must add "
                  "this account;\nuntil then every archive bills the personal quota.")
        return 0

    if args.command == "delete":
        return do_delete(args, key)

    if args.command == "verify":
        # Re-check an existing record. A capture can also be checked long after
        # the fact, which is how the six dead SSRN links were finally noticed.
        if not args.out or not args.out.exists():
            sys.exit("error: verify needs --out <archives.json>")
        rec = json.loads(args.out.read_text())
        bad = 0
        for u, r in rec.items():
            st = capture_status(r["guid"], key, tries=1)
            r["capture"] = st
            if st != "success":
                bad += 1
                print(f"  {st.upper():8s} {r['guid']}  {u[:66]}")
        args.out.write_text(json.dumps(rec, indent=2))
        print(f"\n{len(rec) - bad} captured, {bad} not")
        return 1 if bad else 0

    urls: list[str] = list(args.urls)
    meta: dict[str, dict] = {}
    if args.from_json:
        data = json.loads(args.from_json.read_text())
        items = data.get("url_inventory", data) if isinstance(data, dict) else data
        for it in items:
            u = it["url"] if isinstance(it, dict) else it
            urls.append(u)
            if isinstance(it, dict):
                meta[u] = {k: v for k, v in it.items() if k != "url"}

    seen: set[str] = set()
    urls = [u for u in urls if not (u in seen or seen.add(u))]
    if not urls:
        sys.exit("error: no URLs — pass them positionally or with --from-json")

    done: dict[str, dict] = {}
    if args.out and args.out.exists():
        done = json.loads(args.out.read_text())
    pending = [u for u in urls if u not in done]
    print(f"{len(urls)} URLs, {len(urls) - len(pending)} already archived, "
          f"{len(pending)} to do")

    folder = args.folder
    if args.auto_folder and not folder:
        folder = sponsored_folder(key)
        print(f"auto-folder: {folder}" if folder else
              "auto-folder: none found — this will bill the personal quota")
    if not folder:
        print("WARNING: no --folder; archives bill the PERSONAL quota", file=sys.stderr)

    if args.dry_run:
        for u in pending:
            print(f"  would archive: {u}")
        return 0

    failed = 0
    for i, u in enumerate(pending, 1):
        print(f"  [{i}/{len(pending)}] {u[:88]}")
        try:
            d = archive(u, key, folder)
        except RuntimeError as exc:
            print(f"    ERROR {exc}", file=sys.stderr)
            failed += 1
            continue
        guid = d.get("guid")
        rec = {**meta.get(u, {}), "guid": guid,
               "perma_url": f"https://perma.cc/{guid}"}
        if args.no_verify:
            print(f"    -> https://perma.cc/{guid}")
        else:
            st = capture_status(guid, key)
            rec["capture"] = st
            if st == "success":
                print(f"    -> https://perma.cc/{guid}")
            else:
                failed += 1
                print(f"    -> https://perma.cc/{guid}  CAPTURE {st.upper()} — "
                      f"the link exists but the page was not fetched; "
                      f"cite the live URL instead", file=sys.stderr)
        done[u] = rec
        if args.out:
            args.out.write_text(json.dumps(done, indent=2))
        if i < len(pending):
            time.sleep(args.delay)

    print(f"\n{len(pending) - failed}/{len(pending)} archived and captured"
          + (f", {failed} failed" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
