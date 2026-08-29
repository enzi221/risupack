import { chmod } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        cli: resolve(import.meta.dirname, "src/cli.ts"),
        index: resolve(import.meta.dirname, "src/index.ts"),
      },
      formats: ["es"],
    },
    minify: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: {
        banner: (chunk) => (chunk.name === "cli" ? "#!/usr/bin/env node" : ""),
        entryFileNames: "[name].js",
      },
    },
    sourcemap: true,
    target: "node20",
  },
  plugins: lazyPlugins(() => [
    {
      closeBundle: async () => chmod(resolve(import.meta.dirname, "dist/cli.js"), 0o755),
      name: "executable-cli",
    },
  ]),
});
