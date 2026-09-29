#!/usr/bin/env bash
# The full-document check, in two stages.
#
# Stage 1 — fixture integrity. Every slice listed in
# parse_s1_mgmt_go/testdata/SOURCES.tsv is re-cut from its source filing and
# re-hashed. A fixture edited to make a test pass, or a fixture whose recorded
# byte range no longer matches the filing, fails here and the binary is never
# built.
#
# Stage 2 — known answers on the COMPLETE filings, not the excerpts: build the
# binary, run it over all seven, and compare the filings TSV's ceo_name and
# ceo_founder_self_described plus the must / must-not founder and VC sets in
# expected_full.tsv against the persons TSV. The trimmed fixtures cannot catch a
# regex that matches Google's appended roadshow transcript or the Playboy
# interview; this stage can.
#
# Non-zero exit on any mismatch in either stage.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GODIR="$HERE/parse_s1_mgmt_go"
SOURCES="$GODIR/testdata/SOURCES.tsv"
EXPECTED="$HERE/expected_full.tsv"
FILINGS_ROOT="${S1_FILINGS_ROOT:-/home/eh/.tmp/claude-1000/-home-eh-projects-workflows/23a5bbb6-49d5-4994-bda3-35993610e03a/scratchpad/s1-profile/filings}"

export PATH="$HOME/.local/share/mise/installs/go/1.27.1/bin:$PATH"

