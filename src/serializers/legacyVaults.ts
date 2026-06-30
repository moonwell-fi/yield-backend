import type { SerializedVault } from './vault';

// The public API keeps its original vault keys. Newer SDK versions repoint
// those keys to the new V2 wrapper vaults and rename the original V1 vaults to
// `*v1` (e.g. `mwcbBTC` -> V2 wrapper, `mwcbBTCv1` -> the vault this API has
// always served). We serve the V1 vaults under their legacy keys (V1 holds the
// real TVL) and drop the rest.
export const LEGACY_VAULT_KEYS: Record<string, string> = {
  mwETHv1: 'mwETH',
  mwUSDCv1: 'mwUSDC',
  mwEURCv1: 'mwEURC',
  mwcbBTCv1: 'mwcbBTC',
  meUSDCv1: 'meUSDC',
};

// Map the serialized SDK vaults onto the legacy public API keys.
//
// The SDK's Lunar path routes V2 deposits through the underlying V1 vault, so
// it substitutes the V1 vault's TVL into the V2 wrapper but keeps the reward
// and APY data — including the WELL rewards — on the V2 wrapper. Because we
// serve the V1 vault under the legacy key, its `rewardsApy`/`rewards` are empty
// and the API reports the base APY only (MOO-501, a recurrence of MOO-391 for
// cbBTC). Overlay the paired V2 wrapper's APY/reward fields onto the served V1
// vault so the full reward APY is reported, while keeping V1's TVL, token
// address and identity unchanged.
export const mapVaultsToLegacyKeys = (
  serializedVaults: (SerializedVault | null)[],
): Record<string, SerializedVault> => {
  const byKey = new Map<string, SerializedVault>();
  for (const vault of serializedVaults) {
    if (vault && vault.vaultKey) byKey.set(vault.vaultKey, vault);
  }

  const output: Record<string, SerializedVault> = {};
  for (const [v1Key, legacyKey] of Object.entries(LEGACY_VAULT_KEYS)) {
    const v1Vault = byKey.get(v1Key);
    if (!v1Vault) continue;
    // The V2 wrapper vault is keyed by the legacy key (e.g. `mwcbBTC`).
    const v2Vault = byKey.get(legacyKey);
    output[legacyKey] = {
      ...v1Vault,
      // Reward/APY fields come from the V2 wrapper, which carries the WELL
      // rewards; fall back to the V1 values if the wrapper is unavailable.
      ...(v2Vault
        ? {
            baseApy: v2Vault.baseApy,
            rewardsApy: v2Vault.rewardsApy,
            totalApy: v2Vault.totalApy,
            rewards: v2Vault.rewards,
          }
        : {}),
      vaultKey: legacyKey,
      vaultToken: {
        ...v1Vault.vaultToken,
        // Restore the on-chain token labels (the SDK renamed its V1 config
        // entries to "... V1" / "*v1" when V2 was introduced).
        symbol: legacyKey,
        name: v1Vault.vaultToken.name.replace(/ V1$/, ''),
      },
    };
  }
  return output;
};
