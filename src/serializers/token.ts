export interface SerializedToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

// Loose input: SDK TokenConfig objects or plain partial token shapes.
export interface TokenLike {
  address?: string | null;
  name?: string | null;
  symbol?: string | null;
  decimals?: unknown;
  [key: string]: unknown;
}

// Helper function to safely serialize token objects
export const serializeToken = (token: TokenLike | null | undefined): SerializedToken | null => {
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
