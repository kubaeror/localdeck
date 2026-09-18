import { configure } from '@testing-library/react';

/**
 * jsdom is missing a few browser APIs that Cloudscape components touch while
 * rendering. These stubs are only installed when a DOM is present, so the
 * node-environment tests are unaffected.
 */
if (typeof window !== 'undefined') {
  // Service consoles are loaded with dynamic imports; the first import of a
  // module can take seconds to transform under vitest, so findBy*/waitFor need
  // a wider window than the one-second default (kept below the 20s test budget
  // in vite.config.ts so a failure is still an assertion, not a timeout).
  configure({ asyncUtilTimeout: 10_000 });

  if (typeof window.matchMedia !== 'function') {
    const createMediaQueryList = (query: string): MediaQueryList => {
      const list = {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      };
      // jsdom does not implement matchMedia; Cloudscape only reads matches/media.
      return list as MediaQueryList;
    };
    window.matchMedia = createMediaQueryList;
  }

  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {
        // no-op: layout observers are irrelevant for a render smoke test
      }

      unobserve(): void {
        // no-op
      }

      disconnect(): void {
        // no-op
      }
    }
    // jsdom does not implement ResizeObserver at all.
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }

  window.scrollTo = () => undefined;
}
