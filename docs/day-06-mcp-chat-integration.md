# Day 6: MCP + Chat Integration

## Table of Contents
1. [Goal](#goal)
2. [What Changes Today](#what-changes-today)
3. [End-to-End Tool Call Flow](#end-to-end-tool-call-flow)
4. [Tool Wiring Checklist](#tool-wiring-checklist)
5. [System Prompt Design](#system-prompt-design)
6. [Edge Cases to Handle](#edge-cases-to-handle)
7. [Integration Test Scenarios](#integration-test-scenarios)
8. [Success Criteria](#success-criteria)

---

## Goal

Connect the MCP server to the chat service. Replace mock tool responses with live calls. Verify that Claude correctly decides when to invoke tools, the right position data comes back, and the streamed response reflects real aircraft information. This is the day the product becomes usable.

---

## What Changes Today

| Component | Before Day 6 | After Day 6 |
|---|---|---|
| Chat Lambda | Calls mock tool responses | Invokes real MCP Lambda |
| MCP Lambda | Tested in isolation | Called mid-stream by chat |
| `get_aircraft_history` tool | Not implemented | Wired up (Athena → S3) |
| `search_aircraft` tool | Not implemented | Wired up (DynamoDB callsign scan) |
| System prompt | Generic | Aviation position-focused (see below) |
| Frontend | Renders `tool_start` events | Now shows real tool names |

No CDK changes needed today — all wiring is within existing Lambda code and configuration.

---

## End-to-End Tool Call Flow

```
User: "Where is UAL456 right now?"
        │
   Chat Lambda → Anthropic API (streaming)
        │
   Claude: [thinking] I need live position data → emits tool_use
   {
     "name": "get_aircraft_position",
     "input": { "callsign": "UAL456" }
   }
        │
   Chat Lambda receives tool_use block
   → emits SSE: event: tool_start { name: "get_aircraft_position" }
   → invokes MCP Lambda: { tool: "get_aircraft_position", input: { callsign: "UAL456" } }
        │
   MCP Lambda:
   1. Reads DynamoDB for callsign "UAL456"
   2. Record is fresh → returns immediately
   {
     "icao24": "a3d4f2",
     "callsign": "UAL456",
     "lat": 39.85,
     "lon": -104.67,
     "altitude": 38200,
     "groundSpeed": 510,
     "track": 83,
     "onGround": false,
     "origin": "ORD",
     "destination": "SFO",
     "updatedAt": "2025-04-16T14:55:02Z"
   }
        │
   Chat Lambda:
   → emits SSE: event: tool_end { name: "get_aircraft_position" }
   → appends tool_result to message history
   → resumes Anthropic stream with updated context
        │
   Claude: "UAL456 is currently over eastern Colorado, flying at
            38,200 feet at 510 knots on a heading of 083°, en route
            from Chicago O'Hare (ORD) to San Francisco (SFO)..."
        │
   Tokens streamed to client as they arrive
```

---

## Tool Wiring Checklist

### `get_aircraft_position` ✓ (from Day 3)
- Already tested in isolation
- Confirm chat Lambda passes callsign in the correct format (e.g. `UAL456` not `United 456`)
- Verify Claude uses ICAO callsign format when invoking the tool

### `get_aircraft_nearby` ✓ (from Day 3)
- Already tested in isolation
- Claude should call this for questions like "what planes are near Denver right now?"
- Confirm lat/lon extraction from user messages is reasonable

### `get_aircraft_history` — new today
- Input: `{ icao24: string, lookback_hours: number }`
- Claude should call this for questions like "where has this plane been today?"
- Athena query against S3 position archive (archive may be sparse on Day 6 — note in system prompt)
- Returns: ordered list of position fixes with timestamps

### `search_aircraft` — new today
- Input: `{ callsign_prefix: string }`
- Claude should call this for "show me all American Airlines flights" type questions
- DynamoDB scan filtered by callsign prefix
- Returns: all currently tracked aircraft matching the prefix

---

## System Prompt Design

The system prompt shapes how Claude uses its tools and communicates with users. Keep it concise — every token costs money on every request.

**Principles:**
- Tell Claude what data it has access to: live ADS-B position data only — no schedules, no delays, no gate info
- Specify callsign format to prevent malformed tool inputs
- Instruct Claude to always fetch live data before answering position questions — never guess from training knowledge
- Set tone: concise, factual, helpful — not chatty

**Key instructions to include:**
- Always use ICAO callsign format (e.g. `UAL456`, `AAL123`) when calling tools
- For questions about where an aircraft is, its altitude, speed, heading, or route — always call `get_aircraft_position`
- For questions about what aircraft are in an area — call `get_aircraft_nearby` with coordinates
- Origin/destination data is "plausible" — based on scheduled routes, not a live filed plan. Flag this to the user if precision matters
- If origin/destination is `null`, tell the user the route is unknown (likely private or charter)
- This system does not have delay, gate, or schedule data — if asked, explain the position-only scope
- If a tool returns stale data, surface the `updatedAt` timestamp to the user
- Keep responses brief unless the user asks for detail

---

## Edge Cases to Handle

| Scenario | Expected Behavior |
|---|---|
| Callsign not found in DynamoDB | Tell user the aircraft is not currently being tracked (may be on ground or out of coverage) |
| User asks about a flight that has landed | `onGround: true` in last known position; Claude explains the aircraft appears to be on the ground |
| `origin` / `destination` is `null` | Claude tells user the route is unknown — likely a private or charter flight |
| User asks if route data is guaranteed | Claude clarifies it's "plausible" based on scheduled routes, not a live filed plan |
| User asks for delay or gate info | Claude explains this system tracks live positions and routes, not schedule or gate data |
| Tool call takes > 3 seconds | MCP Lambda times out; Claude receives error result; informs user data is temporarily unavailable |
| Claude calls tool with wrong callsign format | MCP Lambda returns empty result; Claude should ask user to clarify or try alternate format |
| User asks something non-aviation | Claude responds normally — no tool call needed, no restrictions |
| Two tool calls in one response | Both execute sequentially; each emits `tool_start` / `tool_end` pair |

---

## Integration Test Scenarios

Run these manually before declaring Day 6 complete:

| User Message | Expected Tool Called | Expected Response Contains |
|---|---|---|
| "Where is AAL123 right now?" | `get_aircraft_position` | Lat/lon region, altitude, speed |
| "Where is UAL456 flying to?" | `get_aircraft_position` | Destination airport from route data |
| "Where did DAL789 depart from?" | `get_aircraft_position` | Origin airport from route data |
| "What planes are over Denver?" | `get_aircraft_nearby` | List of aircraft near Denver coords |
| "How high is DAL789 flying?" | `get_aircraft_position` | Altitude in feet |
| "Show me all United flights" | `search_aircraft` | Aircraft list with `UAL` prefix |
| "Where has N12345 been today?" | `get_aircraft_history` | Historical position fixes |
| "What heading is UAL456 on?" | `get_aircraft_position` | Track/heading in degrees |
| "Is AA123 delayed?" | none | Explain position-only scope, no delay data |
| "What's 2 + 2?" | none | "4" — no unnecessary tool calls |

---

## Success Criteria

- [ ] All four tools are invocable from the chat Lambda
- [ ] Claude correctly identifies when to call each tool without being prompted
- [ ] ICAO callsign format is consistently used in tool inputs
- [ ] Tool results are reflected accurately in Claude's response
- [ ] Claude correctly declines delay/gate questions and explains scope
- [ ] `tool_start` / `tool_end` SSE events fire on the frontend for each tool call
- [ ] All integration test scenarios pass
- [ ] No tool call causes a stream to hang or fail silently
