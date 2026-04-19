# Project Setup

## Table of Contents
1. [Development Process](#development-process)
2. [Repository Folder Skeleton](#repository-folder-skeleton)
3. [GitHub Actions Workflows](#github-actions-workflows)
4. [Branch & Deploy Strategy](#branch--deploy-strategy)

---

## Development Process

```
Claude pushes code to a dev branch
        │
        ├── PR to main
        │       │
        │   GitHub Actions: CI workflow
        │       ├── cdk synth (validates all stacks compile)
        │       ├── cdk diff (posts infrastructure diff as PR comment)
        │       └── No deploy — review first
        │
        └── Merge to main
                │
            GitHub Actions: Deploy workflow
                ├── cdk deploy data-stack
                ├── cdk deploy api-stack
                └── cdk deploy compute-stack
```

---

## Repository Folder Skeleton

1. Following is how it is initially organized (mostly empty folders).
2. You can ignore the cdk/ folder.
3. Implement the backend services or any lambdas in Java.

```
up-in-the-sky/
├── .github/
│   └── workflows/
│       ├── ci.yml         # PR checks — synth + diff
│       └── deploy.yml     # Merge to main — full deploy
├── cdk/                   # AWS CDK app (TypeScript)
│   ├── bin/
│   ├── lib/
│   └── package.json
├── services/
│   ├── chat-lambda/       # Python FastAPI chat service
│   ├── mcp-lambda/        # Python MCP server
│   ├── poller-lambda/     # adsb.lol poller
│   └── normalizer-lambda/ # Kinesis normalizer
└── frontend/              # Next.js app
    └── <TODO>
```

3. Always push your code to a branch off of 'main' and open a pull request.

---

## GitHub Actions Workflows

### CI Workflow — `.github/workflows/ci.yml`
Runs on every PR. Validates the CDK stacks compile and posts an infrastructure diff as a PR comment. No deployment.

### Deploy Workflow — `.github/workflows/deploy.yml`
Runs on merge to `main`. Deploys all CDK stacks in order.

---

## Branch & Deploy Strategy

| Branch | Trigger | Action |
|---|---|---|
| `main` | Push / merge | Full CDK deploy to production |
| Any PR | Open / update | CDK synth + diff comment, no deploy |
| Feature branches | Push | Nothing — no workflow triggered |
