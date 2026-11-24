import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "../dist",
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
