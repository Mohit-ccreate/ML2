import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server binds 0.0.0.0 for the sandbox live preview.
// /api/* is proxied to the Flask OptionEdge backend (port 8000) so the
// terminal can swap its mock state for live inference without code changes.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true, // preview proxy serves the app under a dynamic *.e2b.app hostname
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
