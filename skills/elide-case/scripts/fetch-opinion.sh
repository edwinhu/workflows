#!/usr/bin/env bash
# Retrieve an authentic opinion from CourtListener and save both .pdf and .txt.
#
#   fetch-opinion.sh --docket 1:20-cv-10832 --court nysd --entry 874 --out docs/SEC-v-Ripple-874-opinion
#   fetch-opinion.sh --citation "87 F.3d 536" --out docs/SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996
#
# --citation tries the opinions corpus (type=o). A 404 or empty result there
# means "not in the opinion corpus", not "case does not exist" — rerun with the
# --docket/--entry RECAP route. Fails non-zero with a named reason rather than
# leaving an empty file behind.

set -euo pipefail

UA="workflows:elide-case (LAW8016 Securities Regulation course reader; eh@law.virginia.edu)"
API="https://www.courtlistener.com/api/rest/v4"
BUCKET="https://storage.courtlistener.com"

DOCKET="" COURT="" ENTRY="" CITATION="" OUT=""

die() { echo "FAIL: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docket)   DOCKET="$2"; shift 2 ;;
    --court)    COURT="$2"; shift 2 ;;
    --entry)    ENTRY="$2"; shift 2 ;;
    --citation) CITATION="$2"; shift 2 ;;
    --out)      OUT="$2"; shift 2 ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
    *)          die "unknown argument: $1" ;;
  esac
done

[[ -n "$OUT" ]] || die "--out <path-without-extension> is required"
command -v jq >/dev/null        || die "jq is not installed"
command -v pdftotext >/dev/null || die "pdftotext is not installed (poppler-utils)"

OUT="${OUT%.pdf}"; OUT="${OUT%.txt}"
mkdir -p "$(dirname "$OUT")"
PDF="${OUT}.pdf" TXT="${OUT}.txt"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

AUTH=()
[[ -n "${COURTLISTENER_TOKEN:-}" ]] && AUTH=(-H "Authorization: Token ${COURTLISTENER_TOKEN}")

get() { curl -sSL --fail-with-body -A "$UA" "${AUTH[@]}" "$1"; }

urlenc() { jq -rn --arg s "$1" '$s|@uri'; }

fetched=""

# ---- Route 1: opinions corpus -------------------------------------------------
if [[ -n "$CITATION" ]]; then
  echo "Trying the opinions corpus (type=o) for citation: $CITATION"
  q=$(urlenc "\"$CITATION\"")
  if ! get "${API}/search/?type=o&q=${q}" > "$TMP/o.json" 2>"$TMP/o.err"; then
    echo "  opinions-corpus search failed: $(tr -d '\n' < "$TMP/o.err")"
  fi
  # The search endpoint returns fuzzy hits, so a result is only OUR case if the
  # cite we asked for is in that result's own citation list. Without this check
  # a search for "682 F. Supp. 3d 308" returns Coinbase v. SEC and looks like a
  # hit — retrieving the wrong opinion is worse than retrieving none.
  idx=$(jq -r --arg c "$CITATION" \
    '[.results[]? | .citation // [] | index($c)] | map(. != null) | index(true) // empty' \
    "$TMP/o.json" 2>/dev/null || true)
  if [[ -n "$idx" ]]; then
    abs=$(jq -r ".results[$idx].absolute_url" "$TMP/o.json")
    oid=$(jq -r ".results[$idx].opinions[0].id // empty" "$TMP/o.json")
    echo "  cite-verified hit: https://www.courtlistener.com${abs} (opinion id ${oid})"
    if [[ -n "$oid" ]] && get "${API}/opinions/${oid}/" > "$TMP/op.json" 2>/dev/null; then
      jq -r '.plain_text // .html_with_citations // .html // ""' "$TMP/op.json" \
        | sed -e 's/<[^>]*>//g' > "$TXT"
      dl=$(jq -r '.download_url // empty' "$TMP/op.json")
      [[ -n "$dl" ]] && get "$dl" > "$PDF" 2>/dev/null || true
      [[ -s "$TXT" ]] && fetched="opinions-corpus"
    fi
    if [[ -z "$fetched" ]]; then
      rm -f "$TXT" "$PDF"
      echo "  the opinion exists in the corpus but /opinions/${oid}/ returned no text."
      echo "  That endpoint is TOKEN-GATED: unauthenticated it answers 401"
      echo "  {\"detail\":\"Authentication credentials were not provided.\"}, and the"
      echo "  result's download_url points at bulk.resource.org, which no longer"
      echo "  resolves. Set COURTLISTENER_TOKEN, or use the RECAP route."
    fi
  else
    echo "  NOT IN THE OPINIONS CORPUS under this citation (no result carries it)."
    echo "  This does NOT mean the case does not exist — re-run with"
    echo "  --docket/--court/--entry for the RECAP route."
  fi
fi

# ---- Route 2: RECAP docket entry ---------------------------------------------
if [[ -z "$fetched" && -n "$DOCKET" && -n "$ENTRY" ]]; then
  echo "Trying RECAP (type=r) for docket ${DOCKET} entry ${ENTRY}"
  q=$(urlenc "docketNumber:\"${DOCKET}\" AND entry_number:${ENTRY}")
  get "${API}/search/?type=r&q=${q}" > "$TMP/r.json" \
    || die "RECAP search request failed for docket ${DOCKET} entry ${ENTRY}"
  fp=$(jq -r '[.results[]?.recap_documents[]?.filepath_local] | map(select(. != null and . != "")) | .[0] // empty' "$TMP/r.json")
  [[ -n "$fp" ]] || die "RECAP search returned no recap_documents with a filepath_local for docket ${DOCKET} entry ${ENTRY} (count=$(jq -r '.count // 0' "$TMP/r.json"))"
  echo "  filepath_local: $fp"
  get "${BUCKET}/${fp}" > "$PDF" || die "storage bucket fetch failed for ${BUCKET}/${fp}"
  [[ -s "$PDF" ]] || die "storage bucket returned an empty PDF for ${fp}"
  pdftotext -layout "$PDF" "$TXT" || die "pdftotext failed on $PDF"
  fetched="recap"
fi

[[ -n "$fetched" ]] || die "no route succeeded — pass --citation, or --docket/--court/--entry for the RECAP route"

# ---- Non-empty gate -----------------------------------------------------------
for f in "$TXT" "$PDF"; do
  if [[ ! -s "$f" ]]; then
    rm -f "$f"
    die "route '$fetched' produced an empty or missing $f — refusing to leave a stub on disk"
  fi
done

echo "OK  route=$fetched"
echo "OK  $PDF  ($(stat -c%s "$PDF") bytes)"
echo "OK  $TXT  ($(wc -l < "$TXT") lines, $(stat -c%s "$TXT") bytes)"
echo "--- first 3 lines of $TXT ---"
head -3 "$TXT"
