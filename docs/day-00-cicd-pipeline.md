# Day 0: GitHub Actions CI/CD Pipeline & AWS Setup

## Table of Contents
1. [Goal](#goal)
2. [Overview](#overview)
3. [Step 1 — Create Your AWS Account](#step-1--create-your-aws-account)
4. [Step 2 — Create Your GitHub Repository](#step-2--create-your-github-repository)
5. [Step 3 — Connect AWS to GitHub via OIDC](#step-3--connect-aws-to-github-via-oidc)
6. [Step 4 — Bootstrap CDK in Your AWS Account](#step-4--bootstrap-cdk-in-your-aws-account)
7. [Step 5 — Store Secrets in GitHub](#step-5--store-secrets-in-github)
8. [Step 6 — GitHub Actions Workflows](#step-6--github-actions-workflows)
9. [Branch & Deploy Strategy](#branch--deploy-strategy)
10. [Success Criteria](#success-criteria)

---

## Goal

Before writing a single line of application code, get the deployment pipeline in place. Every subsequent day's work should be committable and automatically deployable via this pipeline. Manual `cdk deploy` commands are only used for one-off debugging — all real deployments go through GitHub Actions.

---

## Overview

```
Developer pushes code
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
                ├── cdk deploy compute-stack
                └── Vercel picks up the same merge automatically
```

**Why GitHub OIDC instead of access keys:**
Never store AWS access keys as GitHub secrets. OIDC lets GitHub Actions assume an IAM role directly using a short-lived token — no long-lived credentials, no rotation required, no risk of key leaks.

---

## Step 1 — Create Your AWS Account

If you don't have one already:

1. Go to [aws.amazon.com](https://aws.amazon.com) and create an account
2. Add a payment method (costs stay within the ~$30–50/mo estimate at MVP scale)
3. Enable MFA on the root account — go to **IAM → Security credentials → Assign MFA**
4. Choose a home region — `us-east-1` is recommended (cheapest, most services available). All CDK stacks will deploy here
5. Note your **AWS Account ID** (12-digit number) — you'll need it in Step 3. Find it under the account menu top-right in the AWS Console

---

## Step 2 — Create Your GitHub Repository

1. Create a new **private** repository on GitHub — e.g. `up-in-the-sky`
2. Clone it locally
3. Set up the monorepo structure:

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
    └── ...
```

4. Push the initial structure to `main`

---

## Step 3 — Connect AWS to GitHub via OIDC

This is a one-time manual setup in your AWS account. Do this from the AWS Console.

### 3a. Create the OIDC Identity Provider

1. Go to **IAM → Identity providers → Add provider**
2. Select **OpenID Connect**
3. Provider URL: `https://token.actions.githubusercontent.com`
4. Click **Get thumbprint**
5. Audience: `sts.amazonaws.com`
6. Click **Add provider**

### 3b. Create the IAM Role for GitHub Actions

1. Go to **IAM → Roles → Create role**
2. Trusted entity type: **Web identity**
3. Identity provider: `token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`
5. GitHub organization/user: your GitHub username
6. GitHub repository: `up-in-the-sky`
7. Click **Next**

**Attach these permissions policies:**
| Policy | Why |
|---|---|
| `AWSCloudFormationFullAccess` | CDK deploys via CloudFormation |
| `AmazonDynamoDBFullAccess` | CDK creates DynamoDB tables |
| `AmazonKinesisFullAccess` | CDK creates Kinesis streams |
| `AWSLambda_FullAccess` | CDK creates Lambda functions |
| `AmazonAPIGatewayAdministrator` | CDK creates API Gateway |
| `AmazonS3FullAccess` | CDK creates S3 buckets |
| `AmazonKinesisFirehoseFullAccess` | CDK creates Firehose |
| `IAMFullAccess` | CDK creates IAM roles for Lambdas |
| `SSMFullAccess` | CDK reads SSM parameters |
| `AmazonAthenaFullAccess` | History queries against S3 |

8. Name the role: `github-actions-up-in-the-sky`
9. Note the **Role ARN** — looks like `arn:aws:iam::123456789012:role/github-actions-up-in-the-sky`

---

## Step 4 — Bootstrap CDK in Your AWS Account

CDK bootstrap is a one-time setup that creates an S3 bucket and ECR repository in your account for CDK assets. Run this locally once with your own AWS credentials (not GitHub Actions).

### Install prerequisites locally
```bash
npm install -g aws-cdk
aws configure   # enter your Access Key ID + Secret (create one in IAM → Users for local use only)
```

### Bootstrap
```bash
cd cdk
npm install
cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

You should see `✅ Environment aws://123456789012/us-east-1 bootstrapped` — this only needs to be done once per account/region.

---

## Step 5 — Store Secrets in GitHub

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Notes |
|---|---|---|
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID | Used to construct the role ARN |
| `AWS_REGION` | `us-east-1` | Must match your bootstrap region |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Written to SSM by the deploy workflow |

**Do not store AWS access keys here.** The OIDC role handles authentication — these three values are all that's needed.

---

## Step 6 — GitHub Actions Workflows

### CI Workflow — `.github/workflows/ci.yml`
Runs on every PR. Validates the CDK stacks compile and posts an infrastructure diff as a PR comment. No deployment.

```yaml
name: CI

on:
  pull_request:
    branches: [main]

permissions:
  id-token: write      # Required for OIDC
  contents: read
  pull-requests: write # Required to post diff as PR comment

jobs:
  cdk-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install CDK deps
        run: npm ci
        working-directory: cdk

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/github-actions-up-in-the-sky
          aws-region: ${{ secrets.AWS_REGION }}

      - name: CDK Synth
        run: npx cdk synth
        working-directory: cdk

      - name: CDK Diff
        run: npx cdk diff --all 2>&1 | tee diff-output.txt
        working-directory: cdk

      - name: Post diff as PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const diff = fs.readFileSync('cdk/diff-output.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '## CDK Diff\n```\n' + diff + '\n```'
            });
```

### Deploy Workflow — `.github/workflows/deploy.yml`
Runs on merge to `main`. Deploys all CDK stacks in order.

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  cdk-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install CDK deps
        run: npm ci
        working-directory: cdk

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/github-actions-up-in-the-sky
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Write Anthropic API key to SSM
        run: |
          aws ssm put-parameter \
            --name "/flighttracker/anthropic-api-key" \
            --value "${{ secrets.ANTHROPIC_API_KEY }}" \
            --type SecureString \
            --overwrite

      - name: Deploy data-stack
        run: npx cdk deploy data-stack --require-approval never
        working-directory: cdk

      - name: Deploy api-stack
        run: npx cdk deploy api-stack --require-approval never
        working-directory: cdk

      - name: Deploy compute-stack
        run: npx cdk deploy compute-stack --require-approval never
        working-directory: cdk
```

---

## Branch & Deploy Strategy

| Branch | Trigger | Action |
|---|---|---|
| `main` | Push / merge | Full CDK deploy to production |
| Any PR | Open / update | CDK synth + diff comment, no deploy |
| Feature branches | Push | Nothing — no workflow triggered |

This is a single-environment setup appropriate for MVP. When you're ready to add a staging environment, duplicate the deploy workflow with a `dev` branch trigger and a separate CDK environment/account.

---

## Success Criteria

- [ ] AWS account created, root MFA enabled
- [ ] GitHub repo created with monorepo structure committed
- [ ] OIDC identity provider created in AWS IAM
- [ ] `github-actions-up-in-the-sky` IAM role created with correct trust policy and permissions
- [ ] CDK bootstrapped in `us-east-1` — `cdk bootstrap` completes cleanly
- [ ] `AWS_ACCOUNT_ID`, `AWS_REGION`, and `ANTHROPIC_API_KEY` stored as GitHub secrets
- [ ] CI workflow runs on an open PR — synth passes, diff posted as comment
- [ ] Deploy workflow runs on merge to main — all three stacks deploy without error
- [ ] No AWS access keys stored anywhere in the repo or GitHub secrets
