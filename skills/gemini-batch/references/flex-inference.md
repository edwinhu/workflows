# Cloud Flex and Priority PayGo

Production uses Gemini Enterprise Agent Platform, ADC and an explicit `vertexai=True` client. **NEVER use Developer Interactions Flex/Priority for production.** Cloud has its own documented equivalents; do not copy Developer `service_tier` or quotas.

Sources checked 2026-10-01: [Cloud Flex](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo), [Cloud Priority](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/priority-paygo), [Cloud Search](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search), [Cloud pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

## Synchronous Cloud request

Flex PayGo is Preview, global-only, 50% off Standard, with higher throttling and longer latency. Timeout can be up to 30 minutes. For bulk use Cloud Batch rather than a synchronous Flex queue. Priority supports global and model-supported us/eu multi-regions, not regional endpoints; prices are higher and model-specific.

```python
from google import genai
from google.genai import types

client = genai.Client(
    vertexai=True, project="your-project-id", location="global",
    http_options=types.HttpOptions(
        api_version="v1", timeout=900000,
        headers={"X-Vertex-AI-LLM-Shared-Request-Type": "flex"},
    ),
)
response = client.models.generate_content(
    model="gemini-3.8-flash",
    contents="Search NOW for current sources that establish who founded Airbnb. Cite them.",
    config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]),
)
```

For Priority use header value `priority`, not Developer `service_tier`. These headers can use available Provisioned Throughput first; the Cloud docs also document headers for routing exclusively to PayGo when that distinction matters. Inspect the documented mode before assuming billing/capacity.

Cloud generateContent grounding is in `response.candidates[].grounding_metadata` (raw wire `groundingMetadata`), including web search queries, chunks/supports and Search Suggestions. Developer Interactions `steps`/`url_citation` is a different response shape. Validate citations/source evidence, not merely a configured tool or a nonempty answer. Follow Cloud Grounding terms when displaying responses.

Retry capacity errors with bounded backoff/jitter and preserve successful rows plus row errors. Keep one client; no silent full-price Standard fallback. A copyright/recitation refusal is not a capacity retry. Bound concurrency by actual Cloud capacity rather than the Developer queue-token cap.

## Measured evidence and limits

**Developer API measurements, not Cloud results:** 2026-09-30 founder lookups on 3.8 Flash: Batch JSON 0/138 grounded, Batch markdown 2/10, synchronous Standard markdown 92/138. Batch did ground a short CEO question 3/3, so the tool is not universally disabled.

The 10-row Flex test had **8/8 successful calls grounded, all returned tier=flex**. Successful latency including retries was **5–377 s**. The user reports **2/10 HTTP 400 refusals**, `Request blocked due to copyright/recitation content`; the saved report recovered eight successes and one unassigned 400, so it does not independently identify both failed rows. Handle refusals per row, preserve successes and continue independent rows. The report ended `FLEX: 8/10 skipped`; the **138-row pilot did not finish**. Do not present this as a full-pilot quality estimate. Full answers/citation annotations and input/output token splits were not recovered.

The eight responses emitted 134 queries, **about 17 searches per successful row**. Search is billed at **$14/1,000 after 5,000 free/month** shared across Gemini 3.x; token discounts do not discount search. At that observed query rate, search alone would be about $0.24/row once the allowance is exhausted, not a measured total row cost. **Cap search effort in the prompt**, for example: “Use at most 3 search queries; if evidence is still insufficient, return unknown rather than continuing to search.” A prompt cap is not an enforced API quota: count emitted queries and budget actual usage.

Evidence: the interrupted run’s `scratchpad/gold-expand/flex-report.md`, the user’s resume measurements, and `/home/eh/.claude/projects/workflows/memory/gemini-batch-no-search-grounding.md`.

Later Developer measurements: fresh framing (“Search NOW for current pages… report what they say TODAY”) grounded 10/10, 1.9 searches/row. At peak Developer Flex returned 503 high demand and about 9 rows/hour. These do not establish Cloud capacity or Cloud batch/tool compatibility; test the exact Cloud route.
