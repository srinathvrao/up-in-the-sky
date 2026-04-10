# up-in-the-sky ✈️

See what planes are flying above you — right now, based on your network location.

## What it does

up-in-the-sky detects your approximate location from your network (IP-based geolocation) and displays a live list of flights currently overhead. No GPS or permissions required.

## Architecture

```
sky-frontend/       # TypeScript/React UI
sky-backend/        # Java Lambda — fetches and serves flight data
cdk/                # AWS CDK stack — infrastructure as code
```

The app is fully serverless:

- **Frontend** — TypeScript/React app that fetches your network location and calls the backend API
- **Backend** — Java AWS Lambda that queries a flight data API for aircraft near the given coordinates
- **Infrastructure** — AWS CDK provisions the Lambda, API Gateway, and any supporting resources

## Getting Started

### Prerequisites

- Node.js 18+
- Java 17+
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

### Deploy the infrastructure

```bash
cd cdk
npm install
cdk bootstrap
cdk deploy
```

### Run the frontend locally

```bash
cd sky-frontend
npm install
npm run dev
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | TypeScript, React |
| Backend | Java, AWS Lambda |
| Infrastructure | AWS CDK, API Gateway |
| Location | IP-based geolocation |
| Flight Data | ADS-B / flight tracking API |

## License

MIT
