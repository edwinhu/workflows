# Gemini Structured Output Reference

> **Official docs:** https://ai.google.dev/gemini-api/docs/structured-output.md.txt
> **SDK:** `@google/genai` (TypeScript) / `google-genai` (Python)
> **Last verified:** April 2026
> **Requires:** Gemini 3 series models

## Overview

Structured output guarantees syntactically valid JSON matching a provided schema. The SDK offers two schema mechanisms with different batch compatibility.

## Two Schema Mechanisms

The SDK has two schema fields — they are NOT interchangeable:

| Field | Format | Sequential | Batch | Notes |
|-------|--------|-----------|-------|-------|
| `responseSchema` | OpenAPI 3.0 Schema (`type: "OBJECT"`, uppercase) | Works | Should work | Native Gemini format |
| `responseJsonSchema` | JSON Schema (`type: "object"`, lowercase) | Works | **Silently ignored** | Alternative format |

**For batch mode, do NOT use `responseJsonSchema`.** Use one of:
1. `responseSchema` with OpenAPI types (untested in batch but matches API docs)
2. `responseMimeType: "application/json"` + prompt-based instructions (proven pattern)

### Proven Batch Pattern (from production)

```typescript
// Batch inline request — NO schema field, prompt instructs JSON format
{
  contents: [{
    parts: [{
      text: prompt + `\n\nYou MUST respond with ONLY a JSON object in this exact format, no other text:\n{"status": "SUPPORTED", "supporting_passage": "exact quote", "explanation": "reason"}\nstatus must be one of: SUPPORTED, PARTIAL, UNSUPPORTED`
    }],
    role: "user",
  }],
  config: {
    responseMimeType: "application/json",
    // NO responseJsonSchema — batch API ignores it
  },
}
```

This pattern works reliably in production (cite-check, activist_defense).

## Basic Usage

```typescript
const response = await client.models.generateContent({
  model: "gemini-3.1-flash-lite-preview",
  contents: "Classify this text...",
  config: {
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["SUPPORTED", "PARTIAL", "UNSUPPORTED"],
          description: "Classification result",
        },
        explanation: {
          type: "string",
          description: "Brief reasoning",
        },
      },
      required: ["status", "explanation"],
    },
  },
});

const parsed = JSON.parse(response.text ?? "{}");
```

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

## Tool Compatibility

Structured output works with: File Search, Google Search, URL Context, Code Execution, Function Calling.

## Batch vs Sequential Differences

### Schema Enforcement

| Mode | `responseJsonSchema` | `responseMimeType` + prompt | Result |
|------|---------------------|----------------------------|--------|
| Sequential (`generateContent`) | Enforced | Also works | Guaranteed JSON |
| Batch (`batches.create`) | **Silently ignored** | Works | JSON if prompt is explicit |

**Sequential mode:** Use `responseJsonSchema` freely — the API enforces it.

**Batch mode:** Use `responseMimeType: "application/json"` + explicit prompt instructions. Add a heuristic fallback parser for edge cases where the model still returns free-text.

### Response Extraction

**CRITICAL: Batch API returns raw JSON objects, not hydrated class instances.**

### Sequential Mode (generateContent)

```typescript
// response is a GenerateContentResponse CLASS with .text getter
const response = await client.models.generateContent({ ... });
const text = response.text; // works -- .text is a getter on the class
```

### Batch Mode (batches.create -> batches.get)

```typescript
// inlinedResponse.response is RAW JSON -- no .text getter!
const text = inlinedResponse.response?.text; // undefined!

// Must extract from candidates array:
const parts = inlinedResponse.response?.candidates?.[0]?.content?.parts;
const text = parts?.filter(p => typeof p.text === "string").map(p => p.text).join("");
```

### Universal Extraction Helper

Use this for code that handles both sequential and batch responses:

```typescript
function extractResponseText(response: any): string {
  if (!response) return "";
  // Hydrated class instance (sequential mode)
  if (typeof response.text === "string") return response.text;
  // Raw JSON (batch mode) -- join all text parts
  const parts = response.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.filter((p: any) => typeof p.text === "string")
      .map((p: any) => p.text).join("");
  }
  return "";
}
```

## Streaming

Streamed chunks produce valid partial JSON strings that concatenate to form the complete object.

## Limitations

- Guarantees syntactic correctness only -- values may be semantically wrong
- Available only for Gemini 3 series models
- Schema must use supported type subset (no $ref, no oneOf, etc.)
- `responseJsonSchema` is silently ignored in batch mode — use `responseMimeType` + prompt instructions
- Batch responses are raw JSON objects, not hydrated class instances (no `.text` getter)
- Combining fileSearch tool + structured output in batch mode may not enforce the schema
