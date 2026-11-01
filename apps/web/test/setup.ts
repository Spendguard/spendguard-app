import "@testing-library/jest-dom/vitest";

// jsdom ships no matchMedia, and ThemeContext reads the system colour
// preference as soon as it mounts. Guarded because the same setup file runs for
// the node-environment suites, where there is no window at all.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
