import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/ai-mastery-quiz/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,json,woff2}"],
        // Fully offline: everything precached, no runtime network expected.
        navigateFallback: "index.html",
      },
      manifest: {
        name: "AI Mastery — 21-Day Quiz Coach",
        short_name: "AI Mastery",
        description:
          "Offline-first personal quiz & spaced-repetition coach for AI/RAG/agent engineering concepts.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        background_color: "#0b1220",
        theme_color: "#0b1220",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
