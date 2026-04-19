# Day 1–2: CDK Data Stack & Kinesis Pipeline

## Table of Contents
1. [Goal](#goal)
2. [Services to Stand Up](#services-to-stand-up)
3. [Kinesis Stream Design](#kinesis-stream-design)
4. [DynamoDB Schema](#dynamodb-schema)
5. [S3 & Firehose Archive](#s3--firehose-archive)
6. [CDK Stack Structure](#cdk-stack-structure)
7. [External Data Sources](#external-data-sources)
8. [Success Criteria](#success-criteria)

---

## Goal

Get real-time flight position data flowing end-to-end — from adsb.lol, through Kinesis, normalized and written into DynamoDB, with an async archive to S3. No frontend, no AI yet. Just the data layer working reliably at ~2 second update intervals.

---

## Services to Stand Up

| Service | Purpose |
|---|---|
| **Kinesis Data Stream** | Ingests raw flight position events |
| **Poller Lambda** | Calls adsb.lol every 2 seconds, pushes events to Kinesis |
| **Normalizer Lambda** | Consumes Kinesis, decodes, dedupes, and enriches position events |
| **DynamoDB** | Hot state store — latest position per aircraft |
| **Firehose → S3** | Async archive for historical position queries |

---

## Kinesis Stream Design

- **Shards:** Start with 1 (handles 1MB/s — sufficient for regional ADS-B position volume at MVP)
- **Partition key:** `icao24` — ensures all events for an aircraft go to the same shard, preserving order
- **Retention:** 24 hours (default) — sufficient for replay and debugging
- **Batch size:** 100 records per Lambda invocation

**Ingest source:**
- adsb.lol REST API — polled every 2 seconds via a scheduled Lambda, using the bounding box endpoint scoped to a region (e.g. North America) to keep payload size manageable

**Route enrichment:**
- The Normalizer Lambda calls the adsb.lol route endpoint (`/api/0/route/{callsign}`) for any aircraft it hasn't seen a route for yet, or if `routeUpdatedAt` is older than 1 hour
- Route lookups are **not** done on every position update — only on first sight or hourly refresh, to avoid hammering the endpoint
- Origin/destination is written to DynamoDB alongside position data and cached there

---

## DynamoDB Schema

**Table: `Aircraft`**

| Attribute | Type | Notes |
|---|---|---|
| `icao24` | String (PK) | ICAO 24-bit address — e.g. `a27d05` |
| `callsign` | String | e.g. `AAL123` |
| `lat` / `lon` | Number | Last known position |
| `altitude` | Number | Barometric altitude in feet |
| `groundSpeed` | Number | Knots |
| `track` | Number | True heading in degrees |
| `onGround` | Boolean | Whether aircraft is on the ground |
| `origin` | String | Departure airport IATA code — e.g. `JFK` (from route lookup) |
| `destination` | String | Arrival airport IATA code — e.g. `LHR` (from route lookup) |
| `routeUpdatedAt` | String | ISO timestamp of last route enrichment |
| `updatedAt` | String | ISO timestamp of last position fix |
| `ttl` | Number | Unix epoch + 24hr — auto-expiry |

- **Billing:** On-demand (PAY_PER_REQUEST) — no capacity planning at MVP
- **TTL attribute:** `ttl` — DynamoDB auto-deletes records for aircraft no longer broadcasting after 24 hours
- **Note:** adsb.lol uses `icao24` as the aircraft identifier — MCP tools query by this key or by callsign
- **Route data is "plausible"** — adsb.lol matches callsigns against a route database (VRS standing data), not a live filed flight plan. Origin/destination reflects the scheduled route for that callsign, which is correct the vast majority of the time.

---

## S3 & Firehose Archive

- Firehose buffers Kinesis output and writes to S3 in batches (every 5 min or 128MB)
- S3 prefix: `positions/year=/month=/day=/hour=` — partitioned for Athena queries
- Used later by the `get_aircraft_history` MCP tool to answer questions like "where has this plane been today?"
- Async — adds zero latency to the hot path

---

## CDK Stack Structure

```
cdk/
└── lib/
    └── stacks/
        └── data-stack.ts
            ├── Kinesis Data Stream
            ├── Poller Lambda (scheduled every 2s via EventBridge)
            ├── Normalizer Lambda (event source: Kinesis)
            ├── DynamoDB Table (TTL + on-demand)
            ├── Firehose Delivery Stream (Kinesis → S3)
            └── S3 Bucket (archive)
```

All resources in a single `DataStack` — can be deployed independently before the API or compute stacks exist.

---

## External Data Sources

| Source | Endpoint | Cost | Notes |
|---|---|---|---|
| **adsb.lol positions** | `/v2/lat/{lat}/lon/{lon}/dist/{nm}` | Free (ODbL) | Polled every 2s for live positions |
| **adsb.lol routes** | `/api/0/route/{callsign}` | Free (ODbL) | Called on first sight + hourly per aircraft |

Both endpoints are part of the same adsb.lol API — no additional keys or services needed. Route data is sourced from VRS (Virtual Radar Server) standing data and labeled "plausible" — it matches the scheduled route for a callsign, not a live filed flight plan. Accurate for commercial flights the vast majority of the time; less reliable for charter or private operations.

**Fallback:** If a route lookup returns no result, `origin` and `destination` are stored as `null`. Claude is instructed to surface this rather than guess.

---

## Success Criteria

- [ ] Poller Lambda is calling adsb.lol every 2 seconds without errors
- [ ] Kinesis stream is receiving position events
- [ ] Normalizer Lambda is processing batches without errors
- [ ] DynamoDB table has live aircraft records updating every ~2 seconds
- [ ] Records with expired TTL are being cleaned up automatically
- [ ] S3 bucket is receiving archived batches from Firehose
- [ ] `cdk deploy data-stack` completes cleanly from scratch
