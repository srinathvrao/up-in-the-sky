# Flight Tracker MVP — Build Plan

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture Summary](#architecture-summary)
3. [Tech Stack](#tech-stack)
4. [Cost Estimate](#cost-estimate)
5. [Build Schedule](#build-schedule)
6. [Scaling Path](#scaling-path)

---

## Project Overview

A real-time aircraft position tracking application with an AI assistant powered by Claude. Users can monitor live aircraft positions on a streaming board and ask an AI — with live context via MCP tools — questions about any aircraft's position, altitude, speed, heading, and route (origin/destination).

Built pre-funding as a lean MVP. Sole data source is adsb.lol (free, ODbL licensed) — providing both live ADS-B positions and plausible route data via callsign lookup. Pay-per-use AWS infrastructure. Deployable in 7 days.

---

## Architecture Summary

```
Browser / Mobile
    │
    ├── WebSocket → live aircraft board (~2s updates)
    └── SSE      → AI chat stream
         │
    API Gateway v2 (HTTP + WebSocket)
         │
    ┌────┴──────────────────────────┐
    │  Chat Lambda  │  MCP Lambda   │
    │  (FastAPI)    │  (tools)      │
    └────┬──────────┴───────┬───────┘
         │                  │
    Anthropic API       DynamoDB
    (Claude, SSE)       (hot position cache)
         │
    adsb.lol (poll every 2s)
    → Kinesis → Normalizer Lambda → DynamoDB → S3
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js on Vercel | SSR, free tier, zero infra |
| API | AWS API Gateway v2 | HTTP + WebSocket in one, pay-per-request |
| Chat Service | Python FastAPI + Lambda | Native SSE, Anthropic SDK |
| MCP Server | Python Lambda | Tool isolation, independent deploy |
| Position Ingest | Poller Lambda + Kinesis | 2s poll cycle, burst-safe, horizontally scalable |
| Hot State | DynamoDB (on-demand) | O(1) reads by ICAO24, TTL auto-expiry, serverless |
| Archive | S3 + Firehose | Near-zero cost, Athena queryable for history |
| IaC | AWS CDK (TypeScript) | Type-safe infra, single `cdk deploy` |
| Secrets | SSM Parameter Store | Free, IAM-controlled |
| Position Data | adsb.lol | Free, ODbL licensed, ADS-B Exchange compatible |

---

## Cost Estimate

| Service | Monthly (MVP) |
|---|---|
| API Gateway (HTTP + WebSocket) | ~$3 |
| Lambda (all functions) | ~$0 (free tier) |
| Kinesis (1 shard) | ~$15 |
| DynamoDB (on-demand) | ~$1 |
| S3 + Firehose | ~$1 |
| Anthropic API | ~$10–30 (usage dependent) |
| adsb.lol | $0 |
| **Total** | **~$30–50/mo** |

---

## Build Schedule

| File | Days | Milestone |
|---|---|---|
| [day-00-cicd-pipeline.md](./day-00-cicd-pipeline.md) | 0 | AWS account, GitHub repo, OIDC, CDK bootstrap, CI/CD pipeline live |
| [day-01-02-data-pipeline.md](./day-01-02-data-pipeline.md) | 1–2 | CDK data stack + adsb.lol pipeline live at 2s updates |
| [day-03-mcp-server.md](./day-03-mcp-server.md) | 3 | MCP position tools working in isolation |
| [day-04-chat-service.md](./day-04-chat-service.md) | 4 | Claude streaming chat, no tools yet |
| [day-05-frontend.md](./day-05-frontend.md) | 5 | Next.js UI — aircraft board + chat panel |
| [day-06-mcp-chat-integration.md](./day-06-mcp-chat-integration.md) | 6 | MCP wired into chat, product usable |
| [day-07-deploy-smoke-test.md](./day-07-deploy-smoke-test.md) | 7 | Full deploy, smoke test, ship |

---

## Scaling Path

| Stage | Users | Key Changes |
|---|---|---|
| MVP | < 1K DAU | As built — adsb.lol free tier |
| Growth | 10K DAU | Add Kinesis shards, DynamoDB auto-scaling, swap to ADS-B Exchange if adsb.lol reliability is a concern |
| Scale | 100K DAU | Chat → ECS Fargate, Redis for session state, CloudFront |
| Series A | 1M+ DAU | Kinesis → MSK (Kafka), DynamoDB global tables, multi-region |

Nothing in this stack is replaced as you scale — only expanded. Kinesis shards are additive. DynamoDB scales without schema changes. Lambda → Fargate is a single CDK config change.
