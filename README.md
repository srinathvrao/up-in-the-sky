# up-in-the-sky ✈️

Real-time aircraft tracking with an AI assistant powered by Claude. Ask questions about any flight overhead — altitude, speed, heading, route — and get live answers backed by ADS-B data.

No GPS or permissions required. Location is inferred from your network.

---

## How it works

```
Browser
  ├── WebSocket  ──► live aircraft board  (~2s updates)
  └── SSE        ──► AI chat stream
                          │
                   API Gateway v2
                          │
              ┌───────────┴───────────┐
              │  Chat Lambda          │  MCP Lambda
              │  Python / FastAPI     │  Java / tools
              └───────────┬───────────┘
                          │                    │
                  Anthropic API           DynamoDB
                  (Claude, streaming)     (live position cache)
                          │
                    adsb.lol (free ADS-B)
                    → Kinesis → Normalizer → DynamoDB → S3
```

- **Poller Lambda** — polls adsb.lol every 2 seconds, writes raw positions to Kinesis
- **Normalizer Lambda** — consumes Kinesis, deduplicates, writes to DynamoDB with 24h TTL
- **MCP Lambda** — exposes `get_flight_status` and `get_aircraft_in_area` tools backed by DynamoDB
- **Chat Lambda** — FastAPI service that streams Claude responses via SSE, calling MCP tools mid-stream when Claude needs live data
- **Frontend** — Next.js on Vercel, live aircraft board + chat panel

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (Vercel) |
| Chat service | Python 3.12, FastAPI, Lambda Web Adapter |
| MCP tools | Java 21, AWS Lambda |
| Data ingest | Java 21 Lambda + Kinesis Data Stream |
| Hot state | DynamoDB on-demand (TTL auto-expiry) |
| Archive | S3 + Kinesis Firehose |
| Infrastructure | AWS CDK (TypeScript) |
| AI model | Claude (Anthropic API, SSE streaming) |
| Position data | [adsb.lol](https://adsb.lol) — free, ODbL licensed |

---

## Repository layout

```
up-in-the-sky/
├── cdk/                        # AWS CDK app (TypeScript)
│   └── lib/
│       ├── data-stack.ts       # Kinesis, DynamoDB, S3, Poller, Normalizer
│       ├── api-stack.ts        # API Gateway (HTTP + WebSocket)
│       ├── compute-stack.ts    # MCP Lambda, Chat Lambda
│       └── constructs/
│           ├── mcp-server.ts
│           └── chat-service.ts
├── services/
│   ├── poller-lambda/          # Java — polls adsb.lol every 2s
│   ├── normalizer-lambda/      # Java — Kinesis consumer → DynamoDB
│   ├── mcp-lambda/             # Java — MCP tool server
│   └── chat-lambda/            # Python — FastAPI SSE chat service
├── frontend/                   # Next.js app (Day 5)
└── docs/                       # Day-by-day build plans
```

---

## Build progress

| Day | Plan | Status |
|---|---|---|
| 0 | [CI/CD pipeline](docs/day-00-cicd-pipeline.md) — AWS, GitHub OIDC, CDK bootstrap | ✅ Done |
| 1–2 | [Data pipeline](docs/day-01-02-data-pipeline.md) — adsb.lol → Kinesis → DynamoDB live at 2s | ✅ Done |
| 3 | [MCP server](docs/day-03-mcp-server.md) — position tools working in isolation | ✅ Done |
| 4 | [Chat service](docs/day-04-chat-service.md) — Claude SSE streaming chat deployed | ✅ Done |
| 5 | [Frontend](docs/day-05-frontend.md) — Next.js aircraft board + chat panel | 🔜 Next |
| 6 | [MCP integration](docs/day-06-mcp-chat-integration.md) — live tools wired into chat | 🔜 |
| 7 | [Ship](docs/day-07-deploy-smoke-test.md) — full deploy, smoke test | 🔜 |

---

## Running locally

### Prerequisites

- Node.js 20+, Java 21, Python 3.12
- AWS CLI configured (`aws configure`)
- CDK bootstrapped (`npx cdk bootstrap`)

### Deploy to AWS

```bash
# Build Java services
mvn clean package -q -DskipTests -f services/poller-lambda/pom.xml
mvn clean package -q -DskipTests -f services/normalizer-lambda/pom.xml
mvn clean package -q -DskipTests -f services/mcp-lambda/pom.xml

# Store Anthropic API key
aws ssm put-parameter \
  --name /flighttracker/anthropic-api-key \
  --value "sk-ant-..." \
  --type SecureString

# Deploy all stacks
cd cdk && npm ci
npx cdk deploy --all --require-approval never
```

### Test the chat endpoint

```bash
# Live (requires Anthropic API credits)
curl -sN -X POST <function-url>/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What planes are over Colorado?", "history": []}'

# Mock mode (no API key needed)
curl -sN -X POST "<function-url>/chat?mock=true" \
  -H "Content-Type: application/json" \
  -d '{"message": "Where is AAL123?", "history": []}'
```

The function URL is printed by `cdk deploy` as `compute-stack.ChatServiceChatFunctionUrl`.

---

## Cost estimate (MVP)

| Service | $/month |
|---|---|
| Kinesis (1 shard) | ~$15 |
| API Gateway | ~$3 |
| DynamoDB (on-demand) | ~$1 |
| S3 + Firehose | ~$1 |
| Lambda (all) | ~$0 (free tier) |
| Anthropic API | ~$10–30 (usage) |
| **Total** | **~$30–50** |

---

## License

MIT
