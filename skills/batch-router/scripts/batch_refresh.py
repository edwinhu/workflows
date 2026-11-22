"""--refresh and --propose for route_batch.py: keep batch_models.json honest against live catalogs.

Mirrors scripts/lib/route.ts (docs/DESIGN-routing.md, "Refresh"): `refresh` is the only sanctioned
writer of `available`, `in`/`out`/`long` prices and `asOf`; it never touches `tier`, `provider`
or the set of models. `propose` is advisory and writes nothing.

Availability: Anthropic GET /v1/models, OpenAI GET /v1/models, Vertex models.list() (ADC, location
global), with the accounts batchlib already resolves. Prices: the providers' own pricing pages,
batch rows only. A price the page does not state, or that does not parse, is never guessed: the
numbers already in the table stay, and `price_unverified` records why. Network access is isolated in
`fetch_catalogs` / `fetch_pages` so tests substitute them.
"""

import html
import json
import os
import re
import urllib.request
from datetime import date
from pathlib import Path

import batchlib

PAGES = {
    "anthropic": "https://platform.claude.com/docs/en/about-claude/pricing.md",
    "openai": "https://developers.openai.com/api/docs/pricing.md",
    "gemini": "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
}
PRICE_FIELDS = ("in", "out", "long_over", "long")
MONTHS = {m: i for i, m in enumerate(
    "January February March April May June July August September October November December".split(), 1)}


def _get(url: str, headers: dict | None = None, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "batch-router/1", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - https URLs above
        return r.read()


# ── network: availability ────────────────────────────────────────────────────────────────────


def _anthropic_ids(key: str) -> set[str]:
    ids, after = set(), None
    while True:
        url = "https://api.anthropic.com/v1/models?limit=1000" + (f"&after_id={after}" if after else "")
        d = json.loads(_get(url, {"x-api-key": key, "anthropic-version": "2023-06-01"}))
        ids |= {m["id"] for m in d["data"]}
        if not d.get("has_more"):
            return ids
        after = d["last_id"]


def _openai_ids(key: str) -> set[str]:
    d = json.loads(_get("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"}))
    return {m["id"] for m in d["data"]}


def vertex_project(settings: dict) -> str | None:
    return (os.environ.get("GOOGLE_CLOUD_PROJECT") or settings.get("vertex_catalog_project")
            or settings.get("vertex_research_project"))


def _vertex_ids(project: str) -> set[str]:
    from google import genai  # lazy: only --refresh/--propose need the SDK (uv script dependency)

    client = genai.Client(vertexai=True, project=project, location="global")
    ids = set()
    for m in client.models.list():
        name = m.name or ""
        if name.startswith("publishers/google/models/"):
            ids.add(name.rsplit("/", 1)[1].split("@")[0])
    return ids


def fetch_catalogs() -> tuple[dict[str, set[str]], dict[str, str]]:
    """({provider: model ids}, {provider: why it could not be read}). Never raises on one provider."""
    accounts, settings = batchlib.load_accounts()
    got, errs = {}, {}
    for prov, fn in (("anthropic", _anthropic_ids), ("openai", _openai_ids)):
        try:
            got[prov] = fn(batchlib.resolve_key(batchlib.pick_account(accounts, prov, None), settings))
        except (SystemExit, Exception) as e:  # noqa: BLE001 - one dead provider must not stop the rest
            errs[prov] = str(e) or type(e).__name__
    proj = vertex_project(settings)
    try:
        if not proj:
            raise RuntimeError("no Vertex project: set GOOGLE_CLOUD_PROJECT or vertex_research_project")
        got["gemini"] = _vertex_ids(proj)
    except Exception as e:  # noqa: BLE001
        errs["gemini"] = f"{type(e).__name__}: {e}"
    return got, errs


def fetch_pages() -> tuple[dict[str, str], dict[str, str]]:
    """({provider: page text}, {provider: why it could not be read}); the Gemini page is HTML-flattened."""
    got, errs = {}, {}
    for prov, url in PAGES.items():
        try:
            text = _get(url).decode("utf-8", "replace")
            got[prov] = html_to_text(text) if prov == "gemini" else text
        except Exception as e:  # noqa: BLE001
            errs[prov] = f"{url}: {type(e).__name__}: {e}"
    return got, errs


# ── price parsing ────────────────────────────────────────────────────────────────────────────


def html_to_text(s: str) -> str:
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", s, flags=re.S)
    s = re.sub(r"</(tr|p|h\d|li|div)>", "\n", s)
    s = re.sub(r"</t[dh]>", " | ", s)
    t = html.unescape(re.sub(r"<[^>]+>", "", s))
    return re.sub(r"\n\s*\n+", "\n", t)


