/**
 * jsdom is missing a few browser APIs that Cloudscape components touch while
 * rendering. These stubs are only installed when a DOM is present, so the
 * node-environment tests are unaffected.
 */
if (typeof window !== 'undefined') {
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
