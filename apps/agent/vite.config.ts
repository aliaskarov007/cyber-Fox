import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist/renderer" },
  server: { port: 5174 },
});
