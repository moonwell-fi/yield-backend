import { beforeAll, afterAll, afterEach, vi } from 'vitest';

beforeAll(() => {
  // Mock Cloudflare Worker environment
  (globalThis as any).Request = vi.fn();
  (globalThis as any).Response = vi.fn();
  (globalThis as any).Headers = vi.fn();
  (globalThis as any).console.log = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.resetAllMocks();
});
