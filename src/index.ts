import { createMoonwellClient } from '@moonwell-fi/moonwell-sdk';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { serializeMarket } from './serializers/market';
import { serializeVault } from './serializers/vault';
import { mapVaultsToLegacyKeys } from './serializers/legacyVaults';

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

const logEvent = (event: string, details: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...details,
  }));
};

const cacheAgeBucket = (ageMs: number | null): string => {
  if (ageMs === null || Number.isNaN(ageMs)) return 'unknown';
  if (ageMs < 60_000) return 'lt_1m';
  if (ageMs < 180_000) return '1m_3m';
  if (ageMs < 600_000) return '3m_10m';
  if (ageMs < 3_600_000) return '10m_1h';
  if (ageMs < 21_600_000) return '1h_6h';
  if (ageMs < 86_400_000) return '6h_24h';
  return 'gt_24h';
};

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
    let cachedPayload: { data: Record<string, unknown>, uploaded: string } | null = null;
    const nowMs = Date.now();

    if (object) {
      try {
        cachedPayload = await object.json() as { data: Record<string, unknown>, uploaded: string };
      } catch (error) {
        console.error('Failed to parse cached payload from R2:', error);
        logEvent('cache_parse_error', { uri });
      }
    }

    const cacheExists = cachedPayload !== null;
    const cacheUploadedMs = cacheExists ? new Date(cachedPayload.uploaded).getTime() : 0;
    const cacheAgeMs = cacheExists ? (nowMs - cacheUploadedMs) : null;
    const cacheIsStale = cacheExists && (Number.isNaN(cacheUploadedMs) || cacheUploadedMs < (nowMs - 180000));

    if (!cacheExists || cacheIsStale) {
      // Cache is missing or older than 180 seconds/3 minutes
      console.log('Cache miss or stale - attempting to fetch fresh data...')
      logEvent(cacheExists ? 'cache_stale' : 'cache_miss', {
        uri,
        cache_age_ms: cacheAgeMs,
        cache_age_bucket: cacheAgeBucket(cacheAgeMs),
      });
      
      try {
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

        // Serialize vaults and remap them onto the legacy public API keys,
        // folding the WELL reward APY from each V2 wrapper into the V1 vault we
        // serve (see mapVaultsToLegacyKeys).
        output.vaults = mapVaultsToLegacyKeys(vaults.map(serializeVault));

        console.log('Successfully fetched fresh data');
        logEvent('upstream_success', { uri });

        // Cache the data (non-fatal if cache write fails)
        try {
          await env.MY_BUCKET.put(uri, JSON.stringify({
            uploaded: new Date(),
            data: output
          }));
        } catch (error) {
          console.error('Failed to update cache in R2:', error);
          logEvent('cache_write_error', { uri });
        }

        return respond(output);
      } catch (error) {
        // SDK request failed - try to return stale cached data as fallback
        console.error('SDK request failed:', error);
        logEvent('upstream_error', { uri });
        
        if (cacheExists) {
          const cacheAge = Date.now() - new Date(cachedPayload.uploaded).getTime();
          console.log(`Returning stale cached data as fallback (age: ${Math.round(cacheAge / 1000)}s)`);
          logEvent('cache_fallback', {
            uri,
            cache_age_ms: cacheAge,
            cache_age_bucket: cacheAgeBucket(cacheAge),
          });
          return respond(cachedPayload.data);
        }
        
        // No cached data available at all
        console.error('No cached data available for fallback');
        logEvent('cache_fallback_unavailable', { uri });
        return respond({ error: 'Service temporarily unavailable', message: 'Unable to fetch data and no cached data available' }, 503);
      }
    }

    // Return fresh cached data (within 180s TTL)
    console.log('Cache hit - returning fresh cached data');
    logEvent('cache_hit_fresh', {
      uri,
      cache_age_ms: cacheAgeMs,
      cache_age_bucket: cacheAgeBucket(cacheAgeMs),
    });
    return respond(cachedPayload.data);
  },
}
