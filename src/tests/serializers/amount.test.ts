import { describe, it, expect } from 'vitest';
import { serializeAmount, type AmountLike } from '../../serializers/amount';

describe('serializeAmount', () => {
  it('should handle null input', () => {
    expect(serializeAmount(null)).toBeNull();
    expect(serializeAmount(undefined)).toBeNull();
  });

  it('should handle empty object input', () => {
    const result = serializeAmount({});
    expect(result).toEqual({
      value: '0',
      decimals: 0
    });
  });

  it('should handle partial amount input', () => {
    const partialAmount: AmountLike = {
      value: '1000000000000000000'
    };
    const result = serializeAmount(partialAmount);
    expect(result).toEqual({
      value: '1000000000000000000',
      decimals: 0
    });
  });

  it('should handle complete amount input', () => {
    const amount: AmountLike = {
      value: '1000000000000000000',
      decimals: 18
    };
    const result = serializeAmount(amount);
    expect(result).toEqual(amount);
  });

  it('should handle numeric value input', () => {
    const amount: AmountLike = {
      value: 1000000000000000000n,
      decimals: 18
    };
    const result = serializeAmount(amount);
    expect(result).toEqual({
      value: '1000000000000000000',
      decimals: 18
    });
  });

  it('should handle invalid numeric values', () => {
    const invalidAmount = {
      value: {} as any,
      decimals: '18' as any
    };
    const result = serializeAmount(invalidAmount);
    expect(result?.value).toBe('0');
    expect(result?.decimals).toBe(0);
  });

  it('should handle zero values', () => {
    const amount: AmountLike = {
      value: '0',
      decimals: 0
    };
    const result = serializeAmount(amount);
    expect(result).toEqual({
      value: '0',
      decimals: 0
    });
  });
});
