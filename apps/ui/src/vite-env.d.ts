/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the LocalDeck api. Empty (the default) means "same origin", in
   * which case the Vite dev server / the ui nginx container proxies /api.
   */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_API_PROXY_TARGET?: string;
  readonly VITE_DEV_PORT?: string;
  readonly VITE_PREVIEW_PORT?: string;
  /**
   * Subpath the console is served from (for example `/localdeck/`). Vite uses
   * it as `base` and the router as `basename`. Default `/`.
   */
  readonly VITE_BASE_PATH?: string;
  /**
   * Set to `true` to emit served source maps in production builds (they are
   * hidden by default).
   */
  readonly VITE_DEBUG_SOURCEMAPS?: string;
  /**
   * Feature flag for the (not yet implemented) browser terminal entry in the
   * top navigation. Hidden unless set to `true`.
   */
  readonly VITE_TERMINAL_ENABLED?: string;
  /**
   * Base URL of a running LocalDeck api. Only the live console smoke test
   * (src/live-localstack.test.tsx) and the service module live tests read it;
   * the app always uses same-origin.
   */
  readonly VITE_LIVEDECK_LIVE_API?: string;
  /**
   * Opt-in for the heavy live EKS lifecycle test: LocalStack Pro starts a real
   * k3d cluster, which takes minutes and needs a working Docker/k3d setup.
   */
  readonly VITE_LIVEDECK_LIVE_EKS_CREATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
