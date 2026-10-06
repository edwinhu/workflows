# Structured output for Vertex batch

Production uses Vertex (`vertexai=True`, ADC, GCS), never Developer inline/Files batches or Interactions Flex. Cloud [schema reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output). See [Cloud batch](vertex-ai.md) and the [GCS request format](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-cloud-storage).

## Batch GenerateContentRequest

Cloud JSONL requests use wire-format `generationConfig`, not SDK inline `config` or Interactions `response_format`. Serialize the schema as JSON, never a Python class in JSONL. The enclosing SDK create config is a **job** config, not the request's generation config.

```json
{"request":{"contents":[{"role":"user","parts":[{"text":"Extract dates: contract dated 2026-09-30."}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":{"type":"OBJECT","properties":{"dates":{"type":"ARRAY","items":{"type":"STRING"}}},"required":["dates"]}}}}
```

After uploading that JSONL with GCS tooling:

```python
from google import genai

client = genai.Client(vertexai=True, project="your-project-id", location="global")
job = client.batches.create(
    model="publishers/google/models/gemini-3.5-flash-lite",
    src="gs://your-bucket/requests.jsonl",
    config={"display_name": "schema-pilot", "dest": "gs://your-bucket/outputs/"},
)
```

Run a 5–10-row same-model batch to verify schema enforcement and identity recovery. Historical Developer Batch+tools rows returned code 3, `Tool use with a response mime type: 'application/json' is unsupported`; that observation is not proof of Vertex behavior. If reproduced on Vertex, retest a documented compatible request shape or stop, never switch to Developer Flex. For the first grounded pilot, omit responseMimeType and inspect actual tool execution/citations before adding schema constraints. See [gotchas](gotchas.md).

## Schema and acceptance

The documented Cloud responseSchema supports a schema subset: object/properties/required, arrays/items, scalar types, enums and supported constraints. Check the current doc for nullable/union support rather than turning an old OpenAPI nullable workaround into a universal rule. Use descriptions and small schemas; very large/deep schemas may be rejected.

Parse JSON, validate required fields/types/enums, then check business logic and source evidence. Do not parse an empty response as `{}` and call it success. Batch raw responses use candidates/content/parts; Interactions uses output_text and typed steps. Join parts and discard thoughts where applicable; inspect per-row errors and finish reasons first.

## Schema Types

Use documented Cloud responseSchema types and `nullable: true` for nullable values; do not transplant Developer union/null recipes. For example: `{"type":"STRING","nullable":true}`.

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