def _money(s: str) -> float | None:
    m = re.search(r"\$([\d,]*\.?\d+)", s)
    return float(m.group(1).replace(",", "")) if m else None


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def parse_anthropic(text: str) -> dict[str, dict]:
    """{normalised display name: {in, out[, long]}} from the '### Batch processing' table."""
    sec = text.split("### Batch processing", 1)[-1].split("\n#", 1)[0] if "### Batch processing" in text else ""
    out: dict[str, dict] = {}
    for line in sec.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 3 or not cells[0].startswith("Claude"):
            continue
        pin, pout = _money(cells[1]), _money(cells[2])
        if pin is None or pout is None:
            continue
        name = re.sub(r"\[[^\]]*\]\([^)]*\)", "", cells[0])  # drop markdown links
        paren = re.search(r"\(([^)]*)\)", name)
        entry = out.setdefault(norm(re.sub(r"\(.*", "", name)), {})
        if paren and "over" in paren.group(1) and "tokens" in paren.group(1):
            entry["long"] = (pin, pout)
        else:
            entry["in"], entry["out"] = pin, pout
    return out


def parse_openai(text: str) -> dict[str, dict]:
    """{model id: {in, out[, long]}} from the table after '### Batch pricing data' (short/long context)."""
    if "### Batch pricing data" not in text:
        return {}
    sec = text.split("### Batch pricing data", 1)[1]
    rows = []
    for line in sec.splitlines():
        if not line.strip() and rows:
            break
        if line.strip().startswith("|"):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    if len(rows) < 3 or "Short context input" not in rows[0]:
        return {}
    h = rows[0]
    i_in, i_out = h.index("Short context input"), h.index("Short context output")
    i_lin = h.index("Long context input") if "Long context input" in h else None
    i_lout = h.index("Long context output") if "Long context output" in h else None
    out = {}
    for r in rows[2:]:
        mid = r[0].split(" (")[0].strip()
        pin, pout = _money(r[i_in]), _money(r[i_out])
        if pin is None or pout is None:
            continue
        e = {"in": pin, "out": pout}
        if i_lin is not None:
            lin, lout = _money(r[i_lin]), _money(r[i_lout])
            if lin is not None and lout is not None:
                e["long"] = (lin, lout)
        out[mid] = e
    return out


def _date(s: str) -> date | None:
    m = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)"
                  r"\s+(\d{1,2}),\s*(\d{4})", s)
    return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2))) if m else None


def parse_gemini(text: str, today: date) -> dict[str, dict]:
    """{normalised model name: {in, out}} in force `today`, global region, from the BATCH tab.

    The pricing page lists each model once per tab (Standard, Priority, Batch), in that order, so
    the third table row for a name is its batch price. It is accepted only when it is below the
    first (standard) row; otherwise the model is left out and the caller records a null.
    Date-limited rows ("through <date>", "Starting <date>") are chosen by `today`.
    """
    lines = text.splitlines()
    heads = []  # (line index of Input row, name, valid_from, valid_to)
    for i, ln in enumerate(lines):
        if not re.match(r"\s*\|\s*Input", ln):
            continue
        j, region = i - 1, []
        while j >= 0 and lines[j].strip() and not lines[j].strip().startswith("|"):
            region.insert(0, lines[j].strip())
            j -= 1
        if not region:
            continue
        joined = " ".join(region)
        frm = to = None
        m = re.search(r"[Ss]tarting\s+([A-Za-z]+ \d+, \d{4})", joined)
        if m:
            frm = _date(m.group(1))
        m = re.search(r"through\s+([A-Za-z]+ \d+, \d{4})", joined)
        if m:
            to = _date(m.group(1))
        name = re.sub(r"\(?[Ss]tarting\s+[A-Za-z]+ \d+, \d{4}\)?|through\s+[A-Za-z]+ \d+, \d{4}", "", joined)
        name = name.split(",")[0].replace("*", "").strip()
        if name.startswith("Gemini"):
            heads.append((i, name, frm, to))
    seen: dict[tuple, list] = {}
    for k, (i, name, frm, to) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else min(len(lines), i + 40)
        blk = "\n".join(lines[i:end])
        pin = re.search(r"Global[\s|]*\$([\d.]+)", blk)
        po = re.search(r"Text output[^\n]*\n?[\s|]*Global[\s|]*\$([\d.]+)", blk)
        if pin and po:
            seen.setdefault((norm(name), frm, to), []).append((float(pin.group(1)), float(po.group(1))))
    out: dict[str, dict] = {}
    for (n, frm, to), tabs in seen.items():
        if (frm and today < frm) or (to and today > to):
            continue
        if len(tabs) < 3 or not (tabs[2][0] < tabs[0][0] and tabs[2][1] <= tabs[0][1]):
            continue
        out[n] = {"in": tabs[2][0], "out": tabs[2][1]}
    return out


