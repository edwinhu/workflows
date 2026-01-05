#!/usr/bin/env python3
"""
DS Checks: Consolidated PreToolUse hook for data science workflow.

Combines:
- output-verifier: Warns on completion claims without visible output
- data-quality-checker: Warns on missing data inspection patterns
- reproducibility-checker: Warns on reproducibility issues

Session-aware: Only runs when ds workflow is active.
"""

import json
import re
import sys
import os

# Add shared scripts dir to path for session module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'shared', 'hooks', 'scripts'))
from session import is_workflow_active

# Early exit if ds workflow is not active
if not is_workflow_active('ds'):
    sys.exit(0)


# =============================================================================
# Output Verifier Logic
# =============================================================================

def check_completion_claims(command: str) -> list[str]:
    """Check if command contains completion claims without evidence."""
    warnings = []

    completion_patterns = [
        r'echo\s+["\'].*(?:complete|done|finished|success).*["\']',
        r'print\s*\(["\'].*(?:complete|done|finished|success).*["\']\)',
        r'echo\s+["\'].*(?:analysis|processing|loading|training)\s+(?:complete|done|finished).*["\']',
        r'print\s*\(["\'].*(?:analysis|processing|loading|training)\s+(?:complete|done|finished).*["\']\)',
    ]

    evidence_patterns = [
        r'\.head\(', r'\.tail\(', r'\.info\(', r'\.describe\(',
        r'\.shape', r'\.columns', r'print\s*\([^)]*df',
        r'display\s*\(', r'\.to_string\(', r'\.value_counts\(',
        r'\.nunique\(', r'len\s*\(', r'\.sample\(',
    ]

    has_completion_claim = any(re.search(p, command, re.IGNORECASE) for p in completion_patterns)
    has_evidence = any(re.search(p, command) for p in evidence_patterns)

    if has_completion_claim and not has_evidence:
        warnings.append(
            "Completion claim detected without visible evidence. "
            "Show actual results (e.g., df.head(), df.shape) before claiming completion."
        )

    load_patterns = [
        r'pd\.read_', r'\.load\(', r'open\s*\([^)]+\)',
        r'np\.load', r'torch\.load', r'pickle\.load',
    ]
    has_data_load = any(re.search(p, command) for p in load_patterns)

    if has_data_load and not has_evidence:
        warnings.append(
            "Data loaded without verification. "
            "Consider showing shape, head(), or info() to confirm successful load."
        )

    return warnings


# =============================================================================
# Data Quality Checker Logic
# =============================================================================

def check_data_quality_patterns(content: str) -> list[str]:
    """Check for data quality anti-patterns in code."""
    warnings = []

    df_creation_patterns = [
        r'pd\.read_csv', r'pd\.read_excel', r'pd\.read_json',
        r'pd\.read_parquet', r'pd\.read_sql', r'pd\.read_table',
        r'pd\.DataFrame\s*\(', r'\.merge\s*\(', r'\.join\s*\(', r'\.concat\s*\(',
    ]

    if not any(re.search(p, content) for p in df_creation_patterns):
        return warnings

    inspection_patterns = [
        r'\.head\s*\(', r'\.tail\s*\(', r'\.info\s*\(',
        r'\.shape', r'\.dtypes', r'\.columns', r'display\s*\(',
    ]
    null_check_patterns = [
        r'\.isnull\s*\(', r'\.isna\s*\(', r'\.notna\s*\(',
        r'\.notnull\s*\(', r'\.dropna\s*\(', r'\.fillna\s*\(', r'missing',
    ]
    duplicate_check_patterns = [
        r'\.duplicated\s*\(', r'\.drop_duplicates\s*\(',
        r'\.nunique\s*\(', r'\.unique\s*\(',
    ]
    describe_patterns = [
        r'\.describe\s*\(', r'\.mean\s*\(', r'\.std\s*\(',
        r'\.median\s*\(', r'\.min\s*\(', r'\.max\s*\(',
        r'\.quantile\s*\(', r'\.value_counts\s*\(',
    ]

    if not any(re.search(p, content) for p in inspection_patterns):
        warnings.append("DataFrame created without inspection. Consider adding .head(), .info(), or .shape.")

    if not any(re.search(p, content, re.IGNORECASE) for p in null_check_patterns):
        warnings.append("No null value check. Consider using df.isnull().sum().")

    if not any(re.search(p, content) for p in duplicate_check_patterns):
        warnings.append("No duplicate check. Consider using df.duplicated().sum().")

    if not any(re.search(p, content) for p in describe_patterns):
        warnings.append("No descriptive statistics. Consider using df.describe().")

    return warnings


