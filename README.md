# Sets — Workout Tracker (PWA)

A private, offline-first habit tracker for logging workout sets in seconds. No account,
no backend, no recurring cost. This is the installable-on-your-phone version of the
design; see the bottom of this file for what's different from the in-chat prototype.

Everything here is free forever, not just free-tier:

| Piece | Choice | Cost |
|---|---|---|
| Hosting | GitHub Pages | $0, HTTPS included |
| Framework | Vite + vanilla JS | MIT-licensed |
| Storage | Browser IndexedDB | built into the browser |
| Offline support | vite-plugin-pwa (Workbox) | MIT-licensed |
| CI / deploy | GitHub Actions | free tier (public repo = unlimited minutes) |
| Tests | Vitest | MIT-licensed |

## 1. Get it live (5 minutes, one-time)

1. Create a new **public** GitHub repository.
2. Push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Workout tracker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Push to `main` (or re-run the "Deploy to GitHub Pages" workflow under the **Actions** tab).
   The included workflow (`.github/workflows/deploy.yml`) runs the test suite, builds the
   app, and deploys it automatically. Your app will be live at
   `https://<your-username>.github.io/<your-repo>/`.

No build step happens on your machine — GitHub's servers do it for free every time you push.

**Alternative, no Git required:** run `npm install && npm run build` locally (see below)
and drag the resulting `dist` folder onto [Cloudflare Pages](https://pages.cloudflare.com)
or [Netlify Drop](https://app.netlify.com/drop) — both have permanent free tiers for static
sites like this one.

## 2. Install it on your phone

- **iOS (Safari):** open the deployed URL → Share icon → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu (⋮) → **Install app** (or you'll see an automatic install banner).

Once installed it opens full-screen with no browser chrome and works with no network connection.

## 3. Local development

```bash
npm install
npm run dev      # http://localhost:5173, live reload
npm run build    # production build into dist/
npm run preview  # serve the production build locally
npm test          # run the Vitest suite once
npm run test:watch
```

## Project structure

```
src/
  domain/domain.js   Pure logic: totals, target history, streaks, backup validation.
                      No DOM, no storage — fully unit tested in tests/domain.test.js.
  db/db.js            Thin IndexedDB wrapper + a tiny localStorage helper for UI prefs only.
  main.js             State, rendering, and event handling for Today / Plan / Progress.
  style.css           All styling.
public/
  manifest / icons live here via vite.config.js (see the VitePWA plugin block).
tests/
  domain.test.js       23 tests covering total calculation, target-history behavior,
                        daily completion, streaks, undo, and backup import validation.
.github/workflows/
  test.yml              Runs the test suite on every push/PR.
  deploy.yml             Tests, builds, and deploys to GitHub Pages on push to main.
```

## Data & backups

- All exercises and logged sets live in this browser's IndexedDB, tied to this site's
  origin. Nothing is ever sent to a server.
- Use **Progress → ⚙ Backup & data** to export a JSON file at any time, and to import one
  (with an explicit merge-or-replace choice — nothing is overwritten silently).
- **iOS-specific risk:** Safari can clear local site data (including installed PWAs) if you
  don't open the app for roughly a week or more. The app shows a non-blocking reminder
  banner if it's been over 7 days since your last export — take it seriously on iOS.
  This is a real constraint of the platform, not a bug in this app; exporting regularly is
  the mitigation.
- On first launch the app calls `navigator.storage.persist()` to ask the browser to treat
  its storage as durable. This is a best-effort request, not a guarantee.

## Updates after you change the code

The service worker precaches the app shell so it opens instantly and works offline. When
you ship a change and redeploy, an already-installed app will show a small "A new version
is ready — Reload" banner next time it's opened, rather than silently going stale.

## Testing checklist (matches the design doc's acceptance criteria)

- [x] `npm test` — total calculation, daily completion, target-history behavior, streaks,
      undo, and backup validation (automated, runs in CI on every push).
- [ ] Manual: open on a real phone-sized viewport and confirm Today/logger work with no
      horizontal scrolling.
- [ ] Manual: turn off network after loading once, confirm logging still works and data
      persists on reopen.
- [ ] Manual, iOS only: install via Safari, don't open it for 7+ days, confirm the backup
      reminder banner appears.
- [ ] Run a Lighthouse PWA audit (Chrome DevTools → Lighthouse) against the deployed URL
      before considering v1 done — it will flag anything missing for installability.

## How this differs from the in-chat prototype

The version built earlier in this conversation runs entirely inside the chat interface
using Claude's own artifact storage — it works immediately with zero setup, but isn't
installable to a home screen or usable offline as a standalone app. This project is the
full version described in the original design: real IndexedDB, a real service worker,
a real web app manifest, and a real (free) CI/CD deploy pipeline to GitHub Pages. The
domain logic (totals, streaks, target history) is identical between the two, and both
were verified against the same test scenarios.
