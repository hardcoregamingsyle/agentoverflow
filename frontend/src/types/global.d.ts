declare global {
  interface Window {
    // Google Tag Manager / gtag.js — see lib/analytics.ts. dataLayer is pushed
    // to before either script parses, so it exists by the time a tag reads it.
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export {};
