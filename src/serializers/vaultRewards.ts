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

const VaultRewardsResponseSchema = z.object({
  data: z.object({
    vaults: z.object({
      items: z.array(
        z.object({
          address: z.string(),
          state: z
            .object({
              allRewards: z.array(RewardSchema),
            })
            .nullable(),
        }),
      ),
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

    for (const vault of parsed.data.data.vaults.items) {
      if (!vault.state) continue;

      const rewards: SerializedVault['rewards'] = vault.state.allRewards.map((reward) => ({
        asset: {
          address: reward.asset.address,
          name: reward.asset.symbol,
          symbol: reward.asset.symbol,
          decimals: reward.asset.decimals,
        },
        // Scale decimal APR -> percentage to match baseApy/totalApy units.
        supplyApr: reward.supplyApr * 100,
        supplyAmount: 0,
        borrowApr: 0,
        borrowAmount: 0,
      }));

      const rewardsApy = rewards.reduce((sum, reward) => sum + reward.supplyApr, 0);
      result.set(vault.address.toLowerCase(), { rewards, rewardsApy });
    }
  } catch (error) {
    console.error('[morpho-api] vault rewards fetch threw:', error);
  }

  return result;
};
