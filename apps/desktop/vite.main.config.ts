import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    noExternal: true,
    external: ["electron", "better-sqlite3"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "node22",
    ssr: true,
    rollupOptions: {
      input: {
        "main/main": "src/main/main.ts",
        "preload/preload": "src/preload/preload.ts",
      },
      external: ["electron", "better-sqlite3"],
      output: {
        format: "es",
        entryFileNames: "[name].js",
      },
    },
  },
});
