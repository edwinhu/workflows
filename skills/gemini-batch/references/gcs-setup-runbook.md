# GCP setup runbook (Cloud batch)

- **Run the whole thing (a human, once):** `GCP_PROJECT=.. BUCKET=.. upmd --cli --all skills/gemini-batch/references/gcs-setup-runbook.md` — every block is idempotent, so a re-run skips what is done and ends on `verify`. `upmd <file>` opens the TUI instead.
- **Agents check setup:** `LINES=1000 COLUMNS=250 GCP_PROJECT=.. BUCKET=.. upmd --ci --block verify skills/gemini-batch/references/gcs-setup-runbook.md`; if it fails, hand the user the whole-thing command above.
- **Agents never run `manual-*` blocks** — they are interactive logins; hand them to the user.
- **Without upmd** these are plain bash blocks: run `verify` by hand.

This Cloud GCS batch path uses ADC (`gcloud auth application-default login`), project and IAM; it is not Developer API-key setup. The product is Gemini Enterprise Agent Platform; `aiplatform.googleapis.com` remains its service identifier.
The runbook defaults `BUCKET_LOCATION` to us-central1. Select a supported Cloud endpoint separately (global for base Gemini models, regional for residency); this is not a universal us-central1-only rule. See [Cloud batch docs](https://cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-prediction-gemini).

## Prerequisites — install gcloud

On macOS install via nix-darwin (`~/nix/`), not brew.

```bash [name:manual-install-gcloud]
command -v gcloud >/dev/null 2>&1 || { echo "Install gcloud through the system package configuration first"; exit 1; }
gcloud --version  # a fresh install needs a new shell before gcloud is on PATH
```

## Authentication

### Step 1: user credentials

```bash [name:manual-login]
: "${GCP_PROJECT:?set GCP_PROJECT}"
gcloud auth login
gcloud config set project "$GCP_PROJECT"
```

### Step 2: Application Default Credentials

The Cloud `google-genai` client reads ADC; the gcloud CLI reads the user credentials from Step 1.

```bash [name:manual-adc]
gcloud auth application-default login
# writes ~/.config/gcloud/application_default_credentials.json
```

## Enable Required APIs

```bash [name:enable-apis]
: "${GCP_PROJECT:?set GCP_PROJECT}"
gcloud services enable storage-api.googleapis.com --project "$GCP_PROJECT"
gcloud services enable aiplatform.googleapis.com --project "$GCP_PROJECT"
```

## Create GCS Bucket

Choose the intended bucket location before creation; for a residency-sensitive job verify the regional endpoint and data-location requirements against current Cloud docs.

```bash [name:create-bucket, deps:"enable-apis"]
: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${BUCKET:?set BUCKET}"
gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1 || gsutil mb -p "$GCP_PROJECT" -l "${BUCKET_LOCATION:-us-central1}" "gs://$BUCKET"
gsutil uniformbucketlevelaccess set on "gs://$BUCKET"
```

## Verify

```bash [name:verify]
: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${BUCKET:?set BUCKET}"
set -u

command -v gcloud >/dev/null 2>&1 || { echo "FAIL: gcloud not on PATH — run manual-install-gcloud"; exit 1; }

active=$(gcloud config get-value project 2>/dev/null)
[ "$active" = "$GCP_PROJECT" ] || { echo "FAIL: active project '$active' != GCP_PROJECT '$GCP_PROJECT' — run manual-login"; exit 1; }

gcloud auth application-default print-access-token >/dev/null 2>&1 || { echo "FAIL: no working ADC — run manual-adc"; exit 1; }

enabled=$(gcloud services list --enabled --project "$GCP_PROJECT" --format="value(config.name)" 2>/dev/null)
for api in storage-api.googleapis.com aiplatform.googleapis.com; do
  printf '%s\n' "$enabled" | grep -qx "$api" || { echo "FAIL: $api not enabled — run enable-apis"; exit 1; }
done

loc=$(gsutil ls -L -b "gs://$BUCKET" 2>/dev/null | sed -n 's/.*Location constraint:[[:space:]]*//p' | head -1)
[ -n "$loc" ] || { echo "FAIL: bucket gs://$BUCKET not readable — run create-bucket"; exit 1; }
expected=$(printf '%s' "${BUCKET_LOCATION:-us-central1}" | tr '[:lower:]' '[:upper:]')
[ "$loc" = "$expected" ] || { echo "FAIL: bucket gs://$BUCKET is in $loc, configured location is $expected"; exit 1; }

echo "OK: gcloud, project $GCP_PROJECT, ADC, APIs, gs://$BUCKET in $loc"
```
