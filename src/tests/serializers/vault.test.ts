import { describe, it, expect } from 'vitest';
import type { MorphoVault, TokenConfig, Amount, MorphoVaultMarket, MorphoReward } from '@moonwell-fi/moonwell-sdk';
import { serializeVault } from '../../serializers/vault';
import type { SerializedToken } from '../../serializers/token';

describe('serializeVault', () => {
  const mockToken: TokenConfig = {
    address: '0x123',
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 18,
    chainId: 1,
    logoURI: null,
    isNative: false,
    wrapped: null
  };

  const serializedToken: SerializedToken = {
    address: '0x123',
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 18
  };

  const mockAmount: Amount = {
    value: '1000000000000000000',
    decimals: 18
  };

  const mockReward: MorphoReward = {
    marketId: 'TEST-MARKET',
    asset: mockToken,
    supplyApr: 0.05,
    supplyAmount: 1000,
    borrowApr: 0.1,
    borrowAmount: 500
  };

  const mockMarket: MorphoVaultMarket = {
    marketId: 'TEST-MARKET',
    allocation: 0.5,
    marketCollateral: mockToken,
    marketApy: 0.08,
    marketLiquidity: mockAmount,
    marketLiquidityUsd: 1000000,
    marketLoanToValue: 0.8,
    totalSupplied: mockAmount,
    totalSuppliedUsd: 500000,
    rewards: [mockReward]
  };

  it('should handle null input', () => {
    expect(serializeVault(null)).toBeNull();
    expect(serializeVault(undefined)).toBeNull();
  });

  it('should handle empty vault key', () => {
    const emptyKeyVault = {
      vaultKey: ''
    };
    expect(serializeVault(emptyKeyVault)).toBeNull();
  });

  it('should handle complete vault input', () => {
    const vault: MorphoVault = {
      vaultKey: 'TEST-VAULT',
      chainId: 1,
      vaultToken: mockToken,
      underlyingToken: mockToken,
      underlyingPrice: 1000,
      baseApy: 0.03,
      totalApy: 0.05,
      rewardsApy: 0.02,
      curators: ['0x456', '0x789'],
      performanceFee: 0.1,
      timelock: 86400,
      totalLiquidity: mockAmount,
      totalLiquidityUsd: 1000000,
      totalSupply: mockAmount,
      totalSupplyUsd: 500000,
      markets: [mockMarket],
      rewards: [mockReward]
    };

    const expectedResult = {
      vaultKey: 'TEST-VAULT',
      vaultToken: serializedToken,
      underlyingToken: serializedToken,
      underlyingPrice: 1000,
      baseApy: 0.03,
      totalApy: 0.05,
      rewardsApy: 0.02,
      curators: ['0x456', '0x789'],
      performanceFee: 0.1,
      timelock: 86400,
      totalLiquidity: mockAmount,
      totalLiquidityUsd: 1000000,
      totalSupply: mockAmount,
      totalSupplyUsd: 500000,
      markets: [{
        marketId: 'TEST-MARKET',
        allocation: 0.5,
        marketCollateral: serializedToken,
        marketApy: 0.08,
        marketLiquidity: mockAmount,
        marketLiquidityUsd: 1000000,
        marketLoanToValue: 0.8,
        totalSupplied: mockAmount,
        totalSuppliedUsd: 500000,
        rewards: [{
          asset: serializedToken,
          supplyApr: 0.05,
          supplyAmount: 1000,
          borrowApr: 0.1,
          borrowAmount: 500
        }]
      }],
      rewards: [{
        asset: serializedToken,
        supplyApr: 0.05,
        supplyAmount: 1000,
        borrowApr: 0.1,
        borrowAmount: 500
      }]
    };

    const result = serializeVault(vault);
    expect(result).toEqual(expectedResult);
  });

  it('should handle invalid numeric values', () => {
    const invalidVault: Partial<MorphoVault> = {
      vaultKey: 'TEST-VAULT',
      baseApy: 'invalid' as any,
      totalApy: {} as any,
      rewardsApy: [] as any,
      performanceFee: 'invalid' as any
    };
    const result = serializeVault(invalidVault);
    expect(result?.baseApy).toBe(0);
    expect(result?.totalApy).toBe(0);
    expect(result?.rewardsApy).toBe(0);
    expect(result?.performanceFee).toBe(0);
  });

  it('should handle missing fields', () => {
    const partialVault: Partial<MorphoVault> = {
      vaultKey: 'TEST-VAULT',
      vaultToken: mockToken,
      underlyingToken: mockToken,
      baseApy: 0.03,
      totalApy: 0.05
    };
    const result = serializeVault(partialVault);
    expect(result?.vaultKey).toBe('TEST-VAULT');
    expect(result?.vaultToken).toEqual(serializedToken);
    expect(result?.underlyingToken).toEqual(serializedToken);
    expect(result?.baseApy).toBe(0.03);
    expect(result?.totalApy).toBe(0.05);
    expect(result?.rewardsApy).toBe(0);
    expect(result?.performanceFee).toBe(0);
    expect(result?.timelock).toBe(0);
  });
});
