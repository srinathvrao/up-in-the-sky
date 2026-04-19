# Day 4: AI Chat Service (Claude + SSE Streaming)

## Table of Contents
1. [Goal](#goal)
2. [Service Overview](#service-overview)
3. [SSE Streaming Design](#sse-streaming-design)
4. [Conversation State](#conversation-state)
5. [Tool Call Interruption Flow](#tool-call-interruption-flow)
6. [API Gateway Configuration](#api-gateway-configuration)
7. [CDK Stack Changes](#cdk-stack-changes)
8. [Success Criteria](#success-criteria)

---

## Goal

Build the chat service — a Lambda that accepts a user message, streams a Claude response back to the client via SSE, and executes MCP tool calls mid-stream when Claude needs live data. The MCP tools are not yet wired (that's Day 6); today's goal is a clean streaming chat loop that works without tools.

---

## Service Overview

| Property | Value |
|---|---|
| **Runtime** | Python 3.12 (FastAPI + Mangum adapter) |
| **Trigger** | API Gateway HTTP POST `/chat` |
| **Response type** | SSE (`text/event-stream`) |
| **Model** | `claude-sonnet-4-20250514` |
| **Max tokens** | 1024 per response |
| **Timeout** | 29s (API Gateway HTTP max) |

The Lambda uses **FastAPI with Mangum** to handle the SSE response correctly inside a Lambda execution context. Raw Lambda response streaming is enabled via `FunctionUrlConfig` or API Gateway payload format v2.

---

## SSE Streaming Design

```
Client                      API Gateway              Chat Lambda
  │                              │                        │
  │── POST /chat ───────────────►│                        │
  │   { message, history }       │── invoke ─────────────►│
  │                              │                        │ calls Anthropic API
  │◄── HTTP 200 ─────────────────│                        │ with stream=True
  │    Content-Type:             │                        │
  │    text/event-stream         │                        │
  │                              │                        │
  │◄── data: {"token": "The"} ───│◄── chunk ─────────────│
  │◄── data: {"token": " flight"}│◄── chunk ─────────────│
  │◄── data: {"token": " is"} ───│◄── chunk ─────────────│
  │◄── data: [DONE] ─────────────│◄── stream end ────────│
```

**SSE event types:**
| Event | Payload | Purpose |
|---|---|---|
| `token` | `{ "text": "..." }` | Text chunk to render |
| `tool_start` | `{ "name": "get_flight_status" }` | Show loading indicator |
| `tool_end` | `{ "name": "get_flight_status" }` | Hide loading indicator |
| `done` | `{}` | Stream complete |
| `error` | `{ "message": "..." }` | Surface errors to client |

---

## Conversation State

No server-side session storage at MVP. The **client owns conversation history** and sends the full array on every request.

```
Request body:
{
  "message": "Where is AAL123 right now?",
  "history": [
    { "role": "user",      "content": "What planes are over Colorado?" },
    { "role": "assistant", "content": "There are currently 12 aircraft over Colorado..." }
  ]
}
```

This keeps the backend stateless and eliminates DynamoDB session storage as a dependency. Acceptable at MVP — revisit if history gets long enough to hit token limits (add server-side trimming then).

---

## Tool Call Interruption Flow

When Claude decides to use a tool mid-stream, the Lambda pauses text streaming, executes the tool, injects the result, and resumes. From the user's perspective this is a brief pause (~100–300ms) before more text appears.

```
Claude stream → text tokens → emit to client
                    │
            Claude emits tool_use block
                    │
            Lambda pauses SSE emission
                    │
            Emit: event: tool_start
                    │
            Invoke MCP Lambda synchronously
            (~100ms for DynamoDB hit)
                    │
            Inject tool_result into message history
                    │
            Emit: event: tool_end
                    │
            Resume Anthropic stream with updated context
                    │
            Claude continues → more text tokens → emit to client
```

This is implemented today in structure (the interruption logic), but MCP Lambda is only connected on Day 6. Use a **mock tool response** on Day 4 to validate the flow end-to-end.

---

## API Gateway Configuration

- **Route:** `POST /chat`
- **Integration:** Lambda proxy
- **Payload format:** v2 (required for streaming)
- **Timeout:** 29 seconds (HTTP API Gateway maximum)
- **CORS:** Allow `*` at MVP (tighten to Vercel domain post-launch)

Lambda response streaming must be enabled — standard Lambda response buffering will break SSE. Use `InvokeWithResponseStreaming` or configure the function URL accordingly in CDK.

---

## CDK Stack Changes

```
cdk/
└── lib/
    ├── stacks/
    │   └── compute-stack.ts       # add Chat Lambda
    └── constructs/
        └── chat-service.ts        # new construct
            ├── Lambda function (Python, streaming enabled)
            ├── API Gateway route: POST /chat
            ├── IAM: invoke MCP Lambda
            ├── Environment variables:
            │   ├── ANTHROPIC_API_KEY (from SSM)
            │   ├── MCP_LAMBDA_ARN
            │   └── MODEL_ID
            └── CORS configuration
```

---

## Success Criteria

- [ ] `POST /chat` with a message returns a valid SSE stream
- [ ] Text tokens arrive and render incrementally in a test client (curl or simple HTML page)
- [ ] `tool_start` and `tool_end` events fire correctly around mock tool execution
- [ ] Conversation history is correctly threaded — follow-up questions have context
- [ ] Stream ends cleanly with a `done` event, no hanging connections
- [ ] Errors (e.g. Anthropic API timeout) surface as `error` SSE events, not silent failures
