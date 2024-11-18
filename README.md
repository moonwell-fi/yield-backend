# Moonwell Yield Backend

A Cloudflare Worker that provides real-time market and vault information for the Moonwell protocol on Base chain. This service fetches data from Moonwell's smart contracts using the moonwell-sdk, processes it, and caches the results in Cloudflare R2 for efficient access.

## Features

- Real-time market and vault data from Moonwell protocol
- Comprehensive yield information including APY/APR
- Data caching with Cloudflare R2
- Modular code structure with TypeScript
- CORS-enabled API endpoint

## API

### GET /

Returns the current market and vault yield information.

Example response:
```json
{
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
