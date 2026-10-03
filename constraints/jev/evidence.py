import argparse
import glob
import importlib
import inspect
import json
import os
import sys
import subprocess

def spans(state, spec):
    """`file:line` of every candidate a rule's SPANS names, in state order: an entry is an inventory key
    whose items carry `file` and `line`, or (key, file_field, line_field) when they are named otherwise.
    These are what the verdict was judged over, so a VIOLATED one points a repair at its lines."""
    out = []
    for entry in spec:
        key, ff, lf = (entry, 'file', 'line') if isinstance(entry, str) else entry
        for item in (state or {}).get(key) or []:
            f, n = (item.get(ff), item.get(lf)) if isinstance(item, dict) else (None, None)
            if f and isinstance(n, int) and f'{f}:{n}' not in out:
                out.append(f'{f}:{n}')
    return out


def main(my_dir=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--files', nargs='+', required=True)
    parser.add_argument('--plan')
    parser.add_argument('--root')
    parser.add_argument('--rules-dir', help='directory of rule modules; default: this one')
    parser.add_argument('--changed-lines',
                        help="JSON {path: [[lo, hi], ...]} of the round's added or changed lines")
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

    # label -> changed ranges, for the files the diff covers; a file it does not cover has no diff info
    changed = None
    if args.changed_lines:
        with open(args.changed_lines, 'r', encoding='utf-8') as f:
            by_path = {os.path.realpath(k): v for k, v in json.load(f).items()}
        changed = {label: by_path[os.path.realpath(f)] for label, f in files
                   if os.path.realpath(f) in by_path}

    plan_lines = None
    if args.plan:
        try:
            with open(args.plan, 'r', encoding='utf-8') as f:
                plan_lines = f.read().splitlines()
        except Exception as e:
            print(f"Warning: could not read plan file {args.plan}: {e}", file=sys.stderr)

    out = {}
    here = os.path.dirname(os.path.abspath(__file__))
    # --rules-dir, or a rules subdirectory's own evidence.py calling main(<its dir>), or this one
    rules_dir = os.path.abspath(args.rules_dir) if args.rules_dir else (my_dir or here)
    # a rules subdirectory's modules import _common from here and their own helpers from there
    for d in (here, rules_dir):
        if d not in sys.path:
            sys.path.insert(0, d)

    for path in sorted(glob.glob(os.path.join(rules_dir, "*.py"))):
        name = os.path.basename(path)
        if name.startswith('_') or name == 'evidence.py':
            continue
        
        mod_name = name[:-3]
        mod = importlib.import_module(mod_name)
        
        # only a rule that takes `changed` is diff-scoped; every other rule sees exactly what it did before
        if changed is not None and 'changed' in inspect.signature(mod.evidence).parameters:
            state = mod.evidence(files, plan_lines, changed=changed)
        else:
            state = mod.evidence(files, plan_lines)
        out[mod_name] = {
            'state': state,
            'proposition': mod.PROPOSITION,
            'criteria': mod.CRITERIA,
            'deliverable': getattr(mod, 'DELIVERABLE', 'data-science')
        }
        if getattr(mod, 'SUBJECT', None):
            out[mod_name]['subject'] = mod.SUBJECT
        if getattr(mod, 'SPANS', None):
            out[mod_name]['spans'] = spans(state, mod.SPANS)

    print(json.dumps(out, indent=2, default=str))

if __name__ == '__main__':
    main()
