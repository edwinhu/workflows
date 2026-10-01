# Structured output: keep API shapes separate

Sources: [Interactions structured output](https://ai.google.dev/gemini-api/docs/structured-output.md.txt), [legacy structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output.md.txt), [Batch](https://ai.google.dev/gemini-api/docs/batch-api.md.txt), [May migration](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026.md.txt).

## Interactions

Use `response_format` with type/mime_type/schema, not Interactions `response_mime_type` or the old outputs array. This is the documented shape, with a small application schema:

```python
from google import genai

client = genai.Client()
interaction = client.interactions.create(
    model="gemini-3.8-flash",
    input="Classify this text: the claim is supported by the quoted filing.",
    response_format={
        "type": "text",
        "mime_type": "application/json",
        "schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["SUPPORTED", "UNSUPPORTED"]},
                "explanation": {"type": "string"},
            },
            "required": ["status", "explanation"],
        },
    },
)
```

For Flex add `service_tier="flex"`; for search add `tools=[{"type": "google_search"}]`. Gemini 3 structured output with built-in tools is documented as Preview. Inspect steps and citations even when the final text is schema-valid JSON. Base structured output is not restricted to Gemini 3; current legacy docs also list Gemini 2.5 support.

## Batch (generateContent only)

Copy the current Batch SDK example: each inline request has `contents` and a `config` with `response_mime_type` and `response_schema`. The enclosing create config is a **job** config, not the request's generation config.

```python
from google import genai
from pydantic import BaseModel

class Extraction(BaseModel):
    document_type: str
    dates: list[str]

client = genai.Client()
job = client.batches.create(
    model="gemini-3.5-flash-lite",
    src=[{
        "contents": [{"role": "user", "parts": [{"text": "Extract dates: contract dated 2026-09-30."}]}],
        "config": {
            "response_mime_type": "application/json",
            "response_schema": Extraction,
        },
    }],
    config={"display_name": "schema-smoke-test"},
)
```

File-input requests are raw generateContent requests (`generationConfig`, not SDK inline `config`). Use serializable `responseSchema` for that wire shape; do not put Python classes into JSONL. Run an end-to-end sample to verify enforcement. Current docs do not establish a universal `responseJsonSchema` ban across all Batch transports; use the documented pattern rather than a categorical unsupported claim.

Historical Batch+tools requests returned per-row error code 3, `Tool use with a response mime type: 'application/json' is unsupported`. Treat that as an observed backend/model limitation, not an Interactions prohibition. If reproduced, omit the incompatible Batch schema/tool combination or use Flex for grounded lookups; do not silently accept every row of a succeeded job.

## Schema and acceptance

Gemini supports a subset of JSON Schema: object/properties/required, arrays/items, scalar types, enums and supported constraints. Check the current doc for nullable/union support rather than turning an old OpenAPI nullable workaround into a universal rule. Use descriptions and small schemas; very large/deep schemas may be rejected.

Parse JSON, validate required fields/types/enums, then check business logic and source evidence. Do not parse an empty response as `{}` and call it success. Batch raw responses use candidates/content/parts; Interactions uses output_text and typed steps. Join parts and discard thoughts where applicable; inspect per-row errors and finish reasons first.

## Schema Types

Supported JSON Schema subset: `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`.

### enum (classification)

```typescript
status: { type: "string", enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"] }
```

### Nested objects

```typescript
{
  type: "object",
  properties: {
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
        },
        required: ["name", "quantity"],
      },
    },
  },
}
```

### Legacy response extraction helper

Check row errors/finishReason before this helper. It accepts hydrated generateContent responses and raw candidate JSON; it is not an Interactions parser.

```typescript
function extractResponseText(response: any): string {
  if (!response) return "";
  // Hydrated class instance (sequential mode)
  if (typeof response.text === "string") return response.text;
  // Raw JSON (batch mode) -- join all text parts
  const parts = response.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.filter((p: any) => typeof p.text === "string" && !p.thought)
      .map((p: any) => p.text).join("");
  }
  return "";
}
```

### Streaming

Concatenate streamed partial JSON strings before parsing/validating the complete object; individual fragments need not be valid JSON.
