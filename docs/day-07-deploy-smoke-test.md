# Day 7: Deploy & Smoke Test

## Table of Contents
1. [Goal](#goal)
2. [Pre-Deploy Checklist](#pre-deploy-checklist)
3. [Deployment Order](#deployment-order)
4. [Environment Variables & Secrets](#environment-variables--secrets)
5. [Smoke Test Plan](#smoke-test-plan)
6. [Monitoring Setup](#monitoring-setup)
7. [Known Limitations at Launch](#known-limitations-at-launch)
8. [Post-Launch Priorities](#post-launch-priorities)

---

## Goal

Deploy every service to production, run a structured smoke test against the live environment, and ship. The product is not perfect — it's an MVP. The goal today is confidence that core flows work end-to-end in production and that failures are observable.

---

## Pre-Deploy Checklist

### Code
- [ ] All Day 1–6 success criteria are met in local/dev environment
- [ ] No hardcoded API keys, URLs, or credentials in source
- [ ] All environment variables documented (see below)
- [ ] CDK stacks have no unresolved `TODO` comments blocking deploy

### Infrastructure
- [ ] Day 0 pipeline is confirmed working — CI and deploy workflows have both run successfully at least once
- [ ] All SSM parameters are in place (written automatically by the deploy workflow for the Anthropic key)
- [ ] S3 bucket names are globally unique
- [ ] Lambda memory and timeout values set appropriately per function

### Frontend
- [ ] Vercel project connected to GitHub repo
- [ ] `NEXT_PUBLIC_API_HTTP_URL` and `NEXT_PUBLIC_API_WS_URL` set in Vercel environment
- [ ] Production build (`next build`) passes locally without errors

---

## Deployment Order

Deployments are handled automatically by the GitHub Actions pipeline established on Day 0. On merge to `main`, stacks deploy in this order:

```
GitHub Actions: deploy.yml
        │
        ├── Write Anthropic API key → SSM
        ├── cdk deploy data-stack
        │       ↳ Creates: Kinesis stream, DynamoDB table, S3 bucket, Firehose
        │       ↳ Outputs: table name, stream ARN, S3 bucket name
        │
        ├── cdk deploy api-stack
        │       ↳ Creates: API Gateway (HTTP + WebSocket endpoints)
        │       ↳ Outputs: HTTP URL, WebSocket URL
        │
        └── cdk deploy compute-stack
                ↳ Creates: Poller Lambda, Normalizer Lambda, MCP Lambda, Chat Lambda
                ↳ Consumes: outputs from data-stack and api-stack
                ↳ Outputs: Lambda ARNs, function URLs

Vercel deploy runs automatically on the same merge to main (connected in Day 5).
```

If a stack fails mid-deploy, `cdk deploy` is idempotent — push a fix and merge again. Do not run `cdk deploy` manually in production unless debugging a specific issue.

---

## Environment Variables & Secrets

### SSM Parameters (set before deploy)
| Parameter Path | Value | Used By |
|---|---|---|
| `/flighttracker/anthropic-api-key` | Anthropic API key | Chat Lambda |

### Lambda Environment Variables (injected by CDK)
| Variable | Source |
|---|---|
| `AIRCRAFT_TABLE_NAME` | CDK output from data-stack |
| `KINESIS_STREAM_ARN` | CDK output from data-stack |
| `S3_ARCHIVE_BUCKET` | CDK output from data-stack |
| `MCP_LAMBDA_ARN` | CDK output from compute-stack |
| `ADSB_LOL_BASE_URL` | Hardcoded: `https://api.adsb.lol/v2` |
| `MODEL_ID` | Hardcoded: `claude-sonnet-4-20250514` |

### Vercel Environment Variables
| Variable | Source |
|---|---|
| `NEXT_PUBLIC_API_HTTP_URL` | CDK output from api-stack |
| `NEXT_PUBLIC_API_WS_URL` | CDK output from api-stack |

---

## Smoke Test Plan

Run these in order against the live production environment. Each test should pass before moving to the next.

### 1. Data Pipeline
| Check | How | Pass Condition |
|---|---|---|
| Poller Lambda running | CloudWatch Logs → Poller function | Logs show successful adsb.lol calls every 2s |
| Kinesis receiving events | CloudWatch → Kinesis metrics | `IncomingRecords` > 0 |
| DynamoDB populated | AWS Console → DynamoDB → Aircraft table | Records present with recent `updatedAt` |
| Firehose writing to S3 | S3 Console → archive bucket | Objects appearing in partitioned prefixes |

### 2. API Gateway
| Check | How | Pass Condition |
|---|---|---|
| HTTP endpoint reachable | `curl POST /chat` with simple message | 200 response with SSE stream |
| WebSocket endpoint reachable | `wscat -c <WS_URL>` | Connection established |

### 3. MCP Tools
| Check | How | Pass Condition |
|---|---|---|
| `get_aircraft_position` | Invoke MCP Lambda via CLI with known callsign | Returns position JSON |
| `get_aircraft_nearby` | Invoke MCP Lambda via CLI with known coords | Returns array of aircraft |

### 4. Chat End-to-End
| Message | Pass Condition |
|---|---|
| "Where is AAL123 right now?" | Streamed response with real position data, tool indicator fires |
| "Where is UAL456 flying to?" | Destination airport returned from route data |
| "What planes are over Chicago?" | List of nearby aircraft returned |
| "Is AA123 delayed?" | Claude explains position-only scope, no tool call made |
| "Hello, what can you do?" | Friendly intro describing position and route tracking capabilities |

### 5. Frontend
| Check | Pass Condition |
|---|---|
| Aircraft board loads | Rows visible within 3 seconds of page open |
| Live updates | At least one row visibly updates position within 5 seconds |
| Chat works | Message sent, response streamed, tool indicator visible |
| Mobile layout | Usable on phone screen (basic responsiveness) |

---

## Monitoring Setup

Minimum viable observability before calling the MVP live:

| Signal | Tool | Alert On |
|---|---|---|
| Poller Lambda errors | CloudWatch Logs + Metrics | Error rate > 5% over 1 min |
| Lambda errors (all) | CloudWatch Metrics | Error rate > 1% in 5 min |
| Kinesis iterator age | CloudWatch Metrics | `IteratorAgeMilliseconds` > 10,000 |
| Chat Lambda duration | CloudWatch Metrics | p95 > 25s (near timeout) |
| API Gateway 5xx | CloudWatch Metrics | Any 5xx in 5 min window |

Set up a **CloudWatch Dashboard** with these five metrics. Free at low volume. Takes 30 minutes to configure.

---

## Known Limitations at Launch

These are accepted scope cuts for MVP — not bugs, just honest constraints:

| Limitation | Impact | Plan |
|---|---|---|
| No user auth | Any user can access the app | Add Cognito post-funding if needed |
| Chat history is client-side only | Refreshing the page loses history | Acceptable for MVP |
| Position data only — no delay or gate info | Can't answer delay/gate questions | Accepted scope for this product |
| Route data is "plausible" not guaranteed | Origin/destination based on scheduled routes, not live filed plan | Surface caveat to users via Claude's system prompt |
| adsb.lol has no SLA | Service could be intermittently unavailable | Swap to ADS-B Exchange (RapidAPI, $10/mo) if reliability becomes an issue |
| S3 history archive sparse at launch | `get_aircraft_history` has little data on Day 1 | Improves automatically over time |
| Single Kinesis shard | Max ~1K concurrent position updates/s | Add shards at 10K DAU |
| Lambda cold starts on chat | First response after idle ~1–2s slower | Move to Fargate at scale |
| No rate limiting | Potential for abuse | Add API Gateway usage plan post-launch |

---

## Post-Launch Priorities

Ordered by impact:

1. **Rate limiting** — API Gateway usage plan, simple abuse protection
2. **Error alerting** — SNS → email/Slack on CloudWatch alarms
3. **adsb.lol reliability monitoring** — alert if Poller Lambda error rate spikes; have ADS-B Exchange as a ready swap
4. **Domain + TLS** — Custom domain via Route 53 + ACM
5. **Auth** — Add Cognito if multi-user features become a requirement
6. **Fargate migration** — When Lambda cold starts become a user-facing issue
