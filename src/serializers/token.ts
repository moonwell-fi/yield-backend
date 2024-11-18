import type { TokenConfig } from '@moonwell-fi/moonwell-sdk';

export interface SerializedToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

// Helper function to safely serialize token objects
export const serializeToken = (token: Partial<TokenConfig> | null | undefined): SerializedToken | null => {
  if (!token) return null;
  
  // Base token data that's always included
  const tokenData: SerializedToken = {
    address: token.address || '',
    name: token.name || '',
    symbol: token.symbol || '',
    decimals: typeof token.decimals === 'number' ? token.decimals : 0,
  };

  return tokenData;
};