def price_lookup(provider: str, text: str, today: date):
    """f(model id) -> {in, out[, long]} or None, for ids of `provider`, from that provider's page text."""
    if provider == "openai":
        t = parse_openai(text)
        return lambda mid: t.get(mid)
    t = parse_anthropic(text) if provider == "anthropic" else parse_gemini(text, today)
    return lambda mid: t.get(norm(mid))


# ── refresh ──────────────────────────────────────────────────────────────────────────────────


def refresh_table(data: dict, catalogs: dict, cat_errs: dict, pages: dict, page_errs: dict, today: date):
    """Apply live facts to `data` in place. Returns (diff lines, warnings). `tier` is never touched."""
    diff, warns = [], []
    iso = str(today)
    lookups = {p: price_lookup(p, t, today) for p, t in pages.items()}
    for prov in sorted({m["provider"] for m in data["models"].values()}):
        if prov in cat_errs:
            warns.append(f"{prov}: catalog unreachable ({cat_errs[prov]}); `available` left unchanged")
        if prov in page_errs:
            warns.append(f"{prov}: pricing page unreachable ({page_errs[prov]}); prices left unchanged")
    for mid, m in data["models"].items():
        prov, before = m["provider"], json.loads(json.dumps(m))
        answered = False
        if prov in catalogs:
            m["available"] = mid in catalogs[prov]
            answered = True
        if prov in lookups:
            answered = True
            p = lookups[prov](mid)
            need_long = "long" in m
            if p and "in" in p and (not need_long or "long" in p):
                for f in ("in", "out"):
                    m[f] = p[f]
                if need_long:
                    m["long"] = list(p["long"])
                m.pop("price_unverified", None)
            else:
                why = (f"{mid} has no parsable batch row on {PAGES[prov]}" if not p
                       else "page states no long-context batch price for it")
                m["price_unverified"] = f"{iso}: {why}; in/out are the last verified numbers, not re-confirmed"
        if answered:
            m["asOf"] = iso
        for f in sorted(set(before) | set(m)):
            if before.get(f) != m.get(f):
                diff.append(f"{mid}.{f}: {before.get(f)!r} -> {m.get(f)!r}")
    return diff, warns


