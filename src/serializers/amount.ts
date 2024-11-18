import type { Amount } from '@moonwell-fi/moonwell-sdk';

// Helper function to safely serialize amount objects
export const serializeAmount = (amount: Partial<Amount> | null | undefined): Amount | null => {
  if (!amount) return null;

  // Handle value
  let value = '0';
  if (amount.value !== undefined && amount.value !== null) {
    try {
      // Handle bigint, number, and string values
      value = amount.value.toString();
      // Validate that it's actually a number
      if (isNaN(Number(value))) {
        value = '0';
      }
    } catch {
      value = '0';
    }
  }

  // Handle decimals
  let decimals = 0;
  if (amount.decimals !== undefined && amount.decimals !== null) {
    // Only accept numeric values for decimals
    if (typeof amount.decimals === 'number') {
      decimals = amount.decimals;
    }
  }

  return {
    value,
    decimals
  };
};
