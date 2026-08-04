---
name: permacc
description: Archive citation URLs to perma.cc so a law review footnote does not rot. Use when archiving links for a manuscript, cite-checking, adding perma links to footnotes, when a perma archive returns "usage limit" despite an institutional account, or when finding which perma folder an account may archive into.
---

# perma.cc

Archives a URL to a permanent, court-citable snapshot. The whole skill exists
because **one HTTP 400 means three different things**, and the message names
only the least likely one.

```
HTTP 400  "You've reached your usage limit."
              │
              ├── folder sent as ?query= → ignored, billed to PERSONAL quota
              ├── no folder at all       → billed to PERSONAL quota
              └── genuinely unsponsored  → the only case the message describes
```

## CLI

```bash
PC="${CLAUDE_SKILL_DIR}/scripts/permacc.py"

uv run --script "$PC" status          # who the key is, and whether a sponsored folder exists
uv run --script "$PC" folders         # every folder, with the sponsored one marked
uv run --script "$PC" archive URL... --auto-folder
uv run --script "$PC" archive --from-json inventory.json --out archives.json --auto-folder
```

`--auto-folder` resolves the sponsored folder itself, which is the option to
reach for; `--folder <id>` pins one when an account has several. `--out` makes
the run resumable — already-archived URLs are skipped, so a rate limit or a
network drop costs nothing on the retry.

The key is read from `--api-key`, then `PERMACC_API_KEY`, then
`PERMACC_API_KEY_FILE` (the agenix convention — the environment carries a
*path* to the decrypted secret, not the secret).

## Facts

- **`folder` must be a JSON BODY field, not a query parameter.** `?folder=376861`
  is accepted, silently ignored, billed against the personal quota, and 400s
  once that quota is spent. Verified side by side on one URL against a
  sponsored account: query param → 400, body field → **201**. Nothing in the
  response distinguishes "ignored your folder" from "you are out of links",
  so this reads as a plan problem and sends people to the pricing page.

- **Sponsorship hangs off the FOLDER, not the organization.** `GET
  /v1/organizations/` returned `registrar: None` for an account that was
  already sponsored; the affiliation lives on a folder in `GET /v1/user/`
  carrying `registrar: 16` / `registrar_name: "University of Virginia School
  of Law Arthur J. Morris Law Library"`. Diagnosing a cap from the
  organizations endpoint concludes "not sponsored" about a sponsored account.

- **The folder list is `top_level_folders`, not `folders`.** A wrong key
  returns `[]`, which this skill's own first draft reported as "no sponsored
  folder — ask a registrar to add you." The failure mode of guessing a
  response key here is a confident false negative, not an error.

- **The auth scheme is `ApiKey`, not `Bearer`.** A Bearer header authenticates
  as anonymous and fails later with a permission error rather than a 401, so
  the traceback points at the wrong thing.

- **The free personal tier is 10 links/month.** A cite-check script with no
  folder therefore works for the first ten footnotes and dies on the
  eleventh — the shape of bug that looks like a flaky API.

- **Archiving is not idempotent.** Two POSTs for one URL make two perma links.
  Pass `--out` and let the tool skip what it already has, rather than
  re-running a loop and quietly doubling a manuscript's archive set.

## Red flags — STOP

| Action | Why wrong | Do instead |
|---|---|---|
| About to report "your perma account is out of links" from a 400 | Three causes share that message; only one is a real cap | Run `folders`, then retry with `--auto-folder` |
| About to check sponsorship with `/v1/organizations/` | It reports `registrar: None` for sponsored accounts | Read `top_level_folders` from `/v1/user/` |
| About to pass the folder as `?folder=` | Silently ignored, billed to the personal quota | Send it in the JSON body (the script does) |
| About to loop `requests.post` over a URL list | No resume, no dedupe; a mid-run failure double-archives on retry | `archive --from-json … --out …` |
| About to tell a user to buy a plan | A law library registrar gives faculty unlimited links free | Have them added to the registrar's org first |
| About to paste the key into a script or `.env` | It is a long-lived credential | agenix (see below), read via `PERMACC_API_KEY_FILE` |

## Storing the key

```bash
~/nix/add-api-keys.sh permacc-api-key      # encrypts to ~/nix-secrets, prints the wiring
```

Then in `modules/shared/home-secrets.nix`: an `age.secrets` entry, a
`PERMACC_API_KEY_FILE` session variable, and a `get-permacc-api-key` alias.
`nix-secrets` is a flake input **pinned by revision**, so the secret must be
pushed *and* the lock bumped (`nix flake update nix-secrets`) before a rebuild
can see it.

## Getting a sponsored account

Perma registrars are institutions — mostly law libraries and courts. A faculty
member or student at one gets unlimited links at no cost by asking to be added
to the institution's perma.cc organization. That is the fix for a cap, and it
is usually a single email. Until it lands, `folders` prints `[personal ]` for
every row and every archive spends the 10/month allowance.
