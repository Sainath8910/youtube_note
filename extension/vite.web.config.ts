import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_TARGET": JSON.stringify("web"),
  },
  base: "/static/dashboard/",
  build: {
    outDir: resolve(import.meta.dirname, "../backend/static/dashboard"),
    emptyOutDir: true,
  },
});
