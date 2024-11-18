import { beforeAll, afterAll, afterEach, vi } from 'vitest';

beforeAll(() => {
  // Mock Cloudflare Worker environment
  global.Request = vi.fn() as any;
  global.Response = vi.fn() as any;
  global.Headers = vi.fn() as any;
  global.console.log = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.resetAllMocks();
});
