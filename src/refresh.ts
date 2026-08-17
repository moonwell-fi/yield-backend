import * as Sentry from '@sentry/cloudflare';
import { createMoonwellClient } from '@moonwell-fi/moonwell-sdk';
import { serializeMarket } from './serializers/market';
import { serializeVault } from './serializers/vault';
import { mapVaultsToLegacyKeys } from './serializers/legacyVaults';
import { fetchVaultRewards } from './serializers/vaultRewards';
import { logEvent } from './log';

export interface Env {
  MY_BUCKET: R2Bucket;
  BASE_RPC_URL: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  CF_VERSION_METADATA: WorkerVersionMetadata;
}

export const CACHE_URI = 'market-vault-yields.json';

export interface CachedPayload {
  uploaded: string;
  data: Record<string, unknown>;
}

// The SDK defaults every indexer read to lunar-services-worker.moonwell.workers.dev,
// but Cloudflare Workers cannot fetch same-account workers.dev hosts — in production
// the fetch fails and the SDK silently degrades. The custom domain works from
// everywhere. Remove once createMoonwellClient accepts lunarIndexerUrl (SDK follow-up).
export const LUNAR_INDEXER_URL = 'https://lunar-services-worker.moonwell.fi';

export interface YieldsOutput extends Record<string, unknown> {
  markets: Record<string, any>;
  vaults: Record<string, any>;
}

export const fetchFreshYields = async (env: Pick<Env, 'BASE_RPC_URL'>): Promise<YieldsOutput> => {
  if (!env.BASE_RPC_URL) {
    const error = new Error('BASE_RPC_URL binding is missing — wrangler deploy replaces dashboard plaintext vars, keep it as a wrangler secret');
    Sentry.captureMessage(error.message, {
      level: 'fatal',
      tags: { component: 'config' },
    });
    throw error;
  }

  let upstreamBranch = 'moonwell_markets';
  try {
    const moonwellClient = createMoonwellClient({
      networks: {
        base: {
          rpcUrls: [env.BASE_RPC_URL],
        },
      },
    });
    moonwellClient.environments.base!.lunarIndexerUrl = LUNAR_INDEXER_URL;

    const markets = await Sentry.startSpan(
      { name: 'Moonwell markets', op: 'upstream.moonwell.markets' },
      () => moonwellClient.getMarkets({chainId: 8453}),
    );
    upstreamBranch = 'moonwell_morpho_vaults';
    const vaults = await Sentry.startSpan(
      { name: 'Moonwell Morpho vaults', op: 'upstream.moonwell.morpho_vaults' },
      () => moonwellClient.getMorphoVaults({includeRewards: true}),
    );
    upstreamBranch = 'serialize_payload';

    const output: YieldsOutput = {
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

    // Serialize vaults and remap them onto the legacy public API keys
    // (keeps each V1 vault's TVL and base APY; see mapVaultsToLegacyKeys).
    output.vaults = mapVaultsToLegacyKeys(vaults.map(serializeVault));

    // The SDK no longer exposes WELL reward APY on the vault objects, so
    // fetch it from the Morpho Blue API and overlay it onto the served
    // vaults. Failures degrade to base-APY-only (fetchVaultRewards never
    // throws and returns an empty map), so this never blocks the response.
    const vaultEntries = Object.values(output.vaults).filter(
      (vault): vault is { vaultToken: { address: string }; baseApy: number } & Record<string, unknown> =>
        typeof vault?.vaultToken?.address === 'string',
    );
    upstreamBranch = 'morpho_blue_vault_rewards';
    const vaultRewardsByAddress = await Sentry.startSpan(
      { name: 'Morpho Blue vault rewards', op: 'upstream.morpho_blue.vault_rewards' },
      () => fetchVaultRewards(
        vaultEntries.map((vault) => vault.vaultToken.address),
      ),
    );
    upstreamBranch = 'apply_vault_rewards';
    for (const vault of vaultEntries) {
      const overlay = vaultRewardsByAddress.get(vault.vaultToken.address.toLowerCase());
      if (!overlay) continue;
      vault.rewards = overlay.rewards;
      vault.rewardsApy = overlay.rewardsApy;
      vault.totalApy = vault.baseApy + overlay.rewardsApy;
    }

    logEvent('upstream_success', { uri: CACHE_URI });
    return output;
  } catch (error) {
    console.error('SDK request failed:', error);
    logEvent('upstream_error', { uri: CACHE_URI, upstream_branch: upstreamBranch });
    Sentry.captureException(error, {
      tags: {
        component: 'upstream',
        upstream_branch: upstreamBranch,
      },
      extra: { uri: CACHE_URI },
    });
    throw error;
  }
};

export const refreshCache = async (env: Env): Promise<CachedPayload> => {
  const output = await fetchFreshYields(env);
  const payload: CachedPayload = {
    uploaded: new Date().toISOString(),
    data: output,
  };

  // Cache the data (non-fatal if cache write fails)
  try {
    await env.MY_BUCKET.put(CACHE_URI, JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to update cache in R2:', error);
    logEvent('cache_write_error', { uri: CACHE_URI });
    Sentry.captureException(error, {
      tags: {
        component: 'r2',
        operation: 'cache_write',
      },
      extra: { uri: CACHE_URI },
    });
  }

  return payload;
};
