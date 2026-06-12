import type { MorphoVault, MorphoVaultMarket, MorphoReward, MorphoStakingReward } from '@moonwell-fi/moonwell-sdk';
import { serializeAmount } from './amount';
import { serializeToken, type SerializedToken } from './token';

export interface SerializedVault {
  vaultKey: string;
  vaultToken: SerializedToken;
  underlyingToken: SerializedToken;
  underlyingPrice: number;
  baseApy: number;
  totalApy: number;
  rewardsApy: number;
  curators: string[];
  performanceFee: number;
  timelock: number;
  totalLiquidity: { value: string; decimals: number };
  totalLiquidityUsd: number;
  totalSupply: { value: string; decimals: number };
  totalSupplyUsd: number;
  markets: {
    marketId: string;
    allocation: number;
    marketCollateral: SerializedToken;
    marketApy: number;
    marketLiquidity: { value: string; decimals: number };
    marketLiquidityUsd: number;
    marketLoanToValue: number;
    totalSupplied: { value: string; decimals: number };
    totalSuppliedUsd: number;
    rewards: {
      asset: SerializedToken;
      supplyApr: number;
      supplyAmount: number;
      borrowApr: number;
      borrowAmount: number;
    }[];
  }[];
  rewards: {
    asset: SerializedToken;
    supplyApr: number;
    supplyAmount: number;
    borrowApr: number;
    borrowAmount: number;
  }[];
}

export const serializeVault = (vault: Partial<MorphoVault> | null | undefined): SerializedVault | null => {
  if (!vault || !vault.vaultKey) return null;

  // Helper for numeric values
  const toNumber = (val: any): number => {
    if (val === null || val === undefined) return 0;
    if (typeof val !== 'number') return 0;
    return isNaN(val) ? 0 : val;
  };

  // Helper for array values
  const toArray = <T>(val: T[] | null | undefined): T[] => {
    return Array.isArray(val) ? val : [];
  };

  // WELL rewards on Moonwell's Morpho vaults are distributed through the
  // multi-reward staking distributor, which the SDK surfaces as `stakingRewards`
  // / `stakingRewardsApr` — separate from the Morpho-native `rewards` /
  // `rewardsApy`. Fold the staking rewards into the reward fields so consumers
  // see the full reward APY (e.g. cbBTC's ~0.77% WELL rewards) instead of base
  // APY only.
  const stakingRewardsApr = toNumber(vault.stakingRewardsApr);

  const rewards = [
    ...toArray<Partial<MorphoReward>>(vault.rewards).map((reward) => ({
      asset: serializeToken(reward.asset) || {
        address: '', name: '', symbol: '', decimals: 0
      },
      supplyApr: toNumber(reward.supplyApr),
      supplyAmount: toNumber(reward.supplyAmount),
      borrowApr: toNumber(reward.borrowApr),
      borrowAmount: toNumber(reward.borrowAmount)
    })),
    ...toArray<Partial<MorphoStakingReward>>(vault.stakingRewards).map((stakingReward) => ({
      asset: serializeToken(stakingReward.token) || {
        address: '', name: '', symbol: '', decimals: 0
      },
      supplyApr: toNumber(stakingReward.apr),
      supplyAmount: 0,
      borrowApr: 0,
      borrowAmount: 0
    }))
  ];

  return {
    // Basic vault info
    vaultKey: vault.vaultKey || '',

    // Token info
    vaultToken: serializeToken(vault.vaultToken) || { 
      address: '', name: '', symbol: '', decimals: 0
    },
    underlyingToken: serializeToken(vault.underlyingToken) || { 
      address: '', name: '', symbol: '', decimals: 0
    },
    underlyingPrice: toNumber(vault.underlyingPrice),

    // APY info (rewards/total include WELL staking rewards, see above)
    baseApy: toNumber(vault.baseApy),
    totalApy: toNumber(vault.totalApy) + stakingRewardsApr,
    rewardsApy: toNumber(vault.rewardsApy) + stakingRewardsApr,

    // Configuration
    curators: toArray(vault.curators),
    performanceFee: toNumber(vault.performanceFee),
    timelock: toNumber(vault.timelock),

    // Total amounts
    totalLiquidity: serializeAmount(vault.totalLiquidity) || { value: '0', decimals: 0 },
    totalLiquidityUsd: toNumber(vault.totalLiquidityUsd),
    totalSupply: serializeAmount(vault.totalSupply) || { value: '0', decimals: 0 },
    totalSupplyUsd: toNumber(vault.totalSupplyUsd),

    // Market positions
    markets: (vault.markets || []).map((market: Partial<MorphoVaultMarket>) => ({
      marketId: market.marketId || '',
      allocation: toNumber(market.allocation),
      marketCollateral: serializeToken(market.marketCollateral) || { 
        address: '', name: '', symbol: '', decimals: 0
      },
      marketApy: toNumber(market.marketApy),
      marketLiquidity: serializeAmount(market.marketLiquidity) || { value: '0', decimals: 0 },
      marketLiquidityUsd: toNumber(market.marketLiquidityUsd),
      marketLoanToValue: toNumber(market.marketLoanToValue),
      totalSupplied: serializeAmount(market.totalSupplied) || { value: '0', decimals: 0 },
      totalSuppliedUsd: toNumber(market.totalSuppliedUsd),
      rewards: (market.rewards || []).map((reward: Partial<MorphoReward>) => ({
        asset: serializeToken(reward.asset) || { 
          address: '', name: '', symbol: '', decimals: 0
        },
        supplyApr: toNumber(reward.supplyApr),
        supplyAmount: toNumber(reward.supplyAmount),
        borrowApr: toNumber(reward.borrowApr),
        borrowAmount: toNumber(reward.borrowAmount)
      }))
    })),

    // Rewards (Morpho-native rewards plus WELL staking rewards)
    rewards
  };
};
