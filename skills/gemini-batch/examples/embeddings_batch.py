#!/usr/bin/env python3
"""Retired Developer embedding example; all network operations are disabled.

Production requires a documented Vertex embedding route for the pinned model,
ADC and GCS. Do not substitute vertexai=True into Developer File API recipes.
The retained parsing code is historical, not a supported production CLI.
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
from google.genai import types
from google.genai.types import EmbeddingsBatchJobSource

EMBED_DIM = 3072
TASK_TYPE = "SEMANTIC_SIMILARITY"
MODEL = "gemini-embedding-001"  # also tested: "gemini-embedding-2"


def _production_client():
    raise SystemExit(
        "STOP: Developer embedding batch is disabled. Production requires a "
        "verified Vertex route with ADC/GCS for the pinned embedding model."
    )


def _build_jsonl(items: list[dict], path: Path, model: str = MODEL) -> None:
    with open(path, "w") as f:
        for it in items:
            request = {
                "content": {"parts": [{"text": it["text"]}]},
                "output_dimensionality": EMBED_DIM,
            }
            if model == "gemini-embedding-001":
                request["task_type"] = TASK_TYPE
            f.write(json.dumps({"key": it["id"], "request": request}) + "\n")


def submit(args: argparse.Namespace) -> None:
    _production_client()
    # For Embedding 2, callers supply task-prefixed text; sentinels reuse it exactly.
    items = json.loads(Path(args.input).read_text())
    if not isinstance(items, list) or not all(isinstance(it, dict) and "id" in it and "text" in it for it in items):
        raise SystemExit('--input must be a JSON list of {"id": str, "text": str} objects')
    if len({it["id"] for it in items}) != len(items):
        raise SystemExit("--input has duplicate ids; each `id` must be unique")
    print(f"Submitting embedding batch: {len(items):,} items, model={args.model}, dim={EMBED_DIM}")

    jsonl_path = Path(args.out).with_suffix(".jsonl")
    _build_jsonl(items, jsonl_path, args.model)
    print(f"Wrote keyed JSONL: {jsonl_path} ({jsonl_path.stat().st_size/1e6:.1f} MB)")

    client = _production_client()
    uploaded = client.files.upload(file=str(jsonl_path), config={"mime_type": "application/jsonl"})
    print(f"Uploaded as: {uploaded.name}")

    job = client.batches.create_embeddings(
        model=args.model,
        src=EmbeddingsBatchJobSource(file_name=uploaded.name),
        config={"display_name": args.display_name or f"embed_{time.strftime('%Y%m%d_%H%M%S')}"},
    )
    state = {
        "job_name": job.name,
        "model": args.model,
        "n_items": len(items),
        "input_file": uploaded.name,
        "jsonl_path": str(jsonl_path),
        "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "state_at_submit": str(job.state),
    }
    Path(args.out).write_text(json.dumps(state, indent=2))
    print(f"Job: {job.name}  state={job.state}")
    print(f"State written to {args.out}")


def status(args: argparse.Namespace) -> None:
    state = json.loads(Path(args.job).read_text())
    client = _production_client()
    job = client.batches.get(name=state["job_name"])
    print(f"Job: {job.name}")
    print(f"State: {job.state}")
    if job.dest is not None:
        print(f"Dest: file_name={job.dest.file_name} inlined={'yes' if job.dest.inlined_embed_content_responses else 'no'}")


def download(args: argparse.Namespace) -> None:
    state = json.loads(Path(args.job).read_text())
    items = json.loads(Path(args.order).read_text())
    client = _production_client()
    job = client.batches.get(name=state["job_name"])
    if "SUCCEEDED" not in str(job.state):
        raise SystemExit(f"Job not succeeded; state={job.state}")

    # File-based path: download results JSONL and parse by key
    if not (job.dest and job.dest.file_name):
        raise SystemExit(
            "Job has no output file_name. If you submitted via inlined_requests, "
            "results are in job.dest.inlined_embed_content_responses but order is "
            "NOT preserved at scale and there is no key — re-submit via file-based "
            "JSONL with per-row keys."
        )

    out_path = Path(args.out).with_suffix(".jsonl.tmp")
    print(f"Downloading {job.dest.file_name} ...")
    blob = client.files.download(file=job.dest.file_name)
    out_path.write_bytes(blob)

    # Parse: dict[key → vector]
    embeddings: dict[str, np.ndarray] = {}
    with open(out_path) as f:
        for ln, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
                key = rec["key"]
                vals = rec["response"]["embedding"]["values"]
                embeddings[key] = np.array(vals, dtype=np.float32)
            except (KeyError, json.JSONDecodeError) as e:
                print(f"  warn: line {ln} skipped: {e}")

    # Map back to input order
    missing = [it["id"] for it in items if it["id"] not in embeddings]
    if missing:
        raise SystemExit(f"Missing embeddings for {len(missing)} items, e.g. {missing[:5]}")
    out = np.array([embeddings[it["id"]] for it in items], dtype=np.float32)
    np.save(args.out, out)
    norms = np.linalg.norm(out, axis=1)
    print(f"Wrote {args.out} shape={out.shape}")
    print(f"  norm: mean={norms.mean():.4f}  min={norms.min():.4f}  zero={int((norms==0).sum())}")
    out_path.unlink()  # clean tmp

    # Sentinel verification — fresh-embed 5 random items, assert cosine ≥ 0.99
    if args.skip_sentinels:
        return
    print("\nSentinel alignment check (fresh sync embeds, expect cosine ≥ 0.99):")
    config_args = {"output_dimensionality": EMBED_DIM}
    if state["model"] == "gemini-embedding-001":
        config_args["task_type"] = TASK_TYPE
    config = types.EmbedContentConfig(**config_args)
    random.seed(7)
    for i in random.sample(range(len(items)), min(5, len(items))):
        it = items[i]
        fresh = np.array(client.models.embed_content(
            model=state["model"], contents=it["text"], config=config
        ).embeddings[0].values, dtype=np.float32)
        sim = float((out[i] @ fresh) / (np.linalg.norm(out[i]) * np.linalg.norm(fresh)))
        flag = "OK " if sim >= 0.99 else "FAIL"
        print(f"  {flag}  row {i:>5}  cos={sim:.4f}  '{it['text'][:50]}'")
        if sim < 0.99:
            raise SystemExit(f"ALIGNMENT BROKEN at row {i}: cosine={sim:.4f} — keys did not round-trip cleanly")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("submit")
    sp.add_argument("--input", required=True, help='JSON list of {"id","text"} objects')
    sp.add_argument("--out", required=True, help="Path to save job state JSON (also used as JSONL stem)")
    sp.add_argument("--model", default=MODEL, choices=["gemini-embedding-001", "gemini-embedding-2"], help="gemini-embedding-001 or gemini-embedding-2")
    sp.add_argument("--display-name", default=None)
    sp.set_defaults(func=submit)
    sp = sub.add_parser("status")
    sp.add_argument("--job", required=True)
    sp.set_defaults(func=status)
    sp = sub.add_parser("download")
    sp.add_argument("--job", required=True)
    sp.add_argument("--out", required=True, help="Path for embeddings .npy (aligned with --order)")
    sp.add_argument("--order", required=True, help="The same items.json passed to submit (defines row order)")
    sp.add_argument("--skip-sentinels", action="store_true", help="Skip the cosine sentinel check (NOT RECOMMENDED)")
    sp.set_defaults(func=download)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
