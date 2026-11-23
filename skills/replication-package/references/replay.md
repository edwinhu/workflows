# Replay contract

A package that backs an expert report or court production must let the recipient rebuild the reported numbers from the saved
inputs and see, by an exit code, that they match. Three parts.

## (a) decisions.csv

One row per human or rule-based decision that overrides or excludes a pipeline result. No override lives anywhere else.
UTF-8, comma-separated, quoted per RFC 4180, one decision per row.

| column | content |
|---|---|
| `decision_id` | stable slug, e.g. `cp-exclude-haverty` |
| `scope` | what the decision touches (e.g. `class_period`, `r1000`, `board_power`, `info_rights`, `class_row`, `exemption`, `other`) |
| `cik`, `name`, `accession` | the entity and filing |
| `field` | the output field affected (e.g. `in_sample`, `counted`) |
| `pipeline_value` | what the pipeline produces without the decision |
| `decided_value` | what the decision sets |
| `reason` | one or two plain sentences |
| `quote` | verbatim sentence from the document relied on; empty only when the decision rests on arithmetic, and `reason` then says so |
| `source` | document and location: accession, exhibit, section, line |
| `decided_by` | `Eddy`, `team call` or `rule` (the decider's name for other projects) |
| `decided_on` | `YYYY-MM-DD` |
| `runbook_step` | the runbook step that describes it |

## (b) manifest (a `manifest/` dir)

- `sample.csv`: the final sample, one row per member (`scope, cik, accession, name`, plus a counted flag where the report counts a subset).
- `figures.csv`: `figure_id, label, value`, one row per reported figure (every row of the workbook's figures sheet).
- `inputs.csv`: `path, md5, bytes, role`, one row per saved raw input and model output the build reads, plus rows for the code commit
  and the builder's output hash (roles `skill_commit`, `content_hash`: recorded, not file digests).

## (c) the replay command

Rebuilds from the files listed in `inputs.csv` only: no model call, no network, nothing written into the input tree. Steps:

1. md5 (and size) of every listed input must match `inputs.csv`, and every file the replay reads must be listed; otherwise print each
   mismatch and exit 1.
2. Rerun the deterministic stages into a scratch dir.
3. Apply `decisions.csv`; a decision whose `pipeline_value` is not what the rerun produced is a failure.
4. Compare with `sample.csv` and `figures.csv`; print every difference with the decision row that explains it, if any.
5. Exit 0 only when no difference is unexplained; 1 on any other difference; 2 on a usage or input-format error.

## Where `ds` reads it

`ds`'s `ds-replay` leg (`skills/ds/scripts/ds_replay.py`) runs the project's replay command and the exit code is the R1 verdict. It
finds the command from a `Replay command: <cmd>` line in the plan, or a `manifest/` dir holding `inputs.csv` with `replay.sh` or
`replay.py` in it or beside it. With none it reports `R1 FINDING: no replay command`.

