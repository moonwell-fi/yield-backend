import { describe, it, expect } from 'vitest';
import type { Market, TokenConfig, Amount, MarketReward } from '@moonwell-fi/moonwell-sdk';
import { serializeMarket } from '../../serializers/market';
import type { SerializedToken } from '../../serializers/token';

describe('serializeMarket', () => {
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

  const mockReward: MarketReward = {
    token: mockToken,
    supplyApr: 0.05,
    borrowApr: 0.1,
    liquidStakingApr: 0.02
  };

  it('should handle null input', () => {
    expect(serializeMarket(null)).toBeNull();
    expect(serializeMarket(undefined)).toBeNull();
  });

  it('should handle empty market key', () => {
    const emptyKeyMarket = {
      marketKey: ''
    };
    expect(serializeMarket(emptyKeyMarket)).toBeNull();
  });

  it('should handle complete market input', () => {
    const market: Market = {
      // Basic market info
      marketKey: 'TEST-MARKET',
      chainId: 1,
      deprecated: false,

      // Pause states
      mintPaused: true,
      borrowPaused: true,
      seizePaused: false,
      transferPaused: false,

      // Token info
      marketToken: mockToken,
      underlyingToken: mockToken,

      // Market parameters
      collateralFactor: 0.8,
      reserveFactor: 0.1,
      exchangeRate: 1,
      underlyingPrice: 1000,

      // Caps
      supplyCaps: mockAmount,
      supplyCapsUsd: 1000000,
      borrowCaps: mockAmount,
      borrowCapsUsd: 1000000,

      // Market state
      totalSupply: mockAmount,
      totalSupplyUsd: 500000,
      totalBorrows: mockAmount,
      totalBorrowsUsd: 300000,
      totalReserves: mockAmount,
      totalReservesUsd: 50000,
      cash: mockAmount,

      // APR/APY info
      baseSupplyApy: 0.03,
      baseBorrowApy: 0.08,
      totalSupplyApr: 0.05,
      totalBorrowApr: 0.1,

      // Rewards
      rewards: [mockReward]
    };

    const expectedResult = {
      // Basic market info
      marketKey: 'TEST-MARKET',
      deprecated: false,

      // Pause states
      mintPaused: true,
      borrowPaused: true,
      seizePaused: false,
      transferPaused: false,

      // Token info
      marketToken: serializedToken,
      underlyingToken: serializedToken,

      // Market parameters
      collateralFactor: 0.8,
      reserveFactor: 0.1,
      exchangeRate: 1,
      underlyingPrice: 1000,

      // Caps
      supplyCaps: mockAmount,
      supplyCapsUsd: 1000000,
      borrowCaps: mockAmount,
      borrowCapsUsd: 1000000,

      // Market state
      totalSupply: mockAmount,
      totalSupplyUsd: 500000,
      totalBorrows: mockAmount,
      totalBorrowsUsd: 300000,
      totalReserves: mockAmount,
      totalReservesUsd: 50000,
      cash: mockAmount,

      // APR/APY info
      baseSupplyApy: 0.03,
      baseBorrowApy: 0.08,
      totalSupplyApr: 0.05,
      totalBorrowApr: 0.1,

      // Rewards
      rewards: [{
        token: serializedToken,
        supplyApr: 0.05,
        borrowApr: 0.1,
        liquidStakingApr: 0.02
      }]
    };

    const result = serializeMarket(market);
    expect(result).toEqual(expectedResult);
  });

  it('should handle invalid numeric values', () => {
    const invalidMarket: Partial<Market> = {
      marketKey: 'TEST-MARKET',
      chainId: '1' as any,
      collateralFactor: 'invalid' as any,
      totalSupplyApr: {} as any,
      totalBorrowApr: [] as any
    };
    const result = serializeMarket(invalidMarket);
    expect(result?.collateralFactor).toBe(0);
    expect(result?.totalSupplyApr).toBe(0);
    expect(result?.totalBorrowApr).toBe(0);
  });

  it('should handle missing fields', () => {
    const partialMarket: Partial<Market> = {
      marketKey: 'TEST-MARKET',
      marketToken: mockToken,
      underlyingToken: mockToken,
      totalSupplyApr: 0.05,
      totalBorrowApr: 0.1
    };
    const result = serializeMarket(partialMarket);
    expect(result?.marketKey).toBe('TEST-MARKET');
    expect(result?.marketToken).toEqual(serializedToken);
    expect(result?.underlyingToken).toEqual(serializedToken);
    expect(result?.totalSupplyApr).toBe(0.05);
    expect(result?.totalBorrowApr).toBe(0.1);
    expect(result?.collateralFactor).toBe(0);
    expect(result?.reserveFactor).toBe(0);
  });
});
