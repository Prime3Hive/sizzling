import * as Sentry from "@sentry/react";

export const initSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) {
    if (import.meta.env.DEV) {
      console.info("[Sentry] VITE_SENTRY_DSN not set — skipping initialisation in dev.");
    }
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Performance: capture 10 % of transactions in production, 100 % in dev
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Session Replay: capture 10 % of sessions, 100 % of sessions with errors
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Only send events from own origins
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/sizzling-spices-portal\.netlify\.app/,
    ],
  });
};

export { Sentry };