fail=0
note() { printf '%s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; fail=1; }

# --------------------------------------------------------------------------
# Stage 1: re-derive every fixture slice from its source filing
# --------------------------------------------------------------------------
note "== stage 1: fixture slice hashes =="
[ -r "$SOURCES" ] || { bad "missing $SOURCES"; exit 1; }

nslices=0
while IFS=$'\t' read -r fixture slice relpath start end length sha; do
    [ "$fixture" = "fixture" ] && continue
    [ -z "${fixture:-}" ] && continue
    src="$FILINGS_ROOT/$relpath"
    if [ ! -r "$src" ]; then
        bad "$fixture/$slice: source filing not readable: $src"
        continue
    fi
    got=$(tail -c "+$((start + 1))" "$src" | head -c "$length" | sha256sum | cut -d' ' -f1)
    if [ "$got" != "$sha" ]; then
        bad "$fixture/$slice: sha256 $got, expected $sha (bytes $start..$end of $relpath)"
        continue
    fi
    nslices=$((nslices + 1))
    note "  ok  $fixture/$slice  bytes $start..$end  $sha"
done < "$SOURCES"

# The fixture on disk must be exactly the concatenation of its recorded slices.
for fx in "$GODIR"/testdata/*.txt; do
    name=$(basename "$fx")
    tmp=$(mktemp)
    awk -F'\t' -v f="$name" 'NR>1 && $1==f {print $3"\t"$4"\t"$6}' "$SOURCES" |
        while IFS=$'\t' read -r relpath start length; do
            tail -c "+$((start + 1))" "$FILINGS_ROOT/$relpath" | head -c "$length"
        done > "$tmp"
    if ! cmp -s "$tmp" "$fx"; then
        bad "$name is not the concatenation of the slices SOURCES.tsv records for it"
    else
        note "  ok  $name == concat(slices)"
    fi
    rm -f "$tmp"
done

if [ "$fail" -ne 0 ]; then
    note "fixture integrity failed; not building the binary"
    exit 1
fi
note "stage 1 ok: $nslices slices verified"

# --------------------------------------------------------------------------
# Stage 2: run the binary over the seven complete filings
# --------------------------------------------------------------------------
note ""
note "== stage 2: known answers on the full filings =="

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

( cd "$GODIR" && go build -o "$work/parse_s1_mgmt" . ) || { note "build failed"; exit 1; }

list="$work/filelist.tsv"
: > "$list"
awk -F'\t' 'NR>1 {print $1}' "$EXPECTED" | while read -r acc; do
    rel=$(cd "$FILINGS_ROOT" && find . -name "$acc.txt" -type f | head -1 | sed 's|^\./||')
    if [ -z "$rel" ]; then
        printf 'FAIL full filing not found for %s under %s\n' "$acc" "$FILINGS_ROOT"
        continue
    fi
    cik=$(dirname "$rel" | xargs basename)
    printf '%s\t%s\t%s\t424B4\n' "$rel" "$cik" "$acc" >> "$list"
done
if [ "$(wc -l < "$list")" -ne 7 ]; then
    note "FAIL filelist has $(wc -l < "$list") rows, expected 7"
    exit 1
fi
note "filelist:"
sed 's/^/  /' "$list"

"$work/parse_s1_mgmt" \
    -files-from "$list" \
    -archive-root "$FILINGS_ROOT" \
    -out "$work/persons.tsv.gz" \
    -filings "$work/filings.tsv.gz" || { note "FAIL binary exited non-zero"; exit 1; }

gzip -dc "$work/persons.tsv.gz" > "$work/persons.tsv" || exit 1
gzip -dc "$work/filings.tsv.gz" > "$work/filings.tsv" || exit 1
note "persons rows: $(($(wc -l < "$work/persons.tsv") - 1))   filings rows: $(($(wc -l < "$work/filings.tsv") - 1))"
note ""

# field lookups over the two TSVs
filing_field() { # accession, 1-based column
    awk -F'\t' -v a="$1" -v c="$2" 'NR>1 && $1==a {print $c; exit}' "$work/filings.tsv"
}
person_field() { # accession, name, 1-based column
    awk -F'\t' -v a="$1" -v n="$2" -v c="$3" 'NR>1 && $1==a && $6==n {print $c; exit}' "$work/persons.tsv"
}
person_present() { # accession, name
    awk -F'\t' -v a="$1" -v n="$2" 'NR>1 && $1==a && $6==n {found=1} END {exit !found}' "$work/persons.tsv"
}

# A tab is IFS-whitespace, so `IFS=$'\t' read` collapses runs of tabs and an
# empty must-founder cell would silently shift every later column. Address the
# expected file by (row, column) instead.
exp_field() { awk -F'\t' -v r="$1" -v c="$2" 'NR==r {print $c}' "$EXPECTED"; }

nexp=$(awk 'END {print NR}' "$EXPECTED")
for row in $(seq 2 "$nexp"); do
    acc=$(exp_field "$row" 1)
    label=$(exp_field "$row" 2)
    ceo=$(exp_field "$row" 3)
    ceofnd=$(exp_field "$row" 4)
    mustf=$(exp_field "$row" 5)
    mustnotf=$(exp_field "$row" 6)
    mustvc=$(exp_field "$row" 7)
    mustnotvc=$(exp_field "$row" 8)
    [ -z "${acc:-}" ] && continue

    got_ceo=$(filing_field "$acc" 8)
    [ "$got_ceo" = "$ceo" ] || bad "$label ceo_name = '${got_ceo}', want '${ceo}'"

    got_fnd=$(filing_field "$acc" 9)
    [ "$got_fnd" = "$ceofnd" ] || bad "$label ceo_founder_self_described = '${got_fnd}', want '${ceofnd}'"

    IFS=';' read -r -a arr <<< "${mustf:-}"
    for n in "${arr[@]:-}"; do
        [ -z "$n" ] && continue
        v=$(person_field "$acc" "$n" 11)
        [ "$v" = "1" ] || bad "$label $n founder_self_described = '${v}', want 1"
    done

    # `want 0` has to mean "this person was extracted and the flag is off", not
    # "no such row". A missing row makes the founder column read empty, which is
    # not 0 but is also not the same failure, so it gets its own message: an
    # extractor that dropped the person entirely must fail here rather than look
    # like a correctly-negative flag.
    IFS=';' read -r -a arr <<< "${mustnotf:-}"
    for n in "${arr[@]:-}"; do
        [ -z "$n" ] && continue
        if ! person_present "$acc" "$n"; then
            bad "$label $n is absent from the persons TSV, so founder_self_described cannot be 0 for them"
            continue
        fi
        v=$(person_field "$acc" "$n" 11)
        [ "$v" = "0" ] || bad "$label $n founder_self_described = '${v}', want 0"
        pos=$(person_field "$acc" "$n" 8)
        [ -n "$pos" ] || bad "$label $n has an empty position cell: the row is not a parsed person"
    done

    IFS=';' read -r -a arr <<< "${mustvc:-}"
    for n in "${arr[@]:-}"; do
        [ -z "$n" ] && continue
        v=$(person_field "$acc" "$n" 13)
        [ "$v" = "1" ] || bad "$label $n vc_affiliated = '${v}', want 1"
    done

    IFS=';' read -r -a arr <<< "${mustnotvc:-}"
    for n in "${arr[@]:-}"; do
        [ -z "$n" ] && continue
        v=$(person_field "$acc" "$n" 13)
        [ "$v" = "0" ] || bad "$label $n vc_affiliated = '${v}', want 0"
    done

    [ "$fail" -eq 0 ] && note "  ok  $label"
done

note ""
if [ "$fail" -ne 0 ]; then
    note "check_full: FAILED"
    exit 1
fi
note "check_full: all seven filings match expected_full.tsv"