def write_table(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n")
    tmp.replace(path)


def refresh_cli(path: Path, today: date) -> int:
    path = Path(path)
    try:
        data = json.loads(path.read_text())
        data["models"]
    except (OSError, ValueError, KeyError) as e:
        print(f"route_batch --refresh: cannot read {path}: {e}; nothing written")
        return 2
    catalogs, cat_errs = fetch_catalogs()
    pages, page_errs = fetch_pages()
    if not catalogs and not pages:
        print(f"route_batch --refresh: no provider answered; {path} left unchanged")
        return 2
    diff, warns = refresh_table(data, catalogs, cat_errs, pages, page_errs, today)
    for w in warns:
        print(f"warning: {w}")
    if not diff:
        print(f"no change in {path}")
        return 0
    write_table(path, data)
    print(f"wrote {path}:")
    for d in diff:
        print(f"  {d}")
    return 0


# ── propose ──────────────────────────────────────────────────────────────────────────────────

# Ids the batch router never routes text jobs to; dropped before grouping.
NOT_TEXT = re.compile(r"(tts|image|embed|whisper|transcribe|realtime|audio|moderation|search-api|live|"
                      r"imagen|banana|veo|lyria|computer-use|robotics|chat-latest|codex|diarize)")
DATED = re.compile(r"(-\d{4}-\d{2}-\d{2}|-\d{8}|-latest)$")
GEMINI_WORDS = {"flash", "pro", "lite", "ultra", "nano"}


def split_id(mid: str) -> tuple[str, tuple]:
    """(family key, version tuple): all-digit tokens form the version, the other tokens the family."""
    toks = [t for t in re.split(r"[-_]", mid) if t]
    ver, fam = [], []
    for t in toks:
        if re.fullmatch(r"\d+(\.\d+)*", t):
            ver += [int(x) for x in t.split(".")]
        else:
            fam.append(t)
    return " ".join(fam), tuple(ver)


def is_codename(mid: str) -> bool:
    """A Gemini id whose name part is not a known tier word (gemini-4-neon): no published tier."""
    return mid.startswith("gemini") and not (set(split_id(mid)[0].split()) & GEMINI_WORDS)


def family_key(mid: str, provider: str) -> str:
    fam, _ = split_id(mid)
    if provider == "gemini":
        return "gemini codename" if is_codename(mid) else fam
    return fam


def _fmt_price(p) -> str:
    if not p:
        return "price not found on the provider's page"
    s = f"batch ${p['in']:g} in / ${p['out']:g} out per MTok"
    return s + (f" (>long ctx ${p['long'][0]:g}/${p['long'][1]:g})" if p.get("long") else "")


def propose(data: dict, catalogs: dict, cat_errs: dict, pages: dict, today: date) -> dict:
    """Advisory report: served-but-unlisted models by provider/family, and a newer candidate per tier."""
    models = data["models"]
    listed = set(models)
    lookups = {p: price_lookup(p, t, today) for p, t in pages.items()}
    report = {"asOf": str(today), "unreachable": dict(cat_errs), "families": [], "tiers": []}
    unlisted: dict[str, dict[str, list[str]]] = {}
    for prov, ids in catalogs.items():
        for mid in sorted(ids - listed):
            if NOT_TEXT.search(mid) or DATED.search(mid):
                continue
            if prov == "gemini" and not mid.startswith("gemini"):
                continue
            unlisted.setdefault(prov, {}).setdefault(family_key(mid, prov), []).append(mid)
    for prov, fams in sorted(unlisted.items()):
        for fam, ids in sorted(fams.items()):
            ids.sort(key=lambda i: split_id(i)[1], reverse=True)
            report["families"].append({
                "provider": prov, "family": fam,
                "models": [{"id": i, "price": (lookups.get(prov) or (lambda _: None))(i),
                            "tier_published": not (prov == "gemini" and is_codename(i))} for i in ids]})
    for mid, m in models.items():
        prov = m["provider"]
        if prov not in catalogs:
            continue
        fam, ver = split_id(mid)
        cands = []
        for i in sorted(catalogs[prov] - listed):
            if NOT_TEXT.search(i) or DATED.search(i) or (prov == "gemini" and not i.startswith("gemini")):
                continue
            cfam, cver = split_id(i)
            same = (cfam == fam or is_codename(i)) if prov == "gemini" else family_key(i, prov) == family_key(mid, prov)
            if same and cver > ver:
                cands.append(i)
        cands.sort(key=lambda i: split_id(i)[1], reverse=True)
        if cands:
            look = lookups.get(prov) or (lambda _: None)
            report["tiers"].append({
                "tier": m["tier"], "provider": prov, "current": mid,
                "current_price": {"in": m["in"], "out": m["out"]},
                "candidates": [{"id": i, "price": look(i), "codename_no_published_tier": prov == "gemini" and is_codename(i)}
                               for i in cands]})
    return report


def render_proposal(rep: dict) -> str:
    out = [f"route_batch --propose ({rep['asOf']}): advisory, nothing written"]
    for p, why in rep["unreachable"].items():
        out.append(f"! {p}: catalog unreachable ({why}); nothing proposed for it")
    out.append("\nServed by the providers but not in batch_models.json, by family:")
    if not rep["families"]:
        out.append("  (none)")
    for f in rep["families"]:
        out.append(f"  [{f['provider']}] {f['family']}")
        for m in f["models"]:
            note = "" if m["tier_published"] else "  <- codename: no published tier; a human must assign one"
            out.append(f"    {m['id']}: {_fmt_price(m['price'])}{note}")
    out.append("\nNewer same-family candidates per tier (current -> candidate):")
    if not rep["tiers"]:
        out.append("  (none)")
    for t in rep["tiers"]:
        cp = t["current_price"]
        out.append(f"  {t['tier']:<8} [{t['provider']}] {t['current']} (batch ${cp['in']:g}/${cp['out']:g})")
        for c in t["candidates"]:
            note = ("; codename with no published tier, so whether it replaces this tier is a human decision"
                    if c["codename_no_published_tier"] else "")
            out.append(f"           -> {c['id']}: {_fmt_price(c['price'])}{note}")
    out.append("\nTo adopt one: add it to batch_models.json with its tier by hand, then run --refresh to fill "
               "availability and price. --propose never edits the table.")
    return "\n".join(out)


def propose_cli(path: Path, today: date, as_json: bool) -> int:
    try:
        data = json.loads(Path(path).read_text())
        data["models"]
    except (OSError, ValueError, KeyError) as e:
        print(f"route_batch --propose: cannot read {path}: {e}")
        return 2
    catalogs, cat_errs = fetch_catalogs()
    pages, _ = fetch_pages()
    rep = propose(data, catalogs, cat_errs, pages, today)
    print(json.dumps(rep, indent=2, default=str) if as_json else render_proposal(rep))
    return 0
