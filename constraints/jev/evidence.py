import argparse
import glob
import importlib
import json
import os
import sys
import subprocess

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--files', nargs='+', required=True)
    parser.add_argument('--plan')
    parser.add_argument('--root')
    args = parser.parse_args()

    root_dir = args.root
    if not root_dir and args.files:
        first_file_dir = os.path.dirname(os.path.abspath(args.files[0]))
        try:
            root_dir = subprocess.check_output(
                ['git', '-C', first_file_dir, 'rev-parse', '--show-toplevel'],
                stderr=subprocess.DEVNULL,
                text=True
            ).strip()
        except subprocess.CalledProcessError:
            pass

    files = []
    for f in args.files:
        abs_f = os.path.abspath(f)
        if root_dir:
            label = os.path.relpath(abs_f, os.path.abspath(root_dir))
        else:
            label = os.path.basename(abs_f)
        files.append((label, f))

    plan_lines = None
    if args.plan:
        try:
            with open(args.plan, 'r', encoding='utf-8') as f:
                plan_lines = f.read().splitlines()
        except Exception as e:
            print(f"Warning: could not read plan file {args.plan}: {e}", file=sys.stderr)

    out = {}
    my_dir = os.path.dirname(os.path.abspath(__file__))
    if my_dir not in sys.path:
        sys.path.insert(0, my_dir)

    for path in glob.glob(os.path.join(my_dir, "*.py")):
        name = os.path.basename(path)
        if name.startswith('_') or name == 'evidence.py':
            continue
        
        mod_name = name[:-3]
        mod = importlib.import_module(mod_name)
        
        state = mod.evidence(files, plan_lines)
        out[mod_name] = {
            'state': state,
            'proposition': mod.PROPOSITION,
            'criteria': mod.CRITERIA
        }

    print(json.dumps(out, indent=2, default=str))

if __name__ == '__main__':
    main()
