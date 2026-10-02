"""Evidence for the dev (code) rules: the parent extractor, globbing THIS directory."""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(HERE)
sys.path.insert(0, PARENT)  # _common

# Loaded by path: `import evidence` from here would import this file again.
spec = importlib.util.spec_from_file_location('jev_evidence', os.path.join(PARENT, 'evidence.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

if __name__ == '__main__':
    base.main(HERE)
