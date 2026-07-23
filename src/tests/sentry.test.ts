import { describe, expect, it } from 'vitest';
import { createSentryOptions, SENTRY_TRACES_SAMPLE_RATE } from '../sentry';

describe('createSentryOptions', () => {
  it('enables error reporting and performance tracing when a DSN is configured', () => {
    const options = createSentryOptions({
      SENTRY_DSN: 'https://public@example.sentry.io/1',
      SENTRY_ENVIRONMENT: 'test',
    });

    expect(options).toMatchObject({
      dsn: 'https://public@example.sentry.io/1',
      enabled: true,
      environment: 'test',
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      sendDefaultPii: true,
    });
  });

  it('stays disabled without a DSN', () => {
    expect(createSentryOptions({})).toMatchObject({
      dsn: undefined,
      enabled: false,
      environment: 'production',
    });
  });
});