# =============================================================================
# Reproducibility Checker Logic
# =============================================================================

def check_reproducibility_patterns(content: str) -> list[str]:
    """Check for reproducibility issues in code."""
    warnings = []

    seed_patterns = [
        r'np\.random\.seed\s*\(', r'random\.seed\s*\(',
        r'torch\.manual_seed\s*\(', r'tf\.random\.set_seed\s*\(',
        r'set_random_seed\s*\(', r'SEED\s*=', r'seed\s*=\s*\d+', r'random_state\s*=',
    ]
    random_patterns = [
        r'np\.random\.(?!seed)\w+\s*\(', r'random\.(?!seed)\w+\s*\(',
        r'torch\.rand', r'torch\.randn', r'tf\.random\.(?!set_seed)\w+',
    ]
    ml_model_patterns = [
        r'RandomForest\w*\s*\(', r'GradientBoosting\w*\s*\(',
        r'XGB\w*\s*\(', r'LightGBM\w*\s*\(', r'CatBoost\w*\s*\(',
        r'train_test_split\s*\(', r'KFold\s*\(', r'StratifiedKFold\s*\(',
        r'cross_val_score\s*\(', r'GridSearchCV\s*\(', r'RandomizedSearchCV\s*\(',
        r'LogisticRegression\s*\(', r'KMeans\s*\(', r'DBSCAN\s*\(',
        r'IsolationForest\s*\(',
    ]

    has_seed = any(re.search(p, content, re.IGNORECASE) for p in seed_patterns)
    has_random_ops = any(re.search(p, content) for p in random_patterns)
    has_random_state = bool(re.search(r'random_state\s*=', content))
    ml_models_found = any(re.search(p, content) for p in ml_model_patterns)

    if has_random_ops and not has_seed:
        warnings.append("Random operations without seed. Consider adding np.random.seed().")

    if ml_models_found and not has_random_state:
        warnings.append("ML model without random_state. Consider adding random_state=SEED.")

    if re.search(r'\.shuffle\s*\(', content) and not has_seed:
        warnings.append("Shuffle without seed. Set random seed before shuffling.")

    if re.search(r'\.sample\s*\([^)]*\)', content):
        if not re.search(r'\.sample\s*\([^)]*random_state', content) and not has_seed:
            warnings.append("DataFrame.sample() without random_state.")

    return warnings


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Get content based on tool type
    if tool_name == "Bash":
        content = tool_input.get("command", "")
    elif tool_name == "Write":
        content = tool_input.get("content", "")
    else:
        sys.exit(0)

    if not content:
        sys.exit(0)

    # Only check Python-related content
    is_python_content = (
        "python" in content.lower() or
        "pd." in content or
        "pandas" in content or
        "DataFrame" in content or
        "np." in content or
        "numpy" in content or
        "random" in content.lower() or
        "sklearn" in content or
        "torch" in content or
        "tensorflow" in content or
        tool_input.get("file_path", "").endswith((".py", ".ipynb"))
    )

    if not is_python_content:
        sys.exit(0)

    # Collect all warnings
    all_warnings = []
    all_warnings.extend(check_completion_claims(content))
    all_warnings.extend(check_data_quality_patterns(content))
    all_warnings.extend(check_reproducibility_patterns(content))

    if all_warnings:
        result = {
            "decision": "approve",
            "reason": " | ".join(all_warnings)
        }
        print(json.dumps(result))
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
