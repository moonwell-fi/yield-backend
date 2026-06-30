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
// We serve the V1 vault (which holds the real TVL) under its legacy key and
// keep its own `baseApy`/`totalApy`. We deliberately do NOT overlay APY/reward
// fields from the paired V2 wrapper: recent SDK versions return the wrapper with
// all-zero APY and empty rewards, so overlaying it wiped out the served vault's
// real base APY (MOO-501). WELL reward APY is no longer exposed on either the V1
// vault or the V2 wrapper by the SDK; it is fetched separately from the Morpho
// Blue API and overlaid downstream (see fetchVaultRewards / index.ts).
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
    output[legacyKey] = {
      ...v1Vault,
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
