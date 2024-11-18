import type { Market, MarketReward } from '@moonwell-fi/moonwell-sdk';
import { serializeAmount } from './amount';
import { serializeToken, type SerializedToken } from './token';

export interface SerializedMarket {
  marketKey: string;
  deprecated: boolean;
  mintPaused: boolean;
  borrowPaused: boolean;
  seizePaused: boolean;
  transferPaused: boolean;
  marketToken: SerializedToken;
  underlyingToken: SerializedToken;
  collateralFactor: number;
  reserveFactor: number;
  exchangeRate: number;
  underlyingPrice: number;
  supplyCaps: { value: string; decimals: number };
  supplyCapsUsd: number;
  borrowCaps: { value: string; decimals: number };
  borrowCapsUsd: number;
  totalSupply: { value: string; decimals: number };
  totalSupplyUsd: number;
  totalBorrows: { value: string; decimals: number };
  totalBorrowsUsd: number;
  totalReserves: { value: string; decimals: number };
  totalReservesUsd: number;
  cash: { value: string; decimals: number };
  baseSupplyApy: number;
  baseBorrowApy: number;
  totalSupplyApr: number;
  totalBorrowApr: number;
  rewards: {
    token: SerializedToken;
    supplyApr: number;
    borrowApr: number;
    liquidStakingApr: number;
  }[];
}

export const serializeMarket = (market: Partial<Market> | null | undefined): SerializedMarket | null => {
  if (!market || !market.marketKey) return null;
  
  // Helper for numeric values
  const toNumber = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val !== 'number') return 0;
    return isNaN(val) ? 0 : val;
  };

  // Helper for boolean values
  const toBool = (val: any): boolean => {
    return val === true;
  };
  
  return {
    // Basic market info
    marketKey: market.marketKey || '',
    deprecated: toBool(market.deprecated),

    // Pause states
    mintPaused: toBool(market.mintPaused),
    borrowPaused: toBool(market.borrowPaused),
    seizePaused: toBool(market.seizePaused),
    transferPaused: toBool(market.transferPaused),

    // Token info
    marketToken: serializeToken(market.marketToken) || { 
      address: '', name: '', symbol: '', decimals: 0
    },
    underlyingToken: serializeToken(market.underlyingToken) || { 
      address: '', name: '', symbol: '', decimals: 0
    },

    // Market parameters
    collateralFactor: toNumber(market.collateralFactor),
    reserveFactor: toNumber(market.reserveFactor),
    exchangeRate: toNumber(market.exchangeRate),
    underlyingPrice: toNumber(market.underlyingPrice),

    // Caps
    supplyCaps: serializeAmount(market.supplyCaps) || { value: '0', decimals: 0 },
    supplyCapsUsd: toNumber(market.supplyCapsUsd),
    borrowCaps: serializeAmount(market.borrowCaps) || { value: '0', decimals: 0 },
    borrowCapsUsd: toNumber(market.borrowCapsUsd),

    // Market state
    totalSupply: serializeAmount(market.totalSupply) || { value: '0', decimals: 0 },
    totalSupplyUsd: toNumber(market.totalSupplyUsd),
    totalBorrows: serializeAmount(market.totalBorrows) || { value: '0', decimals: 0 },
    totalBorrowsUsd: toNumber(market.totalBorrowsUsd),
    totalReserves: serializeAmount(market.totalReserves) || { value: '0', decimals: 0 },
    totalReservesUsd: toNumber(market.totalReservesUsd),
    cash: serializeAmount(market.cash) || { value: '0', decimals: 0 },

    // APR/APY info
    baseSupplyApy: toNumber(market.baseSupplyApy),
    baseBorrowApy: toNumber(market.baseBorrowApy),
    totalSupplyApr: toNumber(market.totalSupplyApr),
    totalBorrowApr: toNumber(market.totalBorrowApr),

    // Rewards
    rewards: (market.rewards || []).map((reward: Partial<MarketReward>) => ({
      token: serializeToken(reward.token) || { 
        address: '', name: '', symbol: '', decimals: 0
      },
      supplyApr: toNumber(reward.supplyApr),
      borrowApr: toNumber(reward.borrowApr),
      liquidStakingApr: toNumber(reward.liquidStakingApr)
    }))
  };
};
