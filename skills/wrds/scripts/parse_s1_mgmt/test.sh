#!/usr/bin/env bash
# The known-answer suite. Exits non-zero while the extractor is a stub.
#
#   bash skills/wrds/scripts/parse_s1_mgmt/test.sh            # everything
#   bash skills/wrds/scripts/parse_s1_mgmt/test.sh -run Rule6 # one rule
set -uo pipefail

cd "$(dirname "$0")/parse_s1_mgmt_go" || exit 1

# nix's go is ahead of this module's toolchain on PATH; the mise install is the
# one whose GOROOT matches.
export PATH="$HOME/.local/share/mise/installs/go/1.27.1/bin:$PATH"

go vet ./... || exit 1
go test ./... "$@"
