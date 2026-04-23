import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React ecosystem
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // Supabase client
          "vendor-supabase": ["@supabase/supabase-js"],
          // TanStack React Query
          "vendor-query": ["@tanstack/react-query"],
          // Charting library (recharts alone is ~500KB)
          "vendor-recharts": ["recharts"],
          // Radix UI primitives bundled together
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-label",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-avatar",
          ],
          // Export / PDF libraries (only loaded on export pages)
          "vendor-export": ["jspdf", "xlsx", "file-saver", "html2canvas", "docx"],
          // Date utilities
          "vendor-date": ["date-fns"],
        },
      },
    },
    // vendor-export (jsPDF + xlsx + html2canvas + docx) is intentionally large.
    // True fix is dynamic import() at call sites — tracked as future work.
    chunkSizeWarningLimit: 1400,
  },
}));
