import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Components rely on the automatic JSX runtime (Next's default); esbuild's
  // own reading of tsconfig's `jsx: "preserve"` would emit React.createElement.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@spendguard/sdk": path.resolve(__dirname, "../../packages/sdk/src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
