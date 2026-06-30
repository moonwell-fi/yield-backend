import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchVaultRewards } from '../../serializers/vaultRewards';

const ADDRESS = '0xC1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca';

const morphoResponse = (supplyApr: number) => ({
  data: {
    vaults: {
      items: [
        {
          address: ADDRESS,
          state: {
            allRewards: [
              {
                supplyApr,
                asset: { address: '0xWELL', symbol: 'WELL', decimals: 18 },
              },
            ],
          },
        },
      ],
    },
  },
});

const mockFetch = (impl: () => Promise<unknown> | unknown): void => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => impl(),
  }) as unknown as typeof fetch;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchVaultRewards', () => {
  it('returns an empty map for no addresses without calling the API', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    const result = await fetchVaultRewards([]);
    expect(result.size).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('scales decimal supplyApr to percentage units and keys by lowercased address', async () => {
    mockFetch(() => morphoResponse(0.007782196305856525));

    const result = await fetchVaultRewards([ADDRESS]);

    const overlay = result.get(ADDRESS.toLowerCase());
    expect(overlay).toBeDefined();
    expect(overlay?.rewards).toHaveLength(1);
    expect(overlay?.rewards[0].asset.symbol).toBe('WELL');
    // 0.007782... * 100 -> ~0.7782%
    expect(overlay?.rewards[0].supplyApr).toBeCloseTo(0.7782196, 5);
    expect(overlay?.rewardsApy).toBeCloseTo(0.7782196, 5);
    // Non-supply reward fields are zeroed to match SerializedVault.rewards.
    expect(overlay?.rewards[0].supplyAmount).toBe(0);
    expect(overlay?.rewards[0].borrowApr).toBe(0);
  });

  it('queries the non-deprecated allRewards field', async () => {
    mockFetch(() => morphoResponse(0.01));
    await fetchVaultRewards([ADDRESS]);

    const body = JSON.parse((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.query).toContain('allRewards');
    expect(body.query).not.toContain('state {\n          rewards');
    expect(body.variables).toEqual({ addresses: [ADDRESS], chainId: 8453 });
  });

  it('returns an empty map on a non-200 response (no throw)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const result = await fetchVaultRewards([ADDRESS]);
    expect(result.size).toBe(0);
  });

  it('returns an empty map when the response shape is unexpected (no throw)', async () => {
    mockFetch(() => ({ data: { unexpected: true } }));
    const result = await fetchVaultRewards([ADDRESS]);
    expect(result.size).toBe(0);
  });

  it('returns an empty map when fetch throws (no throw)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const result = await fetchVaultRewards([ADDRESS]);
    expect(result.size).toBe(0);
  });

  it('skips a malformed reward but keeps the valid rewards on the same vault', async () => {
    mockFetch(() => ({
      data: {
        vaults: {
          items: [
            {
              address: ADDRESS,
              state: {
                allRewards: [
                  { supplyApr: null, asset: { address: '0xBAD', symbol: 'BAD', decimals: 18 } },
                  { supplyApr: 0.01, asset: { address: '0xWELL', symbol: 'WELL', decimals: 18 } },
                ],
              },
            },
          ],
        },
      },
    }));

    const overlay = (await fetchVaultRewards([ADDRESS])).get(ADDRESS.toLowerCase());
    expect(overlay?.rewards).toHaveLength(1);
    expect(overlay?.rewards[0].asset.symbol).toBe('WELL');
    expect(overlay?.rewardsApy).toBeCloseTo(1, 5);
  });

  it('skips a malformed vault but keeps other vaults', async () => {
    const OTHER = '0x0000000000000000000000000000000000000002';
    mockFetch(() => ({
      data: {
        vaults: {
          items: [
            { address: 12345, state: { allRewards: [] } }, // bad: non-string address
            {
              address: OTHER,
              state: {
                allRewards: [
                  { supplyApr: 0.02, asset: { address: '0xWELL', symbol: 'WELL', decimals: 18 } },
                ],
              },
            },
          ],
        },
      },
    }));

    const result = await fetchVaultRewards([ADDRESS, OTHER]);
    expect(result.has(OTHER.toLowerCase())).toBe(true);
    expect(result.get(OTHER.toLowerCase())?.rewardsApy).toBeCloseTo(2, 5);
  });
});
