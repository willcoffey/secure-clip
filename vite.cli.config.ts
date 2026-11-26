import { defineConfig } from "vite";
export default defineConfig({
  build: {
    ssr: "frontend/src/seclip.ts",
    outDir: "dist/cli",
    target: "node22",
    rollupOptions: { output: { entryFileNames: "seclip.js", banner: "#!/usr/bin/env node" } },
  },
});

