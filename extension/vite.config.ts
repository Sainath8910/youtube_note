import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_TARGET": JSON.stringify("extension"),
  },
  base: "./",
})