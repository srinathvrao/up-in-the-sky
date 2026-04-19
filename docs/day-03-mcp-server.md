# Day 3: MCP Server

## Table of Contents
1. [Goal](#goal)
2. [What is MCP Here](#what-is-mcp-here)
3. [Tools to Implement](#tools-to-implement)
4. [Tool Execution Flow](#tool-execution-flow)
5. [Why a Separate Lambda](#why-a-separate-lambda)
6. [External API Contracts](#external-api-contracts)
7. [CDK Stack Changes](#cdk-stack-changes)
8. [Success Criteria](#success-criteria)

---

## Goal

Build the MCP server layer — a set of discrete tools that Claude can invoke to fetch live aircraft position data. Focus on the two core tools first: `get_aircraft_position` and `get_aircraft_nearby`. The AI chat service is not wired up yet; this day is about making the tools work in isolation and verifiable by direct invocation.

---

## What is MCP Here

MCP (Model Context Protocol) is the interface between Claude and your live data. When Claude needs real-world information mid-conversation, it emits a `tool_use` block. Your MCP server receives that, executes the appropriate API call or DB read, and returns the result. Claude then resumes generating.

In this architecture, the MCP server is a **Lambda function** that exposes a list of tools with defined input schemas. The chat Lambda calls it synchronously during a streaming response.

---

## Tools to Implement

### Priority 1 (Day 3)

**`get_aircraft_position`**
- Input: `{ callsign: string }` or `{ icao24: string }`
- Logic: Read DynamoDB hot cache — single `GetItem` by `icao24` or a callsign index scan
- Returns: `lat`, `lon`, `altitude`, `groundSpeed`, `track`, `onGround`, `origin`, `destination`, `updatedAt`
- Note: `origin` and `destination` are IATA codes derived from adsb.lol's route lookup — "plausible" based on callsign match, not a live filed plan. Will be `null` for unrecognised callsigns (private/charter).

**`get_aircraft_nearby`**
- Input: `{ lat: number, lon: number, radius_nm: number }`
- Logic: Query adsb.lol bounding box endpoint directly (bypasses DynamoDB — live snapshot)
- Returns: array of aircraft within radius, each with position fields above

### Priority 2 (Day 5, wired in during chat integration)

**`get_aircraft_history`**
- Input: `{ icao24: string, lookback_hours: number }`
- Logic: Athena query against S3 position archive
- Returns: ordered list of position fixes — lat, lon, altitude, timestamp

**`search_aircraft`**
- Input: `{ callsign_prefix: string }`
- Logic: DynamoDB scan with filter on callsign (acceptable at MVP scale)
- Returns: all currently tracked aircraft matching the prefix (e.g. `AAL` returns all American Airlines flights)

---

## Tool Execution Flow

```
Claude emits tool_use block
        │
   Chat Lambda receives it
        │
   Calls MCP Lambda (sync invoke)
        │
   MCP Lambda routes by tool name
        │
   ┌────▼────────────────────────┐
   │  get_aircraft_position      │
   │  1. Read DynamoDB by icao24 │
   │  2. Check updatedAt         │
   │  3. Return position JSON    │
   └─────────────────────────────┘
        │
   Chat Lambda injects result
        │
   Claude resumes stream
```

DynamoDB is the only data dependency here — no external API calls during tool execution. Reads are O(1) by partition key and typically complete in under 5ms.

---

## Why a Separate Lambda

The MCP server is kept separate from the chat Lambda for two reasons:

1. **Latency isolation** — Tool calls involving Athena queries (`get_aircraft_history`) can take 1–3 seconds. Keeping this in its own Lambda prevents slow tools from consuming the chat Lambda's concurrency and blocking other users' streams.

2. **Independent deployability** — Tools can be updated, tested, and redeployed without touching the chat service. As the tool set grows, this boundary keeps things maintainable.

---

## External API Contracts

| API | Endpoint Used | Auth | Fallback |
|---|---|---|---|
| **DynamoDB** | `GetItem` / `Query` by `icao24` | IAM role | None — source of truth |
| **adsb.lol positions** | `/v2/lat/{lat}/lon/{lon}/dist/{nm}` | None (currently) | Return empty array with note |
| **adsb.lol routes** | `/api/0/route/{callsign}` | None (currently) | Return `null` origin/destination |

All external calls should have a **3-second timeout** and **graceful degradation** — if adsb.lol is temporarily unavailable, return DynamoDB cached data with an `updatedAt` field so Claude can inform the user of data freshness.

---

## CDK Stack Changes

```
cdk/
└── lib/
    ├── stacks/
    │   └── compute-stack.ts       # add MCP Lambda here
    └── constructs/
        └── mcp-server.ts          # new construct
            ├── Lambda function
            ├── IAM: DynamoDB read access (data-stack table)
            ├── IAM: S3 + Athena read access (for history tool)
            ├── SSM: Anthropic API key (inherited, not needed here)
            └── Environment variables: table name, adsb.lol base URL
```

No third-party API keys needed for Day 3 tools — adsb.lol requires none and DynamoDB uses IAM. SSM is only needed when the Anthropic key is wired in on Day 4.

---

## Success Criteria

- [ ] `get_aircraft_position` returns correct position for a known callsign
- [ ] `get_aircraft_nearby` returns a list of aircraft around a given coordinate
- [ ] DynamoDB cache hit confirmed — no external call made when record is fresh
- [ ] Both tools degrade gracefully when data is unavailable (no 500s)
- [ ] MCP Lambda invocable directly via AWS CLI for manual testing
- [ ] `cdk deploy compute-stack` deploys MCP Lambda cleanly
