import { z } from 'zod';
import type { SerializedVault } from './vault';

// Moonwell's WELL rewards on its Morpho vaults are distributed outside the
// MetaMorpho vault's native APY, and recent moonwell-sdk versions no longer
// surface them on the vault objects returned by `getMorphoVaults` (the SDK's
// Lunar V1/V2 split leaves both the served V1 vault and its V2 wrapper with
// empty reward data — see MOO-501). The Morpho Blue API still reports them, so
// we fetch vault reward APRs directly from there and overlay them onto the
// served vaults.
const MORPHO_BLUE_API_URL = 'https://blue-api.morpho.org/graphql';

// `state.rewards` is deprecated (removal 2026-09-30); `allRewards` is the
// replacement and additionally includes forwarded rewards.
const VAULT_REWARDS_QUERY = `
query GetVaultRewards($addresses: [String!]!, $chainId: Int!) {
  vaults(where: { address_in: $addresses, chainId_in: [$chainId] }) {
    items {
      address
      state {
        allRewards {
          supplyApr
          asset {
            address
            symbol
            decimals
          }
        }
      }
    }
  }
}
`;

const RewardSchema = z.object({
  supplyApr: z.number(),
  asset: z.object({
    address: z.string(),
    symbol: z.string(),
    decimals: z.number(),
  }),
});

// Validate the response per-item rather than as one strict schema. `allRewards`
// includes forwarded rewards whose shape can vary, and a single malformed entry
// must not drop rewards for every other vault — so the outer shape stays loose
// and each vault / reward is parsed and skipped individually below.
const VaultItemSchema = z.object({
  address: z.string(),
  state: z
    .object({
      allRewards: z.array(z.unknown()),
    })
    .nullable(),
});

const VaultRewardsResponseSchema = z.object({
  data: z.object({
    vaults: z.object({
      items: z.array(z.unknown()),
    }),
  }),
});

export interface VaultRewardsOverlay {
  // Reward entries shaped to match `SerializedVault.rewards`.
  rewards: SerializedVault['rewards'];
  // Summed supply APR across all reward tokens, in percentage units.
  rewardsApy: number;
}

/**
 * Fetch vault-level reward APRs from the Morpho Blue API for the given vault
 * addresses, keyed by lowercased address. APRs are returned by the API as
 * decimal fractions (e.g. 0.0078 = 0.78%); we scale by 100 so the values match
 * the percentage convention this API serves for `baseApy`/`totalApy`.
 *
 * Never throws: on a network/non-200/parse failure it returns an empty map so
 * callers degrade to base-APY-only instead of failing the whole response.
 */
export const fetchVaultRewards = async (
  vaultAddresses: string[],
  chainId = 8453,
): Promise<Map<string, VaultRewardsOverlay>> => {
  const result = new Map<string, VaultRewardsOverlay>();
  if (vaultAddresses.length === 0) return result;

  try {
    const response = await fetch(MORPHO_BLUE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: VAULT_REWARDS_QUERY,
        variables: { addresses: vaultAddresses, chainId },
      }),
    });

    if (!response.ok) {
      console.error(`[morpho-api] vault rewards fetch failed: ${response.status}`);
      return result;
    }

    const parsed = VaultRewardsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error('[morpho-api] vault rewards parse failed:', parsed.error);
      return result;
    }

    for (const rawVault of parsed.data.data.vaults.items) {
      // Skip a vault whose envelope is malformed rather than dropping every
      // other vault's rewards.
      const vault = VaultItemSchema.safeParse(rawVault);
      if (!vault.success || !vault.data.state) continue;

      const rewards: SerializedVault['rewards'] = [];
      for (const rawReward of vault.data.state.allRewards) {
        // Forwarded rewards can carry an unexpected shape; skip the bad entry
        // instead of discarding the whole vault's rewards.
        const reward = RewardSchema.safeParse(rawReward);
        if (!reward.success) continue;
        rewards.push({
          asset: {
            address: reward.data.asset.address,
            name: reward.data.asset.symbol,
            symbol: reward.data.asset.symbol,
            decimals: reward.data.asset.decimals,
          },
          // Scale decimal APR -> percentage to match baseApy/totalApy units.
          supplyApr: reward.data.supplyApr * 100,
          supplyAmount: 0,
          borrowApr: 0,
          borrowAmount: 0,
        });
      }

      const rewardsApy = rewards.reduce((sum, reward) => sum + reward.supplyApr, 0);
      result.set(vault.data.address.toLowerCase(), { rewards, rewardsApy });
    }
  } catch (error) {
    console.error('[morpho-api] vault rewards fetch threw:', error);
  }

  return result;
};
