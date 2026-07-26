import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works whether it's deployed at a domain root
  // (user/org GitHub Pages, Cloudflare Pages) or under a subpath
  // (project GitHub Pages, e.g. username.github.io/repo-name/).
  base: './',
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Sets — Workout Tracker',
        short_name: 'Sets',
        description: 'Log every workout set in seconds. Private, offline, no account.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#171614',
        theme_color: '#171614',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell so the installed app opens with zero network.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
