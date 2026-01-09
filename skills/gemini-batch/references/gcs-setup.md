# GCS Bucket Setup for Gemini Batch API

Complete guide to setting up Google Cloud Storage for batch processing.

## Prerequisites

Install gcloud SDK:
```bash
# macOS (via Homebrew)
brew install google-cloud-sdk

# Linux (via package manager)
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Verify installation
gcloud --version
```

## Authentication

### Step 1: User Authentication

```bash
# Login to your Google account
gcloud auth login

# Set project
gcloud config set project YOUR_PROJECT_ID

# Verify current project
gcloud config get-value project
```

### Step 2: Application Default Credentials (ADC)

**CRITICAL:** Vertex AI requires ADC, not just user credentials.

```bash
# Set up ADC for local development
gcloud auth application-default login

# This creates credentials at:
# ~/.config/gcloud/application_default_credentials.json
```

**Why both?**
- `gcloud auth login`: For gcloud CLI commands (gsutil, gcloud services)
- `gcloud auth application-default login`: For Python libraries (google-generativeai, vertexai)

## Enable Required APIs

```bash
# Enable Cloud Storage API
gcloud services enable storage-api.googleapis.com

# Enable Vertex AI API (required for vertexai=True)
gcloud services enable aiplatform.googleapis.com

# Verify enabled services
gcloud services list --enabled | grep -E "(storage|aiplatform)"
```

## Create GCS Bucket

### us-central1 Requirement

**CRITICAL:** Gemini Batch API only works with buckets in `us-central1`.

```bash
# Create bucket in correct region
gsutil mb -l us-central1 gs://your-batch-bucket

# Set uniform bucket-level access (recommended)
gsutil uniformbucketlevelaccess set on gs://your-batch-bucket

# Verify bucket location
gsutil ls -L -b gs://your-batch-bucket | grep "Location"
# Should show: Location constraint: US-CENTRAL1
```

### Why us-central1?

- Batch API service runs in us-central1
- Cross-region access causes latency and errors
- Moving existing buckets is not supported (must copy data)

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

# Upload with public-read ACL (not recommended for sensitive data)
gsutil cp -a public-read file.pdf gs://bucket/

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

# For Vertex AI, also grant aiplatform.user
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
# Check if Vertex AI API is enabled
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
6. **Use service accounts** for production, ADC for development
7. **Keep bucket in same project** as Vertex AI API for simplicity

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

Storage costs for batch processing:

- **Storage:** $0.020/GB/month (us-central1)
- **Operations:** Free (Class A: 5K free per month)
- **Egress:** Free within us-central1

Tips:
- Delete input files after successful processing
- Use lifecycle policies for automatic cleanup
- Keep buckets in us-central1 to avoid cross-region transfer costs
- Use `gsutil -m` for faster uploads (parallelism)

## Resources

- [gsutil Tool Documentation](https://cloud.google.com/storage/docs/gsutil)
- [GCS Locations](https://cloud.google.com/storage/docs/locations)
- [IAM Permissions](https://cloud.google.com/storage/docs/access-control/iam-permissions)
- [Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle)
