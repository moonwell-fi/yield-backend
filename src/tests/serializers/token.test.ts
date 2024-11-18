import { describe, it, expect } from 'vitest';
import type { TokenConfig } from '@moonwell-fi/moonwell-sdk';
import { serializeToken } from '../../serializers/token';

describe('serializeToken', () => {
  it('should handle null input', () => {
    expect(serializeToken(null)).toBeNull();
    expect(serializeToken(undefined)).toBeNull();
  });

  it('should handle empty object input', () => {
    const result = serializeToken({});
    expect(result).toEqual({
      address: '',
      name: '',
      symbol: '',
      decimals: 0
    });
  });

  it('should handle partial token input', () => {
    const partialToken: Partial<TokenConfig> = {
      address: '0x123',
      name: 'Test Token',
      decimals: 18
    };
    const result = serializeToken(partialToken);
    expect(result).toEqual({
      address: '0x123',
      name: 'Test Token',
      symbol: '',
      decimals: 18
    });
  });

  it('should handle complete token input', () => {
    const token: TokenConfig = {
      address: '0x123',
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      chainId: 1,
      logoURI: 'https://example.com/logo.png',
      isNative: true,
      wrapped: null
    };
    const result = serializeToken(token);
    expect(result).toEqual({
      address: '0x123',
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18
    });
  });

  it('should handle invalid decimals', () => {
    const token = {
      address: '0x123',
      name: 'Test Token',
      symbol: 'TEST',
      decimals: '18' as any
    };
    const result = serializeToken(token);
    expect(result).toEqual({
      address: '0x123',
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 0
    });
  });
});
