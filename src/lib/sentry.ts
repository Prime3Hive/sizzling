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
      // Replays are masked. This portal renders salaries, payslips, bank
      // account numbers, staff addresses and supplier pricing; with
      // maskAllText off, every one of those was being recorded and shipped to
      // Sentry in the clear. Masked replays still show layout, navigation and
      // where the click landed, which is what a replay is for.
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    // Strip the access token and any other credential out of request URLs
    // before an event leaves the browser. Supabase puts the session in the
    // URL fragment on the magic-link and recovery redirects.
    beforeSend(event) {
      const scrub = (url?: string) =>
        url?.replace(/([?&#])(access_token|refresh_token|apikey|token)=[^&]*/gi, '$1$2=[redacted]');
      if (event.request?.url) event.request.url = scrub(event.request.url);
      event.breadcrumbs = event.breadcrumbs?.map(b =>
        b.data?.url ? { ...b, data: { ...b.data, url: scrub(String(b.data.url)) } } : b,
      );
      return event;
    },
    // Performance: capture 10 % of transactions in production, 100 % in dev
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Session Replay: capture 10 % of sessions, 100 % of sessions with errors
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Only send events from own origins
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/sizzling-spices-portal\.vercel\.app/,
      /^https:\/\/.*\.vercel\.app/,
    ],
  });
};

export { Sentry };
