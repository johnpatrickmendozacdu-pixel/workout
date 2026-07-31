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

**199 tests, all passing** (`npm test`). They cover the pure domain layer only —
see the warning under "Lessons" about what that misses.

## State right now

- `main` = **`cd0844a`**, pushed, deployed, working tree clean, 199 tests green.
- Every one of the user's requests is shipped. **No decisions are outstanding.**
- **One step only the user can take:** add the app URL as an Authorized redirect
  URI on the OAuth client, or the restored redirect stays inert. Details at the
  bottom. Until then it fails closed and sync just stays manual.
- Two sessions were working in this repo at once on 2026-07-31. If a dev server
  already holds port 5173, that is likely another session, not a stale process.

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
| Weekly "not synced for N days" line | `7f2bdf0` |

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

## Google sync: settled, but needs one console step

**The constraint.** Google gives browser apps an access token lasting ~1 hour
and no way to renew it offline. Renewal normally happens through a hidden frame
to accounts.google.com — **which Safari blocks, always**. Every iOS browser uses
Safari's engine, so Chrome/Firefox on iPhone behave identically. Desktop
Chrome/Edge would work fine, but the user is deliberately mobile-only.

Consequence: about an hour after signing in, sync stops until the user taps.
Data is never at risk — everything is on the phone instantly; only the Drive
copy goes stale.

**What the user chose: both defences.**

1. **Redirect renewal** (`prompt=none`), restored in `cd0844a` — an exact mirror
   of the removal in `00a846a`, originally built in `2ad2399`. Works because
   accounts.google.com is first-party during a full navigation, so the session
   cookie is sent and a token comes back with no interaction. Renews sync
   automatically on open.
2. **The weekly line**, built in `7f2bdf0`. One line at the top of Today, shown
   only when a successful sync is more than 7 days old, with a Sync button that
   signs in if the token has died and simply syncs if not. Hidden when signed
   out, hidden when recently synced. Rule is `syncNudge` in `domain.js`, five
   tests cover it.

They complement each other: the redirect keeps sync alive, the line is the
backstop for when it cannot be — signed out, consent withdrawn, Google changed
something. The line is the only thing that would ever tell the user sync died.

The user's earlier "sounds risky" was a misread caused by the assistant leading
with caveats, and they said so. The redirect is the *standard* OAuth flow with
**no** security trade-off: the redirect-URI whitelist is itself a security
control, and the scope stays `drive.appdata` (the app's own hidden folder, never
the real Drive). The genuine risks are cosmetic — a flash on open, and a
possible bounce from the installed PWA into Safari. Watch for that bounce; it is
the one thing that would justify reconsidering.

**A server** holding a refresh token (free on Cloudflare Workers) remains the
third option and is still rejected: the user does not want a server.

### The console step, which only the user can do

The redirect **does nothing until this is done**, and fails closed if it is not:

1. Google Cloud Console → APIs & Services → Credentials
2. Open the existing OAuth 2.0 Client ID for this app
3. Under **Authorized redirect URIs**, Add URI:
   `https://johnpatrickmendozacdu-pixel.github.io/workout/`
   (exact, with the trailing slash — `REDIRECT_URI` in `googleSync.js` is
   hard-coded to match, because a mismatch is the one thing Google rejects
   outright)
4. Save, then sign out and back in once in the app

`canRedirectRenew()` returns false anywhere but that exact URL, so localhost dev
never redirects.

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
