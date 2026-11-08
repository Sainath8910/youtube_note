import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  const missing = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ].filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing required web dashboard build variables: ${missing.join(", ")}`,
    );
  }

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_APP_TARGET": JSON.stringify("web"),
    },
    base: "/static/dashboard/",
    build: {
      outDir: resolve(import.meta.dirname, "../backend/static/dashboard"),
      emptyOutDir: true,
    },
  };
});
