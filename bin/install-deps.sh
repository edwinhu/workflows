#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

case "$OS" in
  darwin|linux) ;;
  mingw*|msys*|cygwin*) OS="windows" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

if ! command -v gh &>/dev/null; then
  echo "Error: gh (GitHub CLI) is required. Install from https://cli.github.com" >&2
  exit 1
fi

TOOLS=(
  "edwinhu/nlm|nlm|nlm-${OS}-${ARCH}"
  "edwinhu/readwise-cli|readwise-custom|readwise-custom-${OS}-${ARCH}"
  "edwinhu/google-scholar-cli|scholar|scholar-${OS}-${ARCH}"
  "edwinhu/consensus-cli|consensus|consensus-${OS}-${ARCH}"
  "edwinhu/morgen-cli|morgen|morgen-${OS}-${ARCH}"
  "edwinhu/superhuman-cli|superhuman|superhuman-${OS}-${ARCH}"
)

for entry in "${TOOLS[@]}"; do
  IFS='|' read -r repo name asset <<< "$entry"

  if command -v "$name" &>/dev/null; then
    echo "skip: $name (already installed at $(command -v "$name"))"
    continue
  fi

  echo "installing: $name from $repo..."
  if gh release download --repo "$repo" --pattern "${asset}*" --dir /tmp --clobber 2>/dev/null; then
    mv "/tmp/${asset}" "$INSTALL_DIR/$name"
    chmod +x "$INSTALL_DIR/$name"
    echo "  -> $INSTALL_DIR/$name"
  else
    echo "  warn: no release found for $repo (${asset}), skipping" >&2
  fi
done

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "Add to your shell profile:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

echo ""
echo "Done. Installed tools:"
for entry in "${TOOLS[@]}"; do
  IFS='|' read -r _ name _ <<< "$entry"
  if command -v "$name" &>/dev/null; then
    echo "  $name: $(command -v "$name")"
  else
    echo "  $name: not found"
  fi
done
