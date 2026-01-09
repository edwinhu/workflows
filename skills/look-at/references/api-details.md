# Gemini API Details for Look At

## API Configuration

The look_at skill uses the new unified Google Generative AI Python SDK (`google-genai`) to interact with Gemini models.

### Authentication

```python
from google import genai

api_key = os.environ.get("GOOGLE_API_KEY")
client = genai.Client(api_key=api_key)
```

**Get your API key:** https://makersuite.google.com/app/apikey

### File Upload

```python
# Upload local file
with open(file_path, 'rb') as f:
    uploaded_file = client.files.upload(file=f, config={'mime_type': mime_type})

# Use in generation
response = client.models.generate_content(
    model="gemini-2.5-flash-lite",
    contents=[uploaded_file, prompt]
)

# Clean up
client.files.delete(name=uploaded_file.name)
```

## Model Selection

### Gemini 2.5 Flash Lite (Default)
- **Best for:** Most use cases, fastest response, lowest cost
- **Strengths:** Fast multimodal analysis, good for images/PDFs
- **Limitations:** May miss subtle details in complex documents
- **Cost:** ~50% cheaper than Flash

### Gemini 3 Flash
- **Best for:** More complex extraction tasks
- **Strengths:** Better accuracy, handles nuanced requests
- **Limitations:** Slightly slower and more expensive
- **Cost:** Standard pricing

### Gemini 3 Pro
- **Best for:** Highest accuracy requirements
- **Strengths:** Best for complex reasoning, large documents
- **Limitations:** Slower, more expensive
- **Cost:** ~3-4x more than Flash Lite

## Supported MIME Types

### Images
- `image/jpeg` (.jpg, .jpeg)
- `image/png` (.png)
- `image/webp` (.webp)
- `image/heic` (.heic, .heif)
- `image/gif` (.gif)

### Videos
- `video/mp4` (.mp4)
- `video/mpeg` (.mpeg, .mpg)
- `video/mov` (.mov)
- `video/avi` (.avi)
- `video/webm` (.webm)

### Audio
- `audio/wav` (.wav)
- `audio/mp3` (.mp3)
- `audio/aiff` (.aiff)
- `audio/aac` (.aac)
- `audio/ogg` (.ogg)
- `audio/flac` (.flac)

### Documents
- `application/pdf` (.pdf)
- `text/plain` (.txt)
- `text/csv` (.csv)
- `text/markdown` (.md)
- `text/html` (.html, .htm)

## Rate Limits

**Standard API Limits:**
- 60 requests per minute
- 1,000 requests per day (free tier)
- 10,000 requests per day (paid tier)

**File Upload Limits:**
- Max file size: 20MB (Flash Lite)
- Max file size: 50MB (Flash/Pro)
- Files are automatically deleted after processing

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `GOOGLE_API_KEY not set` | Missing API key | Set environment variable |
| `File not found` | Invalid file path | Use absolute paths |
| `Invalid MIME type` | Unsupported format | Convert to supported format |
| `Rate limit exceeded` | Too many requests | Add retry with backoff |
| `File too large` | Exceeds size limit | Compress or split file |

### Retry Logic Example

```python
import time

def analyze_with_retry(file_path, goal, max_retries=3):
    for attempt in range(max_retries):
        try:
            return analyze_file(file_path, goal)
        except Exception as e:
            if "rate limit" in str(e).lower() and attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff
                print(f"Rate limit hit, waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise
```

## Best Practices

### 1. Specific Goals
**Bad:** "Analyze this document"
**Good:** "Extract the revenue figure for Q4 2023"

### 2. Absolute Paths
```python
# Bad
analyze_file("./report.pdf", "Extract title")

# Good
analyze_file("/home/user/documents/report.pdf", "Extract title")
```

### 3. File Cleanup
Always clean up uploaded files, even on errors:
```python
try:
    response = model.generate_content([uploaded_file, prompt])
finally:
    genai.delete_file(uploaded_file.name)
```

### 4. Cost Optimization
- Use Flash Lite for most tasks
- Be specific in goals to minimize output tokens
- Batch similar requests together
- Cache frequently analyzed files

## Performance Benchmarks

**Typical Response Times:**
- Small PDF (1-5 pages): 2-5 seconds
- Medium PDF (10-20 pages): 5-10 seconds
- Image (< 5MB): 1-3 seconds
- Large PDF (50+ pages): 15-30 seconds

**Token Usage:**
- Input: ~265 tokens per uploaded image
- Input: ~1,000 tokens per PDF page (approximate)
- Output: Varies by goal specificity

## External Resources

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Python SDK Reference](https://ai.google.dev/api/python/google/generativeai)
- [File API Guide](https://ai.google.dev/gemini-api/docs/vision)
- [Pricing Information](https://ai.google.dev/pricing)
