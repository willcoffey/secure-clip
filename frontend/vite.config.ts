import { defineConfig } from "vite";
import { join } from "node:path";
import license from "rollup-plugin-license";

export default defineConfig({
  plugins: [
    license({
      thirdParty: { output: join(import.meta.dirname, "../dist/web/THIRD_PARTY_LICENSES.txt") },
    }),
  ],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    // Bundle includes every highlight.js language on purpose: no on-demand
    // requests that would leak which languages a clipboard contains.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
