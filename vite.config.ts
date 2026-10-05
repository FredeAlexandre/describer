import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve("src/renderer"),
  base: "./",
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true,
  },
});
