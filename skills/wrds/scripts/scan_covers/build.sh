#!/bin/bash
# Cross-compile scan_covers for WRDS (Linux amd64, static binary, no cgo).
set -euo pipefail
cd "$(dirname "$0")"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o scan_covers .
ls -lh scan_covers
