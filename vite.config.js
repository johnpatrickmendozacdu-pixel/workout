import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Identifies the deployed build so the app can tell whether it is running the
// newest one. Commit sha in CI; timestamp locally where git may be absent.
let BUILD_ID;
try {
  BUILD_ID = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  BUILD_ID = String(Date.now());
}

/** Emits version.json alongside the build. Deliberately NOT matched by the
 *  precache globs, so fetching it always reaches the server. */
const emitVersion = {
  name: 'emit-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
};

export default defineConfig({
  // Relative base so the build works whether it's deployed at a domain root
  // (user/org GitHub Pages, Cloudflare Pages) or under a subpath
  // (project GitHub Pages, e.g. username.github.io/repo-name/).
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    emitVersion,
    VitePWA({
      // autoUpdate, not 'prompt': with 'prompt' a new build sits inert behind
      // the old service worker until the person clicks the update banner, so an
      // ordinary refresh keeps serving stale code and shipped fixes appear not
      // to work. Take the new version on the next load instead.
      registerType: 'autoUpdate',
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
        // jpg is here for the arena background: without it the ground is a
        // network request, and the app would open black on a train.
        globPatterns: ['**/*.{js,css,html,png,jpg,webp,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        // Activate the new worker immediately and take over open pages, so the
        // very next load runs the new build rather than the previous one.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
});
