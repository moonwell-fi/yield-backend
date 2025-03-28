import { createMoonwellClient } from '@moonwell-fi/moonwell-sdk';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { serializeMarket } from './serializers/market';
import { serializeVault } from './serializers/vault';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
  'content-type': 'application/json'
}

const respond = (response: Record<string, unknown>, code: number = 200): Response => {
  const body = JSON.stringify(response, null, 2);
  const init = {
    status: code,
    headers: corsHeaders,
    statusText: code === 200 ? 'OK' : 'Error'
  };
  const res = new Response(body, init);
  
  // Log response for debugging
  console.log('Created response:', res);
  console.log('Response type:', typeof res);
  console.log('Response properties:', Object.keys(res));
  
  return res;
}

export interface Env {
  MY_BUCKET: R2Bucket;
  BASE_RPC_URL: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const uri = 'market-vault-yields.json'
    const object = await env.MY_BUCKET.get(uri)

    if (
      (object === null) ||
      (object.uploaded.getTime() < (Date.now()) - (10000))
    ) { // Cached object is not found or older than 10 seconds
      console.log('Cache miss, fetching new data...')
      const moonwellClient = createMoonwellClient({
        networks: {
          base: {
            rpcUrls: [env.BASE_RPC_URL],
          },
        },
      });

      const markets = await moonwellClient.getMarkets({chainId: 8453});
      const vaults = await moonwellClient.getMorphoVaults({includeRewards: true});

      // Create the output object
      const output: {
        markets: Record<string, any>;
        vaults: Record<string, any>;
      } = {
        markets: {},
        vaults: {}
      };

      // Serialize markets
      markets.forEach(market => {
        const serializedMarket = serializeMarket(market);
        if (serializedMarket && serializedMarket.marketKey) {
          output.markets[serializedMarket.marketKey] = serializedMarket;
        }
      });

      // Serialize vaults
      vaults.forEach(vault => {
        const serializedVault = serializeVault(vault);
        if (serializedVault && serializedVault.vaultKey) {
          output.vaults[serializedVault.vaultKey] = serializedVault;
        }
      });

      console.log('Fetched data:', output);

      // Cache the data
      await env.MY_BUCKET.put(uri, JSON.stringify({
        uploaded: new Date(),
        data: output
      }));

      return respond(output);
    }

    // Return cached data
    const data = await object.json() as { data: Record<string, unknown> };
    return respond(data.data);
  },
}
