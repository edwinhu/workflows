# Flex inference with Interactions and Google Search

Sources: [Flex](https://ai.google.dev/gemini-api/docs/flex-inference.md.txt), [Search](https://ai.google.dev/gemini-api/docs/google-search.md.txt), [May schema migration](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026.md.txt), [pricing](https://ai.google.dev/gemini-api/docs/pricing.md.txt). Checked 2026-09-30. Flex is Preview; Interactions itself is GA and recommended for new development.

## Minimal request

The request combines the exact documented Flex `service_tier` and Search `tools` shapes. It uses one shared `google-genai` client with the documented 900,000 ms timeout. Flex is synchronous (target 1–15 minutes), even if a caller runs independent requests concurrently.

```python
from google import genai

client = genai.Client(http_options={"timeout": 900000})
interaction = client.interactions.create(
    model="gemini-3.8-flash",
    input="Who founded Airbnb? Cite reliable sources.",
    tools=[{"type": "google_search"}],
    service_tier="flex",
)
print(interaction.output_text)
```

Do not add temperature, top_p or top_k. If using structured JSON, use Interactions `response_format` from [structured-output.md](structured-output.md); do not add legacy `response_mime_type` or `generationConfig`. The May 2026 schema replaced `outputs` with `steps` and consolidated output controls into `response_format`.

## Capacity retries using the same client

429 and 503 are documented Flex capacity/rate-limit errors. Use bounded exponential backoff with jitter; never automatically pay for Standard fallback. This wrapper is application retry logic, not a different API request shape.

```python
import random
import time
from google.genai import errors


def flex_lookup(prompt, max_attempts=6):
    for attempt in range(max_attempts):
        try:
            return client.interactions.create(
                model="gemini-3.8-flash",
                input=prompt,
                tools=[{"type": "google_search"}],
                service_tier="flex",
            )
        except errors.APIError as exc:
            if int(exc.code) not in (429, 503) or attempt == max_attempts - 1:
                raise
            time.sleep(min(120, 2 ** attempt) + random.uniform(0, 1))
```

Keep concurrency bounded by general project/model quotas: Flex does **not** receive Batch's expanded limits. Persist each completed row's response/metadata and each failed row's error in the existing job/result store, not only in memory. A terminal exception must not erase earlier successes. A 400 copyright/recitation error is not a capacity retry; log it as a failed row and continue other independent rows. Do not silently change the required prompt.

## Read grounding from Interactions steps

There is no legacy `candidates[0].groundingMetadata` in this response shape. Search calls and results are observable steps; citations are annotations on model-output text blocks. Preserve both rather than equating a configured tool with grounded evidence.

```python
queries = []
citations = []
for step in interaction.steps:
    if step.type == "google_search_call":
        queries.extend(step.arguments.queries)
    if step.type == "model_output":
        for content_block in step.content:
            if content_block.type == "text" and content_block.annotations:
                for annotation in content_block.annotations:
                    if annotation.type == "url_citation":
                        citations.append({
                            "url": annotation.url,
                            "title": annotation.title,
                            "text": content_block.text[
                                annotation.start_index:annotation.end_index
                            ],
                        })
searched = bool(queries)
grounded_with_citations = searched and bool(citations)
```

`google_search_result.result[].search_suggestions` carries the Search Suggestions HTML. Follow Google's [grounding terms](https://ai.google.dev/gemini-api/terms#grounding-with-google-search) when displaying responses. A search query proves tool execution, not that the answer's claim is correct; validate citations against the required evidence. Store ungrounded rows as failures or route them for explicit review, not accepted facts.

## Measured evidence and limits

2026-09-30 founder lookups on 3.8 Flash: Batch JSON 0/138 grounded, Batch markdown 2/10, synchronous Standard markdown 92/138. Batch did ground a short CEO question 3/3, so the tool is not universally disabled.

The 10-row Flex test had **8/8 successful calls grounded, all returned tier=flex**. Successful latency including retries was **5–377 s**. The user reports **2/10 HTTP 400 refusals**, `Request blocked due to copyright/recitation content`; the saved report recovered eight successes and one unassigned 400, so it does not independently identify both failed rows. Handle refusals per row, preserve successes and continue independent rows. The report ended `FLEX: 8/10 skipped`; the **138-row pilot did not finish**. Do not present this as a full-pilot quality estimate. Full answers/citation annotations and input/output token splits were not recovered.

The eight responses emitted 134 queries, **about 17 searches per successful row**. Search is billed at **$14/1,000 after 5,000 free/month** shared across Gemini 3.x; token discounts do not discount search. At that observed query rate, search alone would be about $0.24/row once the allowance is exhausted, not a measured total row cost. **Cap search effort in the prompt**, for example: “Use at most 3 search queries; if evidence is still insufficient, return unknown rather than continuing to search.” A prompt cap is not an enforced API quota: count emitted queries and budget actual usage.

Evidence: the interrupted run’s `scratchpad/gold-expand/flex-report.md`, the user’s resume measurements, and `/home/eh/.claude/projects/workflows/memory/gemini-batch-no-search-grounding.md`.
