# easy-api

English | [简体中文](./README.zh-CN.md)

OpenAI-compatible gateway for OpenRouter that auto-selects healthy models, prefers free ones, falls back when they fail, and keeps your client API stable.

`easy-api` is a small server for developers who want OpenAI-style client integrations without manually tracking OpenRouter model churn, fallback chains, or basic multimodal routing.

## Why this project exists

Using OpenRouter directly is flexible, but it also means dealing with moving targets:

- free models appear and disappear
- quality and latency can change fast
- different models support different modalities and features
- client apps usually do not want to maintain routing and fallback logic

`easy-api` moves that complexity to the server side and keeps the downstream API predictable.

## Good fit

- You want to keep using OpenAI SDKs.
- You want free models first.
- You want routing, fallback, and image preprocessing handled on the server.

## Not the goal

- Not a chat UI
- Not a billing platform
- Not a multi-tenant control plane
- Not a promise of "always the best model"
- Not a guarantee that free models will always behave well

## Available endpoints

- `GET /health`
- `GET /v1/models`
- `GET /v1/models/auto`
- `GET /v1/capabilities`
- `GET /v1/metrics`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/route/debug`

## What it already does

- Syncs the OpenRouter model catalog
- Routes requests across healthy candidates
- Prefers free models by default
- Keeps paid fallback disabled by default
- Supports fallback chains across free candidates
- Handles image requests through direct routing or orchestration
- Exposes both `chat/completions` and `responses`
- Supports SSE streaming
- Returns route debug metadata when requested
- Writes optional NDJSON telemetry
- Exposes in-process metrics and Prometheus-style output
- Short-circuits pure exact-reply prompts like `smoke-ok`

## Quick start

### Requirements

- Node.js 22+
- npm

### Install

```bash
npm install
```

### Configure

Copy [`.env.example`](./.env.example) to `.env`.

If you only want to start the service, run tests, or inspect the API shape, `OPENROUTER_API_KEY` is optional.

If you want real upstream generation through OpenRouter, set:

```env
OPENROUTER_API_KEY=your_test_key
```

Important default:

- `ALLOW_PAID_FALLBACK=false`

That means the gateway will prefer free models and will not automatically downgrade from free models to paid models unless you explicitly turn it on.

If you really want that behavior, set:

```env
ALLOW_PAID_FALLBACK=true
```

The server loads:

- `.env`
- `.env.local`

### Start

Development:

```bash
npm run dev
```

Production-style run:

```bash
npm run build
npm start
```

Default address:

- `http://127.0.0.1:3000`

### Smoke test

```bash
curl http://127.0.0.1:3000/health
```

Expected:

```json
{
  "status": "ok",
  "service": "easy-api"
}
```

### First chat request

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto:free",
    "messages": [
      {
        "role": "user",
        "content": "Introduce yourself in one sentence."
      }
    ]
  }'
```

## OpenAI SDK example

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "easy-api-local",
  baseURL: "http://127.0.0.1:3000/v1"
});

const response = await client.chat.completions.create({
  model: "auto:free",
  messages: [
    {
      role: "user",
      content: "Only reply with smoke-ok."
    }
  ]
});

console.log(response.choices[0]?.message?.content);
```

Notes:

- Client-supplied API keys are not validated in the current version.
- The `apiKey` above is only there because OpenAI SDKs expect one.
- Real upstream access is controlled by the server-side `OPENROUTER_API_KEY`.

## Useful endpoints

### `GET /v1/models`

Returns the model list exposed by the gateway, including stable aliases such as:

- `auto`
- `auto:free`
- `auto:vision`
- `auto:coding`
- `auto:reasoning`

### `GET /v1/models/auto`

Shows how those aliases currently resolve, including selected models and fallback chains.

### `POST /v1/chat/completions`

Best default entrypoint for most OpenAI-style clients.

Supports:

- text requests
- image requests
- tool calling
- SSE streaming
- debug metadata

### `POST /v1/responses`

Alternative OpenAI-style entrypoint for clients closer to the newer Responses API.

### `POST /v1/route/debug`

Explains how a request would be routed without fully executing generation.

### `GET /v1/capabilities`

Summarizes what the gateway can currently do under the active catalog snapshot.

### `GET /v1/metrics`

Returns in-process request statistics.

Prometheus-style output:

```bash
curl "http://127.0.0.1:3000/v1/metrics?format=prometheus"
```

## Debugging

You can enable route metadata in any of these ways:

- add `?debug=1`
- send `x-easyapi-debug: 1`
- set `ENABLE_DEBUG_ROUTE_METADATA=true`

For non-streaming requests, debug data is returned in the response body's `route` field.

For streaming requests, debug data is returned through headers such as:

- `x-easyapi-selected-model`
- `x-easyapi-actual-model`
- `x-easyapi-fallback-used`
- `x-easyapi-attempted-models`

## Important environment variables

- `HOST`
  Bind address. Default: `0.0.0.0`
- `PORT`
  Bind port. Default: `3000`
- `LOG_LEVEL`
  Log level. Default: `info`
- `OPENROUTER_API_KEY`
  Required for real upstream OpenRouter execution
- `ENABLE_DEBUG_ROUTE_METADATA`
  Always include debug route metadata
- `ALLOW_PAID_FALLBACK`
  Allows free-to-paid downgrade. Default: off
- `ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK`
  Allows runtime fallback when an explicitly selected model fails with retryable upstream errors
- `TELEMETRY_REQUEST_LOG_PATH`
  Appends request telemetry to an NDJSON file

See [`.env.example`](./.env.example) for a full example.

## Current limits

- Without `OPENROUTER_API_KEY`, the server still boots, but real upstream generation returns `upstream_unavailable`.
- Free models are inherently unstable in availability, latency, and instruction-following quality.
- Some image requests may use a two-stage orchestration flow and therefore have higher latency.
- Client authentication, account management, billing, and stored conversation state are not implemented.
- The goal is not to mirror every OpenAI endpoint and field on day one.

## Shortcut for exact replies

For requests like:

- `Please only reply with smoke-ok.`
- `Only reply with OK.`

the gateway can detect that the expected output is a fixed literal string and return it directly instead of sending the request upstream.

This is intentionally simple. It exists to make strict short-answer checks more reliable when using unstable free models.

## Documentation

More project docs are available here:

- [Local setup](./docs/development/local-setup.md)
- [API contract](./docs/api/openai-compatible-contract.md)
- [Project brief](./docs/product/project-brief.md)
- [Routing and orchestration spec](./docs/architecture/routing-and-orchestration-spec.md)

Note: those deeper docs are currently written in Chinese.

## Common commands

```bash
npm install
npm run dev
npm run test
npm run check
npm run build
npm start
```

## License

This project is licensed under the [MIT License](./LICENSE).
