# Day 5: Next.js Frontend

## Table of Contents
1. [Goal](#goal)
2. [Application Layout](#application-layout)
3. [Flight Board — WebSocket Panel](#flight-board--websocket-panel)
4. [Chat Panel — SSE Hook](#chat-panel--sse-hook)
5. [Component Structure](#component-structure)
6. [State Management](#state-management)
7. [Environment & Config](#environment--config)
8. [Vercel Deployment Setup](#vercel-deployment-setup)
9. [Success Criteria](#success-criteria)

---

## Goal

Build the Next.js frontend — a split-panel UI with a live aircraft position board on one side (WebSocket) and an AI chat interface on the other (SSE). The chat is not yet connected to MCP tools (that's Day 6), but all UI interactions and data flows should be functional with whatever the backend currently returns.

---

## Application Layout

```
┌──────────────────────────────────────────────────┐
│  ✈ FlightTracker                          [logo] │
├─────────────────────────┬────────────────────────┤
│                         │                        │
│    Live Aircraft Board  │     AI Assistant        │
│    (WebSocket feed)     │     (SSE chat)          │
│                         │                        │
│  ┌─────────────────┐    │  ┌──────────────────┐  │
│  │ AAL123  35,000ft │    │  │ Ask me about any │  │
│  │ 480kts  → 127°  │    │  │ flight or area   │  │
│  ├─────────────────┤    │  └──────────────────┘  │
│  │ UAL456  38,200ft │    │                        │
│  │ 510kts  → 083°  │    │  [chat history here]   │
│  ├─────────────────┤    │                        │
│  │ DAL789  12,500ft │    │                        │
│  │ 310kts  → 220°  │    │                        │
│  └─────────────────┘    │  [____________________]│
│                         │  [ Send              ] │
└─────────────────────────┴────────────────────────┘
```

---

## Flight Board — WebSocket Panel

**Behavior:**
- Connects to API Gateway WebSocket on page load
- Receives push events from the Normalizer Lambda (via WebSocket broadcast)
- Renders a live table of active aircraft — rows update in place when new position data arrives
- Rows sorted by altitude (descending) — cruising aircraft at top
- No polling — purely event-driven

**WebSocket event contract:**
```
Inbound event (server → client):
{
  "type": "aircraft_update",
  "data": {
    "icao24": "a27d05",
    "callsign": "AAL123",
    "lat": 40.63,
    "lon": -73.77,
    "altitude": 35000,
    "groundSpeed": 480,
    "track": 127,
    "onGround": false,
    "updatedAt": "2025-04-16T14:32:00Z"
  }
}
```

**Reconnection strategy:**
- Auto-reconnect with exponential backoff on disconnect (1s → 2s → 4s, max 30s)
- Show a "reconnecting…" banner while disconnected

---

## Chat Panel — SSE Hook

**Behavior:**
- User types a message and hits Send (or Enter)
- Request sent as `POST /chat` with message + full history
- Response streamed back via SSE; tokens appended to the assistant bubble in real time
- `tool_start` event shows a subtle "looking up aircraft data…" indicator
- `tool_end` event hides the indicator, text resumes
- `done` event marks the message as complete, re-enables input
- `error` event shows an inline error state

**Chat message structure (client-side):**
```
[
  { role: "user",      content: "Where is AAL123 right now?" },
  { role: "assistant", content: "AAL123 is currently over...", done: true },
  { role: "user",      content: "How high is it flying?" },
  { role: "assistant", content: "",  streaming: true }   ← actively streaming
]
```

---

## Component Structure

```
app/
├── page.tsx                  # root layout — split panel
├── components/
│   ├── FlightBoard/
│   │   ├── FlightBoard.tsx   # table container, manages WS connection
│   │   ├── AircraftRow.tsx   # single aircraft row, animates on update
│   │   └── AltitudeBadge.tsx # color-coded altitude indicator
│   └── Chat/
│       ├── ChatPanel.tsx     # chat container, owns message state
│       ├── MessageBubble.tsx # renders user or assistant message
│       ├── ToolIndicator.tsx # "looking up aircraft data…" spinner
│       └── ChatInput.tsx     # textarea + send button
└── hooks/
    ├── useWebSocket.ts       # WS connect / reconnect / message handler
    └── useChat.ts            # SSE POST, message state, history management
```

---

## State Management

No global state library needed at MVP. React state is sufficient.

| State | Owner | Type |
|---|---|---|
| `aircraft` | `FlightBoard.tsx` | `Map<icao24, AircraftData>` — updated in place |
| `messages` | `ChatPanel.tsx` | `Message[]` — append-only |
| `isStreaming` | `ChatPanel.tsx` | `boolean` |
| `toolInProgress` | `ChatPanel.tsx` | `string | null` |
| `wsStatus` | `useWebSocket` | `"connected" | "reconnecting" | "disconnected"` |

---

## Environment & Config

```
# .env.local
NEXT_PUBLIC_API_HTTP_URL=https://<api-gateway-id>.execute-api.us-east-1.amazonaws.com
NEXT_PUBLIC_API_WS_URL=wss://<api-gateway-id>.execute-api.us-east-1.amazonaws.com
```

Both values come from CDK stack outputs after `cdk deploy`. On Vercel, these are added as environment variables in the project settings.

---

## Vercel Deployment Setup

- Connect GitHub repo to Vercel project
- Set `NEXT_PUBLIC_API_HTTP_URL` and `NEXT_PUBLIC_API_WS_URL` in Vercel environment variables
- Deploy preview on every PR, production on merge to `main`
- No custom domain needed at MVP — use the Vercel-assigned URL

---

## Success Criteria

- [ ] Aircraft board renders and updates live rows without a page refresh
- [ ] Rows visibly animate/highlight when position data changes
- [ ] WebSocket reconnects automatically after a simulated disconnect
- [ ] Chat panel sends a message and renders streamed tokens in real time
- [ ] `tool_start` / `tool_end` events show and hide the lookup indicator correctly
- [ ] Full conversation history maintained across multiple turns
- [ ] Page loads fast — aircraft board visible before JS hydration completes (SSR)
- [ ] Deployed to Vercel and accessible via public URL
