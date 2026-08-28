#!/usr/bin/env bash
# Single mechanical entry point for parse_npx: format, vet, build, test.
# One exit code is the whole mechanical verdict.
set -uo pipefail
cd "$(dirname "$0")/parse_npx_go" || exit 1

fail=0

echo "== gofmt =="
unformatted=$(gofmt -l . 2>&1)
if [ -n "$unformatted" ]; then
	echo "unformatted files:"
	echo "$unformatted"
	fail=1
else
	echo "clean"
fi

echo "== go vet =="
go vet ./... || fail=1

echo "== go build =="
go build ./... || fail=1

echo "== stubs retired =="
stubs=$(ls stub_*.go 2>/dev/null)
if [ -n "$stubs" ]; then
	echo "panicking placeholders still present:"
	echo "$stubs"
	fail=1
else
	echo "none"
fi

echo "== go test =="
go test ./... || fail=1

exit $fail
