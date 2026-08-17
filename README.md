# Moonwell Yield Backend

A Cloudflare Worker that provides real-time market and vault information for the Moonwell protocol on Base. This service fetches data from Moonwell's smart contracts using the Moonwell-SDK, processes it, and caches the results in Cloudflare R2 for efficient access.

## Features

- Real-time market and vault data from the Moonwell protocol
- Comprehensive yield information including APY/APRs
- Data caching with Cloudflare R2
- Modular code structure with TypeScript
- CORS-enabled API endpoint
- Sentry error reporting and performance tracing for R2, Moonwell RPC, and Morpho API calls

## API

### GET /

Returns the current market and vault yield information.

The response carries freshness metadata: `uploaded` (ISO timestamp of when the
data was fetched) and `stale` (`true` when the cache is older than the 3-minute
refresh interval — the data is still served, but consumers can decide how much
to trust it). The same information is exposed via the `Age` (seconds) and
`X-Cache-Status` (`live` | `fresh` | `stale`) response headers.

Example response:
```json
{
  "uploaded": "2026-08-17T16:00:00.000Z",
  "stale": false,
  "markets": {
    [marketKey: string]: {
      "marketKey": string,
      "deprecated": boolean,
      "mintPaused": boolean,
      "borrowPaused": boolean,
      "seizePaused": boolean,
      "transferPaused": boolean,
      "marketToken": {
        "address": string,
        "name": string,
        "symbol": string,
        "decimals": number
      },
      "underlyingToken": {
        "address": string,
        "name": string,
        "symbol": string,
        "decimals": number
      },
      "collateralFactor": number,
      "reserveFactor": number,
      "exchangeRate": number,
      "underlyingPrice": number,
      "supplyCaps": {
        "value": string,
        "decimals": number
      },
      "supplyCapsUsd": number,
      "borrowCaps": {
        "value": string,
        "decimals": number
      },
      "borrowCapsUsd": number,
      "totalSupply": {
        "value": string,
        "decimals": number
      },
      "totalSupplyUsd": number,
      "totalBorrows": {
        "value": string,
        "decimals": number
      },
      "totalBorrowsUsd": number,
      "totalReserves": {
        "value": string,
        "decimals": number
      },
      "totalReservesUsd": number,
      "cash": {
        "value": string,
        "decimals": number
      },
      "baseSupplyApy": number,
      "baseBorrowApy": number,
      "totalSupplyApr": number,
      "totalBorrowApr": number,
      "rewards": [
        {
          "token": {
            "address": string,
            "name": string,
            "symbol": string,
            "decimals": number
          },
          "supplyApr": number,
          "borrowApr": number,
          "liquidStakingApr": number
        }
      ]
    }
  },
  "vaults": {
    [vaultKey: string]: {
      "vaultKey": string,
      "vaultToken": {
        "address": string,
        "name": string,
        "symbol": string,
        "decimals": number
      },
      "underlyingToken": {
        "address": string,
        "name": string,
        "symbol": string,
        "decimals": number
      },
      "underlyingPrice": number,
      "baseApy": number,
      "totalApy": number,
      "rewardsApy": number,
      "curators": string[],
      "performanceFee": number,
      "timelock": number,
      "totalLiquidity": {
        "value": string,
        "decimals": number
      },
      "totalLiquidityUsd": number,
      "totalSupply": {
        "value": string,
        "decimals": number
      },
      "totalSupplyUsd": number,
      "market": {
        "marketKey": string,
        "collateralFactor": number,
        "underlyingToken": {
          "address": string,
          "name": string,
          "symbol": string,
          "decimals": number
        },
        "totalSupply": {
          "value": string,
          "decimals": number
        },
        "totalBorrows": {
          "value": string,
          "decimals": number
        },
        "supplyApy": number,
        "borrowApy": number
      },
      "rewards": [
        {
          "token": {
            "address": string,
            "name": string,
            "symbol": string,
            "decimals": number
          },
          "apy": number
        }
      ]
    }
  }
}
```

## Development

### Prerequisites

- Node.js 16+
- npm or yarn
- Cloudflare Workers account
- Cloudflare R2 bucket

### Setup

1. Clone the repository
```bash
git clone <repository-url>
cd yield-backend
```

2. Install dependencies
```bash
npm install
```

### Development Server

Run the development server:
```bash
npm run dev
```

### Testing

Run the test suite:
```bash
npm test
```

### Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

The production Sentry DSN is configured in `wrangler.toml`. Ten percent of
requests are performance-traced; handled upstream and cache failures are
reported with low-cardinality component and operation tags. Each event is tied
to the deployed Cloudflare Worker version, and Cloudflare source maps are
uploaded for readable Worker log stack traces.

## Operations

### How data stays fresh

A cron trigger (`wrangler.toml` `[triggers]`, every 3 minutes) runs the
`scheduled` handler, which fetches fresh data and rewrites the R2 blob
(`market-vault-yields.json`). Requests always serve the blob directly and never
refresh inline (except on a cold/empty bucket). If refreshes keep failing, the
API keeps serving the last good data flagged `"stale": true` — it does not 503
unless `HARD_FAIL_AFTER_MAX_STALE` is flipped in `src/index.ts`.

### Check freshness

```bash
curl -s https://yield-backend.moonwell.workers.dev/ | jq '{uploaded, stale}'
```

```bash
curl -sI https://yield-backend.moonwell.workers.dev/ | grep -i -e '^age' -e 'x-cache-status'
```

`uploaded` should never be more than a few minutes old. If `stale` is `true`,
the cron refresh is failing — check Sentry and `wrangler tail`.

### Deploy safely

- `wrangler deploy` **replaces all dashboard plaintext vars** with the `[vars]`
  block in `wrangler.toml`. Anything not in the repo must be a wrangler secret:
  `npx wrangler secret put BASE_RPC_URL`. Secrets survive deploys.
- Deploy from a clean install (`npm ci`) so the bundled SDK matches the
  lockfile — the bundle is built from your local `node_modules`.

### Debugging

- Live logs: `npx wrangler tail yield-backend --format pretty`.
- Sentry tags: `response_source` (`live` / `fresh_cache` / `stale_cache` /
  `unavailable`), `cache_state`, `cache_age_bucket`, and `upstream_branch`
  (which refresh stage threw: `moonwell_markets`, `moonwell_morpho_vaults`,
  `serialize_payload`, `morpho_blue_vault_rewards`, `apply_vault_rewards`).
- The Lunar Indexer is reached via `https://lunar-services-worker.moonwell.fi`
  (set in `src/refresh.ts`). The SDK's default `workers.dev` host is
  unreachable from Cloudflare Workers (same-account restriction) — if the SDK
  ever falls back to on-chain vault fetching, look for
  `Failed to fetch vaults from Lunar Indexer` in the logs.

### Sentry alert rules (configured in the Sentry dashboard)

Alert on these fixed messages emitted by the `scheduled` handler:

- `yields cache stale beyond 30m` (warning) — refresh has been failing for 30+
  minutes.
- `yields cache stale beyond 6h` (error) — served data is seriously outdated.
- `BASE_RPC_URL binding is missing` (fatal) — a deploy wiped the RPC secret.
