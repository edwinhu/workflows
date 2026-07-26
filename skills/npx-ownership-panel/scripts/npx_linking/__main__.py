"""CLI for the NPX <-> CRSP linking chain: python -m scripts.linking <cmd>."""
import argparse
import sys

from . import (STAGES, build_coverage, fingerprints, parity_report, run_all,
               stage, verify)


def _keys(args):
    """Resolve --only / --from / --stages into an ordered stage list."""
    order = [s.key for s in STAGES]
    if args.only:
        return [stage(k).key for k in args.only]
    if getattr(args, "from_", None):
        start = order.index(stage(args.from_).key)
        return order[start:]
    return order


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m scripts.linking",
                                description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="rebuild the chain in dependency order")
    run.add_argument("--only", nargs="+", metavar="STAGE",
                     help="run exactly these stages, in the order given")
    run.add_argument("--from", dest="from_", metavar="STAGE",
                     help="run this stage and every stage after it")
    run.add_argument("--root", help="project root to run in (default: this repo)")
    run.add_argument("--python", help="interpreter to run the builders with")
    run.add_argument("--dry-run", action="store_true")

    ver = sub.add_parser("verify", help="sandboxed rebuild, diffed against the "
                                        "committed masters (never overwrites them)")
    ver.add_argument("--sandbox", help="shadow project root (default scratch/)")
    ver.add_argument("--only", nargs="+", metavar="STAGE")
    ver.add_argument("--from", dest="from_", metavar="STAGE")
    ver.add_argument("--keep", action="store_true", help="leave the sandbox on disk")
    ver.add_argument("--stream", action="store_true",
                     help="stream builder output instead of capturing it")

    sub.add_parser("coverage", help="build data/output/l4_coverage*.csv")
    sub.add_parser("parity", help="assert matching.py reproduces the builders")
    sub.add_parser("stages", help="print the chain")
    sub.add_parser("fingerprint", help="print the masters' row counts + checksums")

    args = p.parse_args(argv)

    if args.cmd == "stages":
        for i, s in enumerate(STAGES, 1):
            print(f"\n{i}. {s.key}  ({s.script}, ~{s.approx_seconds}s)")
            print(f"   {s.title}")
            print(f"   in : {', '.join(s.inputs)}")
            print(f"   out: {', '.join(s.outputs)}")
            if s.notes:
                print(f"   note: {s.notes}")
        return 0

    if args.cmd == "run":
        keys = _keys(args)
        if args.dry_run:
            print("would run, in order: " + " -> ".join(keys))
            return 0
        run_all(stages=keys, root=args.root, python=args.python)
        return 0

    if args.cmd == "verify":
        keys = _keys(args)
        ok, _ = verify(sandbox=args.sandbox, stages=keys, keep=args.keep,
                       capture=not args.stream)
        print("\nVERIFY: " + ("all masters reproduced exactly"
                              if ok else "DIVERGENCE — see the table above"))
        return 0 if ok else 1

    if args.cmd == "coverage":
        build_coverage()
        return 0

    if args.cmd == "parity":
        print("matching.py vs the builders' own inlined helpers:")
        parity_report()
        print("parity: OK")
        return 0

    if args.cmd == "fingerprint":
        for name, fp in fingerprints().items():
            print(f"{name}: {fp}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
