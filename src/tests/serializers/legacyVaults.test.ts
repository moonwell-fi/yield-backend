import { describe, it, expect } from 'vitest';
import { mapVaultsToLegacyKeys } from '../../serializers/legacyVaults';
import type { SerializedVault } from '../../serializers/vault';

// Minimal SerializedVault factory; only fields exercised by the remap matter.
const makeVault = (overrides: Partial<SerializedVault>): SerializedVault => ({
  vaultKey: 'vault',
  vaultToken: { address: '0xvault', name: 'Vault', symbol: 'vault', decimals: 18 },
  underlyingToken: { address: '0xunder', name: 'Under', symbol: 'UNDER', decimals: 8 },
  underlyingPrice: 0,
  baseApy: 0,
  totalApy: 0,
  rewardsApy: 0,
  curators: [],
  performanceFee: 0,
  timelock: 0,
  totalLiquidity: { value: '0', decimals: 8 },
  totalLiquidityUsd: 0,
  totalSupply: { value: '0', decimals: 8 },
  totalSupplyUsd: 0,
  markets: [],
  rewards: [],
  ...overrides,
});

describe('mapVaultsToLegacyKeys', () => {
  it('keeps the served V1 vault base APY and never overlays the V2 wrapper (MOO-501)', () => {
    // The SDK returns the V2 wrapper with all-zero APY and empty rewards.
    // Overlaying it used to wipe out the served vault's real base APY; the
    // remap must now leave the V1 values untouched.
    const v1 = makeVault({
      vaultKey: 'mwcbBTCv1',
      vaultToken: { address: '0xV1', name: 'Moonwell Frontier cbBTC V1', symbol: 'mwcbBTCv1', decimals: 18 },
      baseApy: 0.0192,
      rewardsApy: 0,
      totalApy: 0.0192,
      rewards: [],
      totalSupplyUsd: 5_000_000,
    });
    const v2 = makeVault({
      vaultKey: 'mwcbBTC',
      vaultToken: { address: '0xV2', name: 'Moonwell Frontier cbBTC', symbol: 'mwcbBTC', decimals: 18 },
      baseApy: 0,
      rewardsApy: 0,
      totalApy: 0,
      rewards: [],
      totalSupplyUsd: 13, // V2 only holds idle assets
    });

    const result = mapVaultsToLegacyKeys([v1, v2]);

    expect(Object.keys(result)).toEqual(['mwcbBTC']);
    const served = result.mwcbBTC;
    // APY fields stay with V1 — the all-zero wrapper must not clobber them.
    expect(served.baseApy).toBeCloseTo(0.0192);
    expect(served.totalApy).toBeCloseTo(0.0192);
    // TVL and token identity stay with V1.
    expect(served.totalSupplyUsd).toBe(5_000_000);
    expect(served.vaultToken.address).toBe('0xV1');
    expect(served.vaultKey).toBe('mwcbBTC');
    // Legacy label restoration.
    expect(served.vaultToken.symbol).toBe('mwcbBTC');
    expect(served.vaultToken.name).toBe('Moonwell Frontier cbBTC');
  });

  it('serves the V1 vault values under the legacy key', () => {
    const v1 = makeVault({
      vaultKey: 'mwETHv1',
      vaultToken: { address: '0xV1', name: 'Moonwell Flagship ETH V1', symbol: 'mwETHv1', decimals: 18 },
      baseApy: 0.03,
      rewardsApy: 0,
      totalApy: 0.03,
      rewards: [],
    });

    const result = mapVaultsToLegacyKeys([v1]);

    expect(result.mwETH.baseApy).toBe(0.03);
    expect(result.mwETH.totalApy).toBe(0.03);
    expect(result.mwETH.vaultToken.symbol).toBe('mwETH');
    expect(result.mwETH.vaultToken.name).toBe('Moonwell Flagship ETH');
  });

  it('drops vaults that are not V1 legacy vaults', () => {
    const v2Only = makeVault({ vaultKey: 'mwcbBTC' });
    const unknown = makeVault({ vaultKey: 'someOtherVault' });

    const result = mapVaultsToLegacyKeys([v2Only, unknown]);

    expect(result).toEqual({});
  });

  it('ignores null serialized vaults', () => {
    const v1 = makeVault({ vaultKey: 'mwUSDCv1', rewardsApy: 0.02, totalApy: 0.05, baseApy: 0.03 });
    const result = mapVaultsToLegacyKeys([null, v1, null]);
    expect(result.mwUSDC.totalApy).toBe(0.05);
  });
});
