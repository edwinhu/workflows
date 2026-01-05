# CLI Commands Reference

Quick reference for command-line operations with Gemini Batch API.

## GCS Operations

```bash
# Check GCS bucket region
gsutil ls -L -b gs://your-bucket | grep "Location"

# Create bucket in correct region
gsutil mb -l us-central1 gs://your-batch-bucket

# Upload files to GCS
gsutil -m cp -r ./documents/* gs://your-bucket/documents/

# Download results
gsutil -m cp -r gs://your-bucket/batch_outputs/* ./results/
```

## Job Management

```bash
# List batch jobs (via gcloud)
gcloud ai batch-predictions list --region=us-central1

# View job details
gcloud ai batch-predictions describe JOB_ID --region=us-central1
```

## JSONL Validation

```bash
# Count lines in JSONL
wc -l batch_requests.jsonl

# Validate JSONL syntax
python -c "
import json
import sys
with open('batch_requests.jsonl') as f:
    for i, line in enumerate(f, 1):
        try:
            json.loads(line)
        except:
            print(f'Error line {i}')
            sys.exit(1)
print('Valid JSONL')
"
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
