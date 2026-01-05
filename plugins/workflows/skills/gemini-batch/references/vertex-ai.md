# Vertex AI Alternative

For enterprise deployments, consider Vertex AI Batch Prediction as an alternative to the standard Gemini Batch API.

## Comparison

| Feature | Gemini API Batch | Vertex AI Batch |
|---------|------------------|-----------------|
| Setup | API key | Service account + project |
| Regions | us-central1 only | Multiple regions |
| Quotas | Standard | Customizable |
| VPC Support | No | Yes |
| Logging | Basic | Cloud Logging integration |
| Cost | Standard | Volume discounts available |

## When to Use Vertex AI

- Enterprise deployments with VPC requirements
- Need for custom quotas
- Multi-region processing
- Integration with existing GCP infrastructure
- Advanced logging and monitoring needs

## Example

```python
from google.cloud import aiplatform
from datetime import datetime

def submit_vertex_batch(
    project: str,
    location: str,
    input_uri: str,
    output_uri: str,
    model: str = "gemini-1.5-flash"
) -> aiplatform.BatchPredictionJob:
    """Submit batch job via Vertex AI.

    Args:
        project: GCP project ID
        location: GCP region
        input_uri: GCS input JSONL URI
        output_uri: GCS output prefix
        model: Model resource name

    Returns:
        BatchPredictionJob object
    """
    aiplatform.init(project=project, location=location)

    job = aiplatform.BatchPredictionJob.create(
        model_name=f"publishers/google/models/{model}",
        job_display_name=f"batch-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
        gcs_source=input_uri,
        gcs_destination_prefix=output_uri,
        sync=False
    )

    return job
```

## Setup Requirements

1. Enable Vertex AI API in GCP Console
2. Create service account with appropriate roles:
   - `roles/aiplatform.user`
   - `roles/storage.objectAdmin`
3. Configure authentication:
   ```bash
   gcloud auth application-default login
   # or
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   ```

## Resources

- [Vertex AI Batch Prediction](https://cloud.google.com/vertex-ai/docs/predictions/batch-predictions)
- [Vertex AI Pricing](https://cloud.google.com/vertex-ai/pricing)
