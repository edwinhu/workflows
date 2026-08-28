#!/usr/bin/env bash
# Single mechanical entry point for this run: the converter's suite, plus the
# specific documentation claims the run exists to correct. One exit code.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
WRDS=../..
EDGAR="$WRDS/references/edgar.md"
SKILL="$WRDS/SKILL.md"
fail=0

echo "== py_compile =="
uv run --quiet python -m py_compile parsers.py edgar_parquet.py cli.py test_edgar_parquet.py || fail=1

echo "== stub retired =="
if grep -q 'NotImplementedError("stub' edgar_parquet.py 2>/dev/null; then
	echo "stub placeholders still present in edgar_parquet.py"; fail=1
else
	echo "none"
fi

echo "== doc: false claims removed =="
# edgar.md:940 asserted this; parse_13f and parse_npx are both standalone binaries.
if grep -qF 'Everything is a profile now.' "$EDGAR"; then
	echo "edgar.md still claims 'Everything is a profile now.'"; fail=1
fi
# edgar.md:891 described a stdin-driven parser; both record-table parsers use -files-from.
if grep -qF 'reads TSV from stdin' "$EDGAR"; then
	echo "edgar.md still says the parser reads TSV from stdin"; fail=1
fi
[ $fail -eq 0 ] && echo "clean"

echo "== doc: the two sanctioned binaries are documented =="
for pat in parse_13f parse_npx edgar_parquet; do
	grep -qF "$pat" "$EDGAR" || { echo "edgar.md never mentions $pat"; fail=1; }
done
grep -qF 'edgar_parquet' "$SKILL" || { echo "SKILL.md has no pointer to edgar_parquet"; fail=1; }

echo "== doc: mechanism claims name both mechanisms =="
# parse_13f defaults to a hand-rolled scanner (-fast-xml=true, main.go:208); parse_npx uses
# xml.Decoder. Naming one mechanism and attributing it to both is the false claim this run
# already made once, and it put SKILL.md in contradiction with references/edgar.md.
for f in "$SKILL" "$EDGAR"; do
	if grep -qF 'xml.Decoder' "$f" && ! grep -qF 'hand-rolled' "$f"; then
		echo "$(basename "$f") names xml.Decoder without naming parse_13f's hand-rolled scanner"; fail=1
	fi
done

echo "== doc: the output contract is stated =="
for pat in 'year=' 'ZSTD' 'manifest'; do
	grep -qiF "$pat" "$EDGAR" || { echo "edgar.md never states '$pat'"; fail=1; }
done

echo "== doc: skill-relative script pointers resolve =="
# SKILL.md:40 cited scripts/parse_13f/sge/submit_array.sh for a month; the file is
# submit_shards.sh. A pointer a reader cannot follow is a false claim about the repo.
while read -r rel; do
	[ -e "$WRDS/$rel" ] || { echo "SKILL.md cites $rel, which does not exist"; fail=1; }
done < <(grep -oE '`scripts/[A-Za-z0-9_./-]+\.(sh|py|go|sas)`' "$SKILL" | tr -d '`' | sort -u)

echo "== pytest =="
uv run --quiet --with pyarrow --with pytest python -m pytest test_edgar_parquet.py -q || fail=1

exit $fail
