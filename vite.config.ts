import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // 2026-06-16: manualChunks split REVERTED — produced an inter-chunk
  // dependency cycle (vendor-react imported from the catch-all vendor
  // chunk), which caused an ES-module circular-init blank-page failure
  // in production. Will reintroduce splitting with route-level React.lazy()
  // instead of vendor-bucket splitting, since lazy() avoids cross-chunk
  // top-level imports by design.
}));
