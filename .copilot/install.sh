#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKFLOWS_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo -e "${YELLOW}Installing workflows for GitHub Copilot (VS Code)${NC}"
echo ""

# Step 1: Create prompt directory
echo "Step 1: Creating prompt configuration directory..."
mkdir -p ~/.config/Code/User/prompts
echo -e "${GREEN}✓ Created ~/.config/Code/User/prompts${NC}"

# Step 2: Create/symlink workflows instruction file
echo ""
echo "Step 2: Installing workflows instruction file..."

PROMPT_FILE="$HOME/.config/Code/User/prompts/workflows.instructions.md"
SOURCE_FILE="$SCRIPT_DIR/workflows.instructions.md"

# Remove existing file/symlink if it exists
if [ -e "$PROMPT_FILE" ] || [ -L "$PROMPT_FILE" ]; then
    rm -f "$PROMPT_FILE"
fi

# Create symlink to source file in workflows repo
if ln -s "$SOURCE_FILE" "$PROMPT_FILE" 2>/dev/null; then
    echo -e "${GREEN}✓ Created symlink: $PROMPT_FILE → $SOURCE_FILE${NC}"
else
    # Fallback: copy if symlink fails (e.g., Windows)
    echo -e "${YELLOW}⚠ Symlink failed, copying file instead${NC}"
    cp "$SOURCE_FILE" "$PROMPT_FILE"
    echo -e "${GREEN}✓ Copied $SOURCE_FILE → $PROMPT_FILE${NC}"
fi

# Step 3: Verify installation
echo ""
echo "Step 3: Verifying installation..."

if [ -f "$PROMPT_FILE" ]; then
    echo -e "${GREEN}✓ workflows.instructions.md installed${NC}"
else
    echo -e "${RED}✗ Failed to install workflows.instructions.md${NC}"
    exit 1
fi

# Verify skills directory exists
if [ -d "$WORKFLOWS_DIR/skills" ]; then
    SKILL_COUNT=$(ls "$WORKFLOWS_DIR/skills" | wc -l)
    echo -e "${GREEN}✓ Found $SKILL_COUNT skills in $WORKFLOWS_DIR/skills${NC}"
else
    echo -e "${YELLOW}⚠ Skills directory not found at $WORKFLOWS_DIR/skills${NC}"
fi

# Final summary
echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Restart VS Code"
echo "2. Open a new conversation with GitHub Copilot"
echo "3. Skills should now be available in every session"
echo ""
echo "To verify, ask Copilot: 'List the workflows skills'"
echo ""
echo "For more information, see: $WORKFLOWS_DIR/.copilot/INSTALL.md"
echo ""
echo "Source file: $SOURCE_FILE"
echo "Target location: $PROMPT_FILE"
