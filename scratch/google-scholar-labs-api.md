# Google Scholar Labs Search API - Reverse Engineering Notes

## Architecture

- **Frontend**: Closure-compiled JS app (single 65KB inline `<script>`)
- **Backend**: Google server (returns `application/octet-stream` streaming response)
- **Protocol**: Binary-framed streaming JSON over a single POST request (not WebSocket/SSE)
- **Auth**: Standard Google cookies (SID, SAPISID, SIDCC, etc.)

## Authentication

- Google session cookies (httpOnly, set by Google sign-in)
- XSRF token from `data-dsp` attribute on `#gs_as_glb` element
- Institution ID from URL param `inst=<id>` (optional, for university library access)

## API Endpoints

Base URL: `https://scholar.google.com`

### New Session Query (first question)
```
POST /scholar_labs/search/session_data?hl=en&xsrf=<XSRF_TOKEN>
Content-Type: application/x-www-form-urlencoded
Cookie: SID=...; SAPISID=...; (standard Google auth cookies)

Body: q=<url-encoded+query>

Response: application/octet-stream (binary-framed streaming JSON)
```

The response's first JSON message contains the new session ID in field `i`.
Client then navigates to `/scholar_labs/search/session/{sessionId}`.

### Follow-up Query (within existing session)
```
POST /scholar_labs/search/session_data/{sessionId}?hl=en&xsrf=<XSRF_TOKEN>
Content-Type: application/x-www-form-urlencoded
Cookie: (same)

Body: q=<url-encoded+follow-up+query>

Response: (same streaming format)
```

### Example Query (for example questions)
```
POST /scholar_labs/search/example_data/{sessionId}?hl=en&xsrf=<XSRF_TOKEN>
```

### Other Discovered Paths
- `/scholar_labs/search` - Homepage (new session)
- `/scholar_labs/search/session/{sessionId}` - Session page
- `/scholar_labs/search/example/{id}` - Example question page
- `/scholar_labs/search/join_waitlist` - Waitlist signup

## Response Format

### Binary Framing

The response is `application/octet-stream` with binary-framed JSON chunks:
- 4 bytes: length prefix (big-endian uint32)
- N bytes: JSON payload

Multiple chunks are streamed as results arrive.

### Streaming Message Schema

Each JSON chunk has this structure:

```typescript
interface StreamMessage {
  i: string;       // Session ID (numeric string, e.g. "4185180210918898075")
  m: boolean;      // ? (always true)
  n: number;       // Turn number within session (1-based)
  s: number;       // State enum (see below)
  t: Turn[];       // Array of turns (usually 0 or 1 items)
  tl: boolean;     // ? (always false observed)
  y: number;       // ? (always 1 observed)
}

// Individual result HTML chunks use a different format:
interface ResultMessage {
  h: string;       // HTML of a single search result card
  i: number;       // Result position/index (0-based)
}
```

### State Enum (`s` field)

| Value | Meaning |
|-------|---------|
| 1 | Complete / idle |
| 2 | Analyzing question |
| 3 | Searching / evaluating results |

### Turn Schema

```typescript
interface Turn {
  a: boolean;      // Active (true while processing, false when done)
  e: boolean;      // Error flag
  f: ResultMsg[];  // Findings - HTML result cards as {h, i} objects
  i: number;       // Turn index (0-based)
  ne: boolean;     // ?
  q?: string;      // Query text (present in early messages)
  qr: boolean;     // Query refined flag
  s?: string;      // Status text (e.g. "Analyzing your question", "Running 12 queries", "Found 10 relevant results")
}
```

### Result HTML Structure

Each finding (`f[n]`) contains `{h: "<html>", i: position}`.
The HTML is a complete Scholar result card:

```html
<div class="gs_r gs_or gs_scl"
     data-cid="BKeR2rt3wyMJ"   <!-- Cluster ID -->
     data-did="BKeR2rt3wyMJ"   <!-- Document ID -->
     data-lid=""               <!-- Library ID -->
     data-aid="BKeR2rt3wyMJ"   <!-- Article ID -->
     data-rp="0">              <!-- Result position -->
  <div class="gs_ggs">...</div>  <!-- PDF/source links -->
  <div class="gs_ri">
    <h3 class="gs_rt"><a href="...">Title</a></h3>
    <div class="gs_a">Authors - Journal, Year - Publisher</div>
    <div class="gs_rs">LLM-generated snippet with key findings...</div>
    <div class="gs_fl">
      <!-- Action links: Save, Cite, Cited by N, Related, All versions -->
    </div>
  </div>
</div>
```

### Key Data Attributes on Result Cards

| Attribute | Description |
|-----------|-------------|
| `data-cid` | Cluster ID (unique per work) |
| `data-did` | Document ID |
| `data-lid` | Library ID |
| `data-aid` | Article ID |
| `data-rp` | Result position (0-indexed) |

## Streaming Progression Example

A typical query produces ~20 streaming messages:

```
Message 0:  s=2  status="Analyzing your question"         f=0 results
Message 1:  s=3  status="Running 10 queries"              f=0 results
Message 2:  s=3  (empty turn)
Message 3:  s=3  status="Evaluated 4 top results"         f=0 results
Message 4:  s=3  (no status)                              f=1 result  (HTML card)
Message 5:  s=3  status="Evaluated 7 top results"         f=0 results
Message 6:  s=3  status="Evaluated 8 top results"         f=2 results (HTML cards)
...
Message 15: s=3  status="Found 10 relevant results"       f=1 result
Message 16: s=1  (final state, a=false)
Messages 17-19: Individual result HTML cards {h, i}
```

Results arrive incrementally as they're evaluated. The final messages deliver any remaining result cards.

## XSRF Token Sourcing

1. Load the search page: `GET /scholar_labs/search`
2. Parse the `data-dsp` attribute from `#gs_as_glb` element
3. It contains `?hl=en&xsrf=<TOKEN>`
4. Append to all API request URLs

## Session Lifecycle

1. **Create session**: POST to `/scholar_labs/search/session_data` (no session ID)
2. **Response** streams back with session ID in `i` field
3. **Navigate**: Client updates URL to `/scholar_labs/search/session/{sessionId}`
4. **Follow-up**: POST to `/scholar_labs/search/session_data/{sessionId}`
5. **New session**: Navigate to `/scholar_labs/search`, repeat from step 1

## LLM-Enhanced Results

Unlike standard Google Scholar, Labs Search:
- Takes **natural language research questions** (not just keywords)
- **Decomposes** the question into multiple search queries (observed: 10-12 sub-queries)
- **Evaluates** and ranks results from all sub-queries
- Generates **finding-specific snippets** with bold key terms
- Adds **bullet-point findings** per result (e.g. "Competition's Effect on Bias: Shows that...")
- Returns 10 results per query

## CLI Usage Feasibility

**Challenging but possible:**
- Requires Google session cookies (httpOnly, domain-locked)
- XSRF token must be extracted from page HTML
- Binary-framed streaming response needs custom parser
- Session cookies rotate and expire

**Approach for programmatic access:**
1. Use browser automation (Playwright/Selenium) to maintain Google session
2. Extract XSRF token from `data-dsp` attribute
3. POST with `application/x-www-form-urlencoded` body
4. Parse binary-framed JSON response chunks
5. Extract result data from HTML cards (or use the structured fields)

**Alternatively:** Use the page directly via Chrome CDP/automation, which handles auth automatically.
