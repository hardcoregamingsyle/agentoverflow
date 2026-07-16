// The shared Thalamus Convex deployment. VITE_CONVEX_URL wins when set (local
// dev, staging); otherwise we default to prod. The URL ships in the public
// bundle either way — it was never a secret, so it doesn't get to break builds.
export const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
  "https://befitting-wildebeest-866.convex.cloud";
