#!/usr/bin/env -S uv run python3
"""PreToolUse guard: block data exploration during brainstorm phase.

The Iron Law: NO DATA EXPLORATION BEFORE ASKING QUESTIONS.
Block Bash commands that look like data analysis during brainstorm.
"""
import json
import os
import sys

def main():
    tool_input = json.loads(sys.stdin.read())
    tool_name = tool_input.get("tool_name", "")
    tool_params = tool_input.get("tool_input", {})

    if tool_name != "Bash":
        print(json.dumps({"decision": "allow"}))
        return

    command = tool_params.get("command", "")

    # Block data exploration commands
    exploration_patterns = [
        "python3 -c", "python -c",
        "import pandas", "import numpy", "import polars",
        "pd.read_", "pd.DataFrame", "df.head", "df.describe", "df.info",
        "df.shape", "df.columns", "df.dtypes",
        ".read_csv", ".read_parquet", ".read_sql", ".read_excel",
        "pixi run python",
    ]

    if any(pattern in command for pattern in exploration_patterns):
        # Check if SPEC.md exists — if it does, brainstorm is done
        spec_path = os.path.join(os.getcwd(), ".planning", "SPEC.md")
        if os.path.exists(spec_path):
            # Brainstorm complete, allow exploration
            print(json.dumps({"decision": "allow"}))
            return

        print(json.dumps({
            "decision": "block",
            "message": "\ud83d\uded1 Iron Law: No data exploration before asking questions. Complete the brainstorm interview and write SPEC.md first. Data exploration happens in ds-plan (Phase 2)."
        }))
        return

    # Allow non-analysis bash commands
    print(json.dumps({"decision": "allow"}))

if __name__ == "__main__":
    main()
