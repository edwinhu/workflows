#!/usr/bin/env python3
"""
Reproducibility Checker Hook

Warns on reproducibility issues:
- Random operations without seed (np.random, random.*)
- Model training without random_state
- Data loading without versioning mention

Session-aware: Only runs when ds workflow is active.
"""

import json
import re
import sys
import os

# Add shared scripts dir to path for session module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'common', 'hooks', 'scripts'))
from session import is_workflow_active

# Early exit if ds workflow is not active (session-aware like Ralph loops)
if not is_workflow_active('ds'):
    sys.exit(0)


def get_hook_input():
    """Read hook input from stdin."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def check_reproducibility_patterns(content: str) -> list[str]:
    """Check for reproducibility issues in code."""
    warnings = []

    # Seed setting patterns
    seed_patterns = [
        r'np\.random\.seed\s*\(',
        r'random\.seed\s*\(',
        r'torch\.manual_seed\s*\(',
        r'tf\.random\.set_seed\s*\(',
        r'set_random_seed\s*\(',
        r'SEED\s*=',
        r'seed\s*=\s*\d+',
        r'random_state\s*=',
    ]

    # Random operation patterns (without seed)
    # Use negative lookahead to exclude seed-setting calls
    random_patterns = [
        r'np\.random\.(?!seed)\w+\s*\(',
        r'random\.(?!seed)\w+\s*\(',
        r'torch\.rand',
        r'torch\.randn',
        r'tf\.random\.(?!set_seed)\w+',
    ]

    # ML model patterns that should have random_state
    ml_model_patterns = [
        r'RandomForest\w*\s*\(',
        r'GradientBoosting\w*\s*\(',
        r'XGB\w*\s*\(',
        r'LightGBM\w*\s*\(',
        r'CatBoost\w*\s*\(',
        r'train_test_split\s*\(',
        r'KFold\s*\(',
        r'StratifiedKFold\s*\(',
        r'cross_val_score\s*\(',
        r'GridSearchCV\s*\(',
        r'RandomizedSearchCV\s*\(',
        r'LogisticRegression\s*\(',
        r'KMeans\s*\(',
        r'DBSCAN\s*\(',
        r'IsolationForest\s*\(',
    ]

    # Data versioning patterns
    versioning_patterns = [
        r'version',
        r'v\d+\.\d+',
        r'sha\s*=',
        r'hash\s*=',
        r'commit',
        r'dvc',
        r'mlflow',
        r'wandb',
        r'neptune',
    ]

    # Check for seed setting
    has_seed = any(
        re.search(pattern, content, re.IGNORECASE)
        for pattern in seed_patterns
    )

    # Check for random operations
    has_random_ops = any(
        re.search(pattern, content)
        for pattern in random_patterns
    )

    # Check for ML models
    ml_models_found = [
        pattern for pattern in ml_model_patterns
        if re.search(pattern, content)
    ]

    # Check for random_state in ML model calls
    has_random_state = bool(re.search(r'random_state\s*=', content))

    # Check for versioning
    has_versioning = any(
        re.search(pattern, content, re.IGNORECASE)
        for pattern in versioning_patterns
    )

    # Check for data loading
    data_load_patterns = [
        r'pd\.read_',
        r'np\.load',
        r'torch\.load',
        r'open\s*\([^)]+\.(?:csv|json|parquet|pkl)',
    ]
    has_data_load = any(
        re.search(pattern, content)
        for pattern in data_load_patterns
    )

    # Generate warnings
    if has_random_ops and not has_seed:
        warnings.append(
            "Random operations detected without seed setting. "
            "Consider adding np.random.seed() or random.seed() for reproducibility."
        )

    if ml_models_found and not has_random_state:
        warnings.append(
            "ML model detected without random_state parameter. "
            "Consider adding random_state=SEED for reproducible results."
        )

    if has_data_load and not has_versioning:
        warnings.append(
            "Data loading detected without versioning. "
            "Consider documenting data version/hash for reproducibility."
        )

    # Check for shuffle without seed
    if re.search(r'\.shuffle\s*\(', content) and not has_seed:
        warnings.append(
            "Shuffle operation detected without seed. "
            "Consider setting random seed before shuffling."
        )

    # Check for sample without random_state
    if re.search(r'\.sample\s*\([^)]*\)', content):
        if not re.search(r'\.sample\s*\([^)]*random_state', content) and not has_seed:
            warnings.append(
                "DataFrame.sample() detected without random_state. "
                "Consider adding random_state parameter for reproducibility."
            )

    return warnings


def main():
    hook_input = get_hook_input()

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Get content based on tool type
    if tool_name == "Bash":
        content = tool_input.get("command", "")
    elif tool_name == "Write":
        content = tool_input.get("content", "")
    else:
        content = ""

    if not content:
        result = {"decision": "approve"}
        print(json.dumps(result))
        return

    # Only check Python-related content
    is_python_content = (
        "python" in content.lower() or
        "np." in content or
        "numpy" in content or
        "random" in content.lower() or
        "sklearn" in content or
        "torch" in content or
        "tensorflow" in content or
        tool_input.get("file_path", "").endswith(".py") or
        tool_input.get("file_path", "").endswith(".ipynb")
    )

    if not is_python_content:
        result = {"decision": "approve"}
        print(json.dumps(result))
        return

    warnings = check_reproducibility_patterns(content)

    if warnings:
        # Return warnings but don't block - just inform
        result = {
            "decision": "approve",
            "reason": " | ".join(warnings)
        }
    else:
        result = {"decision": "approve"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
