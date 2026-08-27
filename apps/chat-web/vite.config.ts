import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    host: "::",
    port: 8081,
    proxy: {
      "/marketing-ops-api": {
        target: process.env.VITE_MARKETING_OPS_PROXY_TARGET ?? "http://127.0.0.1:8091",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/marketing-ops-api/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyRequest) => proxyRequest.removeHeader("origin"));
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "npm:zod": "zod",
      "npm:fflate": "fflate",
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:55321",
      VITE_SUPABASE_ANON_KEY: "local-test-anon-key",
    },
  },
}));
