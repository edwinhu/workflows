#!/bin/bash

# Workflows Plugin Installer for OpenCode
# Installs the workflows skills library globally for OpenCode
# Based on superpowers installation pattern: https://github.com/obra/superpowers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    Workflows Installation for OpenCode         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}→ Checking prerequisites...${NC}"

if ! command -v opencode &> /dev/null; then
    echo -e "${RED}✗ OpenCode not found. Please install OpenCode first:${NC}"
    echo "  https://opencode.ai"
    exit 1
fi
echo -e "${GREEN}✓ OpenCode installed${NC}"

if ! command -v git &> /dev/null; then
    echo -e "${RED}✗ Git not found. Please install Git first${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Git installed${NC}"

echo ""
echo -e "${YELLOW}→ Installation method:${NC}"
echo ""
echo "  1. Global (recommended) - Skills available to all projects"
echo "  2. Project-local - Skills in current project only"
echo "  3. Skip installation - Just set up the directories"
echo ""
read -p "Choose option (1-3, default 1): " METHOD
METHOD=${METHOD:-1}

case $METHOD in
    1)
        echo ""
        echo -e "${YELLOW}→ Installing globally...${NC}"
        
        # Clone or update repository
        WORKFLOWS_DIR="$HOME/.config/opencode/workflows"
        
        if [ -d "$WORKFLOWS_DIR" ]; then
            echo "  Repository already exists at $WORKFLOWS_DIR"
            read -p "  Update existing installation? (y/n): " UPDATE
            if [[ $UPDATE == "y" ]]; then
                echo "  Updating repository..."
                cd "$WORKFLOWS_DIR"
                git fetch origin opencode-compatibility
                git checkout opencode-compatibility
                git pull
                cd - > /dev/null
            fi
        else
            echo "  Cloning workflows repository..."
            mkdir -p "$HOME/.config/opencode"
            git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git "$WORKFLOWS_DIR"
        fi
        echo -e "${GREEN}✓ Repository ready${NC}"
        
        # Create skill symlinks
        echo ""
        echo -e "${YELLOW}→ Setting up skills...${NC}"
        mkdir -p "$HOME/.config/opencode/skill"
        
        # Remove old symlinks if they exist
        if [ -L "$HOME/.config/opencode/skill" ] && [ -e "$HOME/.config/opencode/skill" ]; then
            echo "  Cleaning up old symlinks..."
            rm -f "$HOME/.config/opencode/skill"/*
        fi
        
        echo "  Creating skill symlinks..."
        for skill_dir in "$WORKFLOWS_DIR"/skills/*/; do
            skill_name=$(basename "$skill_dir")
            ln -sf "$skill_dir" "$HOME/.config/opencode/skill/$skill_name"
        done
        echo -e "${GREEN}✓ $(ls -1 "$HOME/.config/opencode/skill" | wc -l) skills linked${NC}"
        
        # Install plugin
        echo ""
        echo -e "${YELLOW}→ Installing plugin...${NC}"
        mkdir -p "$HOME/.config/opencode/plugin"
        cp "$WORKFLOWS_DIR/.opencode/plugin/workflows.js" "$HOME/.config/opencode/plugin/"
        echo -e "${GREEN}✓ Plugin installed${NC}"
        
        echo ""
        echo -e "${GREEN}✓ Global installation complete!${NC}"
        echo ""
        echo "Next steps:"
        echo "  1. Restart OpenCode"
        echo "  2. In OpenCode, use: find_skills"
        echo "  3. Or load a skill: use_skill(skill_name=\"dev-implement\")"
        echo ""
        echo "To update skills later:"
        echo "  cd $WORKFLOWS_DIR && git pull"
        ;;
        
    2)
        echo ""
        echo -e "${YELLOW}→ Setting up project-local installation...${NC}"
        
        # Check if we're in a project directory
        if [ ! -d ".git" ]; then
            echo -e "${YELLOW}! Warning: Not in a git repository root${NC}"
        fi
        
        # Create .opencode/skills directory
        mkdir -p .opencode/skill
        
        # Copy or symlink skills
        WORKFLOWS_DIR="${WORKFLOWS_DIR:-$HOME/.config/opencode/workflows}"
        if [ ! -d "$WORKFLOWS_DIR" ]; then
            echo "  Workflows not found at $WORKFLOWS_DIR"
            echo "  Please install globally first, or specify WORKFLOWS_DIR environment variable"
            exit 1
        fi
        
        read -p "  Use symlinks (auto-update) or copy files? (symlink/copy, default symlink): " LINK_METHOD
        LINK_METHOD=${LINK_METHOD:-symlink}
        
        if [[ $LINK_METHOD == "copy" ]]; then
            echo "  Copying skills..."
            cp -r "$WORKFLOWS_DIR"/skills/* .opencode/skill/
        else
            echo "  Creating symlinks..."
            for skill_dir in "$WORKFLOWS_DIR"/skills/*/; do
                skill_name=$(basename "$skill_dir")
                ln -sf "$skill_dir" ".opencode/skill/$skill_name"
            done
        fi
        
        echo -e "${GREEN}✓ Project installation complete!${NC}"
        echo ""
        echo "Skills are now in .opencode/skill/ and will be auto-discovered by OpenCode"
        echo "Skill discovery priority:"
        echo "  1. Project skills (.opencode/skill/) - HIGHEST"
        echo "  2. Personal skills (~/.config/opencode/skill/)"
        echo "  3. Global workflows skills"
        ;;
        
    3)
        echo ""
        echo "Skipping installation. You can run this script again later."
        echo ""
        echo "Manual installation steps:"
        echo "  1. Global: ln -sf ~/.config/opencode/workflows/skills/* ~/.config/opencode/skill/"
        echo "  2. Project: ln -sf ~/.config/opencode/workflows/skills/* .opencode/skill/"
        echo "  3. Plugin: cp ~/.config/opencode/workflows/.opencode/plugin/workflows.js ~/.config/opencode/plugin/"
        ;;
        
    *)
        echo -e "${RED}✗ Invalid option${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${YELLOW}→ Verification${NC}"
if [ -d "$HOME/.config/opencode/skill" ]; then
    SKILL_COUNT=$(ls -1 "$HOME/.config/opencode/skill" 2>/dev/null | wc -l)
    echo -e "${GREEN}✓ Found $SKILL_COUNT skills in ~/.config/opencode/skill${NC}"
fi

if [ -f "$HOME/.config/opencode/plugin/workflows.js" ]; then
    echo -e "${GREEN}✓ Plugin installed at ~/.config/opencode/plugin/workflows.js${NC}"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "📚 Learn more:"
echo "  Documentation: https://github.com/edwinhu/workflows/.opencode/INSTALL.md"
echo "  Report issues: https://github.com/edwinhu/workflows/issues"
echo ""
echo -e "${YELLOW}! Don't forget to restart OpenCode${NC}"
