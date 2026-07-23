import type { CloudflareOptions } from '@sentry/cloudflare';

export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

export interface SentryEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

export const createSentryOptions = (env: SentryEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  enabled: !!env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT ?? 'production',
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  sendDefaultPii: true,
});
