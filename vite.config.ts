import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // La aplicación se actualiza sola: nadie debería quedarse jugando con una
      // versión vieja porque no cerró la pestaña.
      registerType: "autoUpdate",
      includeAssets: [
        "icono.svg",
        "favicon-32.png",
        "apple-touch-icon.png",
        "tile.svg",
      ],
      manifest: {
        name: "Mesa de Rummikub",
        short_name: "Rummikub",
        description:
          "Rummikub para jugar con quien quieras desde el navegador. De 2 a 8 jugadores, sin cuentas.",
        lang: "es",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Se juega en horizontal, como la app de siempre, pero sin obligar:
        // quien prefiera vertical puede girar el móvil.
        orientation: "any",
        background_color: "#0B2324",
        theme_color: "#0B2324",
        categories: ["games", "board"],
        icons: [
          { src: "/icono-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icono-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icono-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,webmanifest}"],
        cleanupOutdatedCaches: true,
        // La partida vive en el servidor: ni la API ni el WebSocket se cachean
        // jamás. Guardar una mesa vieja sería peor que no guardar nada.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        navigateFallbackAllowlist: [/^\/$/, /^\/g\/[A-Z0-9]{6}\/?$/],
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
    cloudflare(),
  ],
  build: { target: "es2022" },
});
