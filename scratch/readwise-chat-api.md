# Readwise Chat API - Reverse Engineering Notes

## Architecture

- **Frontend**: Vite-bundled React app (not Next.js)
- **Backend**: Django (session-based auth, httpOnly cookies)
- **Realtime**: WebSocket at `wss://chatwebsockets.readwise.io/ws`
- **LLM**: GPT-5.1 (default "Fast") or GPT-5.1-thinking ("Thinking")
- **Library**: `react-use-websocket` for WS management

## Authentication

- **Session auth**: httpOnly `sessionid` cookie (not accessible via JS)
- **CSRF**: `csrftoken` cookie (accessible)
- **API token**: `accessToken` cookie = Readwise API token
- Chat API endpoints require Django session auth (302 redirect to login without it)
- WebSocket auth: cookies sent during WS handshake (standard browser behavior)

## REST API Endpoints

Base URL: `https://readwise.io`

### List Conversations
```
GET /api/chat/conversations
Credentials: include (session cookie)

Response: {
  data: [{
    id: string,           // ULID e.g. "01kh43w64eqsmgnw1zm1te7dd4"
    title: string,
    createdAt: string,    // ISO 8601
    lastChatMessageAt: string
  }]
}
```

### Get Conversation (with messages)
```
GET /api/chat/conversations/{conversationId}
Credentials: include

Response: {
  data: {
    id: string,
    title: string,
    createdAt: string,
    lastChatMessageAt: string,
    chatMessages: ChatMessage[]
  }
}
```

### Delete Conversation
```
DELETE /api/chat/delete-conversation/{conversationId}
Credentials: include
```

### Rename Conversation
```
PUT /api/chat/update-conversation/{conversationId}
Credentials: include
Content-Type: application/json
Body: { title: string }
```

### Personalized Suggestions
```
GET /api/chat/personalized_suggestions
Credentials: include

Response: {
  data: string[]  // e.g. ["What fiduciary duties do brokers owe clients?", ...]
}
```

## WebSocket Protocol

### Connection
```
URL: wss://chatwebsockets.readwise.io/ws
Auth: Cookies sent in handshake (session cookie)
Heartbeat: enabled (ping/pong)
Reconnect: exponential backoff, min(2^attempt * 1000, 10000)ms, infinite attempts
```

### Outbound Messages (Client -> Server)

#### Send Chat Message
```json
{
  "category": "newChatMessage",
  "conversationId": "01kh43w64eqsmgnw1zm1te7dd4",
  "chatMessages": [
    {
      "content": "What are my highlights about fiduciary duty?",
      "createdAt": "2026-02-10T15:51:19.243377Z",
      "id": "01KH43ZZCWZDKY3WAXK4W6HY9J",
      "isResponse": false,
      "modelId": "5.1"
    }
  ]
}
```

The `chatMessages` array includes the FULL conversation history (all previous messages + new one).

### Inbound Messages (Server -> Client)

#### Streaming Content Delta
```json
{
  "category": "chatMessageDelta",
  "conversationId": "...",
  "chatMessages": [{
    "id": "...",
    "latestContentDelta": "partial text chunk",
    "createdAt": "..."
  }]
}
```
Client appends `latestContentDelta` to matching message's content.

#### Complete Message
```json
{
  "category": "newChatMessage",
  "conversationId": "...",
  "chatMessages": [{
    "id": "...",
    "content": "full message text",
    "isResponse": true,
    "modelId": "5.1",
    "createdAt": "...",
    "relatedHighlights": { ... }
  }]
}
```

#### Conversation Update
```json
{
  "category": "conversationUpdate",
  "conversationId": "...",
  "overwrites": { "title": "Auto-generated title" }
}
```

## ChatMessage Schema

```typescript
interface ChatMessage {
  id: string;              // ULID (user) or OpenAI call_id (tool call)
  content: string;
  createdAt: string;       // ISO 8601
  isResponse: boolean;
  isError: boolean;
  modelId: string | null;  // "5.1" or "5.1-thinking"
  modelConfig: {
    model: string;         // "gpt-5.1"
    verbosity: string;     // "low"
    reasoning_effort: string; // "none" or "high"
  } | null;
  latestContentDelta: string | null;
  relatedHighlights: Record<string, Highlight> | null;
}
```

## Highlight Schema

The `relatedHighlights` is a map of numeric string keys -> Highlight objects.

```typescript
interface Highlight {
  document_id: number;
  highlight_id: number;
  document_title: string;
  document_author: string;
  document_type: string;       // "pdf", "article", etc.
  document_category: string;   // "articles", "books", etc.
  document_tags: string[];
  document_cover_image_url: string;
  highlight_text: string;
  highlight_note: string;
  highlight_tags: string[];
  highlight_url: string;       // https://readwise.io/bookreview/{docId}/?highlight={highlightId}
}
```

### Highlight Classification (Client-side)

The client classifies highlights into three groups:
1. **referenced**: highlights whose URL appears in the response markdown content
2. **relevant**: highlights with text > 3 words (but not referenced)
3. **other**: remaining highlights (short text, not referenced)

Referenced highlights are sorted by their order of appearance in the response text.

## Conversation ID Format

Uses ULID (Universally Unique Lexicographically Sortable Identifier):
- Generated client-side with `O0().toLowerCase()`
- Example: `01kh43w64eqsmgnw1zm1te7dd4`

## Model Options

```javascript
const models = [
  { icon: "✨", id: "5.1",          name: "Fast (GPT-5.1)" },
  { icon: "🧠", id: "5.1-thinking", name: "Thinking (GPT-5.1 Thinking)" }
];
```

## Key Insight: No Direct Highlight Search API

The Readwise Chat **does not expose a separate highlight search endpoint**. The flow is:
1. Client sends a natural language question via WebSocket
2. Server (GPT-5.1) performs RAG over the user's highlights (vector search + context)
3. Server streams back a synthesized answer with `relatedHighlights` attached
4. Client classifies highlights as referenced/relevant/other

The "search" is really an LLM-powered RAG query, not a keyword/vector search endpoint. This means it can't be used as a faster alternative to the Readwise MCP highlight search for simple lookups. However, it adds:
- **Semantic understanding** of queries
- **Cross-document synthesis**
- **Highlight citation** in generated text
- **69 related highlights** returned per query (vs MCP which returns top-N vector matches)

## Usage from CLI

Since auth is session-cookie based (httpOnly), you can't easily call these APIs from curl. Options:
1. **Browser automation**: Execute fetch() from within the authenticated page
2. **Cookie extraction**: Use browser devtools/CDP to extract httpOnly cookies
3. **Readwise API v3 token**: The `accessToken` cookie IS the Readwise API token, but the chat endpoints only accept session auth

## Backlog

- [ ] Reverse engineer Google Scholar Labs search: https://scholar.google.com/scholar_labs/search
