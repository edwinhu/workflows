#!/bin/bash
# Quick installer for workflows (automated)
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/edwinhu/workflows/refs/heads/opencode-compatibility/.opencode/install.sh)

set -e

# Download and run the full installer
curl -fsSL https://raw.githubusercontent.com/edwinhu/workflows/refs/heads/opencode-compatibility/.opencode/install.sh | bash
