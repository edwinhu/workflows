# CLI Commands Reference

These GCS/gcloud commands are for Gemini Enterprise Agent Platform Cloud batch, not Developer Batch or Developer Flex. SDK/service identifiers keep their historical spelling; current docs: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference.

## GCS Operations

```bash
# Check GCS bucket region
gsutil ls -L -b gs://your-bucket | grep "Location"

# Create bucket in the runbook default region (not a universal restriction)
gsutil mb -l us-central1 gs://your-batch-bucket

# Upload files to GCS
gsutil -m cp -r ./documents/* gs://your-bucket/documents/

# Download results
gsutil -m cp -r gs://your-bucket/batch_outputs/* ./results/
```

## Job Management

```bash
# Use the endpoint actually selected for this Cloud job
CLOUD_LOCATION=global
# List Cloud batch jobs (via gcloud)
gcloud ai batch-predictions list --region="$CLOUD_LOCATION"

# View job details
gcloud ai batch-predictions describe JOB_ID --region="$CLOUD_LOCATION"
```

## JSONL Validation

```bash
python skills/gemini-vertex/scripts/validate_jsonl.py requests.jsonl --backend cloud
# Historical Developer-format validation only; never submit this backend in production:
python skills/gemini-vertex/scripts/validate_jsonl.py requests.jsonl --backend developer
```

## Results Analysis

```bash
# Quick stats on results
python -c "
import json
from collections import Counter
results = []
with open('output.jsonl') as f:
    for line in f:
        data = json.loads(line)
        resp = data.get('response', {})
        candidates = resp.get('candidates', [])
        if candidates:
            reason = candidates[0].get('finishReason', 'UNKNOWN')
        else:
            reason = 'NO_CANDIDATES'
        results.append(reason)
for reason, count in Counter(results).items():
    print(f'{reason}: {count}')
"
```

## GCS Organization

Recommended bucket structure:

```
gs://your-batch-bucket/
├── documents/           # Uploaded source documents
│   ├── batch_001/
│   │   ├── doc1.pdf
│   │   └── doc2.pdf
│   └── batch_002/
├── batch_requests/      # JSONL request files
│   ├── batch_001.jsonl
│   └── batch_002.jsonl
└── batch_outputs/       # API output files
    ├── batch_001/
    │   └── {job_id}_output.jsonl
    └── batch_002/
```
