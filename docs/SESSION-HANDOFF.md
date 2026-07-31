# Sets — session handoff

Paste this into a new session to continue.

---

## The app

**Sets**, a workout set tracker. Vanilla JS + Vite PWA, no framework, no runtime
dependencies, no backend. Repo: `/Users/johnmendoza/Downloads/workout`.
Live at https://johnpatrickmendozacdu-pixel.github.io/workout/ (GitHub Pages,
deploys from `main` via Actions).

`src/domain/domain.js` and `src/domain/stats.js` are pure and hold every rule.
`src/main.js` is all rendering and events. `src/db/db.js` wraps IndexedDB.
`src/sync/googleSync.js` is self-contained Google auth + Drive.

**194 tests, all passing** (`npm test`). They cover the pure domain layer only —
see the warning under "Lessons" about what that misses.

## State right now

- `main` = **`00a846a`**, pushed, deployed, working tree clean.
- Every one of the user's requests this session is shipped and verified live.
- **One open decision, described in full at the bottom: how Google sync should
  behave.** Nothing else is outstanding.

## What was built this session

All verified in a real browser at 375px and against the deployed bundle:

| Feature | Build |
|---|---|
| Records (Top Set / Best day) wait until the day is sealed | `547be49` |
| Quick-add field deleted (it did nothing); logo moved to topbar | `547be49` |
| Sync merges instead of one device overwriting another | `0ace0a5` |
| EMOM timer mode | `e0c41e1` |
| Trajectory chart + profile photo | `aabe686` |
| Build chip restored on Today | `57ef9fc` |
| EMOM count-in (5-4-3-2-1) and approach beeps | `2cae029` |
| Beeps made audible (media channel, not Web Audio) | `5846947` |
| One EMOM session at a time | `fda3514` |
| Save profile no longer deletes the photo | `0d46c50` |
| Sync watchdog / lock / token persistence | `e41e745` |
| Google redirect renewal added, then removed at user's request | `2ad2399` → `00a846a` |

Design specs for the bigger pieces are in `docs/superpowers/specs/`.

## Hard-won facts — do not re-derive these

**Audio.** Never use Web Audio for cues. iOS silences it with the physical
ring/silent switch while `<audio>` elements play on the media channel. A muted
Web Audio output is invisible from inside the page: context `running`, source
started, no error, no sound. Cues are now WAV tones generated in code and played
through `<audio>`, primed muted inside the first tap. Confirmed working on the
user's iPhone.

**EMOM stores nothing.** It is a pure function of the workout clock's
`elapsedMs`, so pause/reset/seal all work for free. The 5s count-in works by
putting `runStartedAt` in the *future* — `timerElapsedMs` already clamps at
zero, so both clocks hold at 0:00 and start together.

**Never rebuild a stored object from the fields one form edits.** `saveProfile`
did `{username, weight, height}` and destroyed the avatar; sync then propagated
the deletion, so it looked like a sync bug. The same mistake was in the merge
(whole-object profile swap). Both fixed; profiles now merge field by field.

**Sync watchdog.** One cycle is three Drive requests at 15s each, so a healthy
sync can take ~45s. The watchdog fired at 20s and blamed *consent*. It is now
60s, cycles are serialised, and a timeout no longer asks for consent.

## The one open question: Google sync

**The constraint.** Google gives browser apps an access token lasting ~1 hour
and no way to renew it offline. Renewal normally happens through a hidden frame
to accounts.google.com — **which Safari blocks, always**. Every iOS browser uses
Safari's engine, so Chrome/Firefox on iPhone behave identically. Desktop
Chrome/Edge would work fine, but the user is deliberately mobile-only.

Consequence: about an hour after signing in, sync stops until the user taps.
Data is never at risk — everything is on the phone instantly; only the Drive
copy goes stale.

**Current behaviour (`00a846a`).** Signs in, syncs automatically for that hour,
then goes quiet. **No path anywhere sets `reconnect` on launch** — the app never
nags. To sync again: Profile → Sync now.

**Only two ways to make it automatic, both currently rejected:**

1. **A small server** holding a refresh token. Free on Cloudflare Workers.
   Rejected: user does not want a server.
2. **Top-level redirect renewal** (`prompt=none`). Works because Google is
   first-party during a full navigation. Needs the app URL added as an
   **Authorized redirect URI** on the existing OAuth client. Was built in
   `2ad2399` and removed in `00a846a`.

**Where the conversation stopped.** The user rejected the redirect saying it
"sounds risky", which was likely a misreading caused by the assistant leading
with caveats. The redirect is the *standard* OAuth flow and carries **no**
security trade-off — the redirect-URI whitelist is itself a security control,
and the scope stays `drive.appdata` (the app's own hidden folder only, never the
user's real Drive). The genuine risks are cosmetic: a flash on open, and a
possible bounce from the installed PWA into Safari.

The user was asked to choose between:

- **Restore the redirect** (`git revert 00a846a` brings it back) → automatic
  sync on open, one console step needed.
- **Add a "weekly line"** → one quiet line at the top of Today, only when it has
  been >7 days since a successful sync, with a Sync button. Not built yet;
  roughly 15 lines. Without it, sync can lapse silently for weeks unnoticed,
  which is the real risk of an app that never interrupts.

**They had not answered when the session ended. Ask which they want.**

## How this user works

- **Verify by using, never by calling a handler.** Screenshot at 375px, measure
  tap targets clear 44px, check for horizontal overflow, and exercise state
  changes *without reloading between checks*.
- **Check the deployed bundle**, JS *and* CSS, not just `version.json`. Grepping
  minified output produces false alarms — function names get renamed, and a
  truncated download reads as a missing feature. Compare byte-for-byte against a
  fresh local build instead.
- **Deploy after each change**, then confirm live. The user must run
  **Backup & data → Force update now** on the phone (the installed PWA keeps its
  own service worker and cache).
- They dislike being asked lots of questions; make sensible calls and state
  them. But do ask when readings differ materially.
- They correct wrong theories with short, precise observations. Take these very
  seriously — three of them cracked bugs this session: *"I heard beeps before"*
  (made it a regression, not a platform limit), *"even without a new app launch"*
  (killed the cold-start theory), *"it shouldn't disappear"* (it was a save bug,
  not sync).

## Lessons that cost time this session

- **Ask "did this ever work?" first.** Assuming a feature never worked sent the
  investigation down the wrong path for two builds.
- **The 194 tests do not cover `main.js` or `googleSync.js`.** A revert once
  deleted 178 lines of `googleSync.js` — the token client, timeout helpers,
  everything — and every test still passed. Only opening the app caught it.
  Always load the app after touching those files.
- **Do not report a grep against minified output as a finding** without checking
  it a second way.

## Things only the user can do

- Anything needing their Google account, including confirming sync works at all.
- Google Cloud Console changes (OAuth origins / redirect URIs).
- Force update on the phone.
