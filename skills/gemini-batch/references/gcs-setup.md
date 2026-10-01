# GCS operations for Gemini Enterprise Agent Platform batch

These private GCS operations apply to Cloud batch and Cloud synchronous tiers (including Flex PayGo), not Developer Files.

One-time setup — gcloud install, authentication, API enablement and bucket creation — is in [`gcs-setup-runbook.md`](gcs-setup-runbook.md).

## Upload Files to GCS

### Basic Upload

```bash
# Upload single file
gsutil cp local_file.pdf gs://your-batch-bucket/documents/

# Upload directory (recursive)
gsutil -m cp -r ./documents/* gs://your-batch-bucket/documents/

# Upload with parallelism (-m flag for faster uploads)
gsutil -m cp *.pdf gs://your-batch-bucket/documents/
```

### Upload Options

```bash
# Set content type explicitly
gsutil -h "Content-Type:application/pdf" cp file.pdf gs://bucket/

# Keep production objects private; grant required IAM access, not public-read.

# Resume interrupted uploads automatically (default behavior)
gsutil cp large_file.pdf gs://bucket/
```

### Check Upload Status

```bash
# List files in bucket
gsutil ls gs://your-batch-bucket/documents/

# Get file details
gsutil ls -l gs://your-batch-bucket/documents/file.pdf

# Check total size of directory
gsutil du -s gs://your-batch-bucket/documents/
```

## Bucket Permissions

### Service Account Access (Production)

If using service account authentication:

```bash
# Grant storage admin to service account
gsutil iam ch serviceAccount:YOUR-SA@PROJECT.iam.gserviceaccount.com:roles/storage.objectAdmin \
  gs://your-batch-bucket

# For Gemini Enterprise Agent Platform, also grant aiplatform.user
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR-SA@PROJECT.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### User Account Access (Development)

For ADC with your user account:

```bash
# Grant yourself storage admin
gsutil iam ch user:your-email@gmail.com:roles/storage.objectAdmin \
  gs://your-batch-bucket

# Verify permissions
gsutil iam get gs://your-batch-bucket
```

### Minimum Permissions

For batch processing, the account needs:
- `storage.objects.create` - Upload input files
- `storage.objects.get` - Read input files during processing
- `storage.objects.list` - List output files
- `storage.buckets.get` - Verify bucket location

## Python Integration

### Upload Files with google-cloud-storage

```python
from google.cloud import storage
from pathlib import Path

def upload_to_gcs(local_path: str, bucket_name: str, gcs_path: str) -> str:
    """Upload file to GCS.

    Args:
        local_path: Local file path
        bucket_name: GCS bucket name
        gcs_path: Destination path in bucket (e.g., "documents/file.pdf")

    Returns:
        GCS URI (gs://bucket/path)
    """
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(gcs_path)

    blob.upload_from_filename(local_path)

    return f"gs://{bucket_name}/{gcs_path}"


def upload_directory(local_dir: str, bucket_name: str, gcs_prefix: str = "documents") -> list[str]:
    """Upload all files from directory.

    Args:
        local_dir: Local directory path
        bucket_name: GCS bucket name
        gcs_prefix: Prefix for GCS paths

    Returns:
        List of GCS URIs
    """
    client = storage.Client()
    bucket = client.bucket(bucket_name)

    uris = []
    for file_path in Path(local_dir).rglob("*"):
        if file_path.is_file():
            gcs_path = f"{gcs_prefix}/{file_path.name}"
            blob = bucket.blob(gcs_path)
            blob.upload_from_filename(str(file_path))

            uri = f"gs://{bucket_name}/{gcs_path}"
            uris.append(uri)
            print(f"Uploaded: {file_path.name} -> {uri}")

    return uris
```

### Verify Bucket Region

```python
from google.cloud import storage

def verify_bucket_region(bucket_name: str) -> bool:
    """Verify bucket is in us-central1.

    Args:
        bucket_name: GCS bucket name

    Returns:
        True if in us-central1, False otherwise
    """
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    bucket.reload()

    location = bucket.location.lower()
    print(f"Bucket location: {location}")

    if location != "us-central1":
        print(f"❌ ERROR: Bucket must be in us-central1, not {location}")
        return False

    print("✓ Bucket is in us-central1")
    return True
```

## Troubleshooting

### Permission Denied Errors

```bash
# Check current credentials
gcloud auth list

# Re-authenticate if needed
gcloud auth application-default login

# Verify project access
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:user:YOUR_EMAIL"
```

### Bucket Access Errors

```bash
# Test bucket access
gsutil ls gs://your-batch-bucket

# If error, check IAM bindings
gsutil iam get gs://your-batch-bucket
```

### Wrong Region Errors

```bash
# Check bucket location
gsutil ls -L -b gs://your-batch-bucket | grep "Location"

# If wrong region, must create new bucket and copy data
gsutil mb -l us-central1 gs://new-batch-bucket
gsutil -m cp -r gs://old-bucket/* gs://new-batch-bucket/
```

### API Not Enabled

```bash
# Check if Gemini Enterprise Agent Platform API is enabled
gcloud services list --enabled | grep aiplatform

# If not enabled:
gcloud services enable aiplatform.googleapis.com
```

## Best Practices

1. **Use uniform bucket-level access** for simpler permission management
2. **Enable versioning** for production buckets to recover deleted files
3. **Set lifecycle policies** to auto-delete old batch files
4. **Use `-m` flag** with gsutil for parallel uploads (faster)
5. **Verify bucket region** before uploading large datasets
6. **Use workload identity/service-account ADC** for unattended production; user ADC for local development
7. **Keep bucket in same project** as Gemini Enterprise Agent Platform API for simplicity

## Lifecycle Management

Auto-delete old batch files to save costs:

```bash
# Create lifecycle config (lifecycle.json)
cat > lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 30,
          "matchesPrefix": ["batch_outputs/", "batch_requests/"]
        }
      }
    ]
  }
}
EOF

# Apply lifecycle policy
gsutil lifecycle set lifecycle.json gs://your-batch-bucket

# Verify policy
gsutil lifecycle get gs://your-batch-bucket
```

## Cost Optimization

Cloud storage, operations and network rates depend on location, storage class and eligible allowances. Check [current Cloud Storage pricing](https://cloud.google.com/storage/pricing); do not assume all operations or transfers are free, or copy a rate from a different region/class.

Use lifecycle policies to retire completed inputs/outputs according to the project's retention rules, and keep a bucket/endpoint compatible with current Cloud batch requirements. us-central1 is the runbook default, not a universal Batch restriction. Use `gsutil -m` for parallel uploads.

## Resources

- [gsutil Tool Documentation](https://cloud.google.com/storage/docs/gsutil)
- [GCS Locations](https://cloud.google.com/storage/docs/locations)
- [IAM Permissions](https://cloud.google.com/storage/docs/access-control/iam-permissions)
- [Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle)

## Explicit service-account credentials

Prefer workload identity/ADC where available; if the deployment already uses a service-account file, the SDK also accepts credentials explicitly. Keep the file secret and use the existing project’s credential path.

```python
from google import genai
from google.oauth2 import service_account

# Load service account credentials
credentials = service_account.Credentials.from_service_account_file(
    'service-account.json',
    scopes=['https://www.googleapis.com/auth/cloud-platform']
)

# Use with genai library
client = genai.Client(
    vertexai=True,
    project="your-project-id",
    location="global",
    credentials=credentials
)
```
