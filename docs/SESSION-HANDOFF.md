# Sets — session handoff

Paste this into a new session to continue.

---

## The app

**Sets**, a workout set tracker. Vanilla JS + Vite PWA, no framework, no runtime
dependencies. Repo: `/Users/johnmendoza/Downloads/workout`.
Live at https://johnpatrickmendozacdu-pixel.github.io/workout/ (GitHub Pages,
deploys from `main` via Actions). **The app URL has never changed and should not.**

- `src/domain/domain.js` + `src/domain/stats.js` — pure, hold every rule
- `src/main.js` — all rendering and events (large; no test coverage)
- `src/guide.js` — the Guide tab's content, as data. No logic.
- `src/db/db.js` — IndexedDB wrapper, namespaced per Google account
- `src/sync/googleSync.js` — self-contained Google auth + Drive (no test coverage)
- `worker/` — the Cloudflare token-broker (deployed separately, see below)

**260 tests, all passing** (`npm test`). They cover the pure domain layer and the
Worker's pure helpers only — **not `main.js`, not `googleSync.js`**.

## State right now

- `main` = **`f1e1db8`** deployed; category + one-time work committed on top and
  deployed the same way. Byte-verify every deploy against a fresh local build.
- Everything the user asked for is shipped. **Nothing is outstanding.**
- The one thing unconfirmed: whether broker sync genuinely survives past an hour on
  the user's phone. Only they can verify (needs their Google account).

## Architecture decisions that are settled — do not re-litigate

**Hosting stays on GitHub Pages.** Vercel was evaluated and rejected (identical for a
static PWA; migrating means redoing OAuth and losing IndexedDB data, which is
per-origin). Supabase was evaluated and rejected (its free tier pauses after 7 days
idle, breaking "100% functional"; full data migration is the highest risk to "no lost
data"). The user's use case — family and friends, each on their own phone, each Gmail
with its own data — already works.

**Data lives on the phone; Drive is the backup.** The user has asked twice why Drive is
still involved. Answer: IndexedDB is the live data (instant, offline); Drive's private
appdata folder is the safety net for a lost phone or a new device. The token-broker did
not remove Drive — it only keeps the *login* alive.

**Privacy is already sufficient.** Everyone uses their own phone, so each Gmail's data
is isolated by device + their own Drive folder. Server-enforced privacy (Supabase RLS)
would add nothing real and breaks the free/always-on rule.

## The token-broker (new this session)

A **stateless Cloudflare Worker** at `sets-broker.johnpatrickmendoza-cdu.workers.dev`
holds the Google client secret and swaps tokens on demand. It **stores nothing** — each
user's refresh token lives in their own device's IndexedDB. Workout data never passes
through it.

- Turned on via `BROKER_URL` in `googleSync.js`. **Emptying that one constant reverts
  the app to the pre-broker flow instantly** — the emergency escape hatch.
- Every broker call returns false on failure and falls back to the old Google Identity
  Services path, so the broker can only add reliability.
- Deploy steps for the user: `worker/README.md`. Paste-ready single file:
  `worker/deploy-this.js`.
- Verified by curl: correct origin → 204 + CORS; foreign origin → 403; bogus token →
  401 from Google. The end-to-end hour-long test is the user's.

## Hard-won facts — do not re-derive these

**A logged day is immutable history.** Changing an exercise's schedule used to erase
its streak and strip: four separate places (`calcDayStats`, `streakInfo`,
`recentDayStates`, `dayHistory`) re-judged every past day against the *current*
schedule. Rule now: a day with logged reps always counts; only an **empty** unscheduled
day is a rest day. Schedule also records history (`scheduleHistory`), like targets do.

**Never trust "it was always broken."** Top set went 20 → 25 → 89 across three fixes
because the assistant reasoned about data it could not see. The real fix was the user's
idea: `topSetSince` draws a line at today, so old/bad entries can never be the record.
**Ask to see the data before theorising about it.**

**The "TV static" flash was a full re-render.** Every backup cycle applied the merged
snapshot and called `rerender()` (a whole-DOM `innerHTML` swap) even when the merge
equalled what was already there. Fixed by `sameSnapshotData` — an order-insensitive
deep compare, because a merge reshuffles key order without changing content, so
`JSON.stringify` would have called identical data different.

**The Google 403 was an unregistered scope.** Publishing the app, the tester list, and
External vs Internal were all red herrings. The consent screen's **Data Access** page
was empty — `drive.appdata` was never registered. It is a **non-sensitive** scope, so
there is no verification requirement and no "unverified app" warning.

**One-time workouts are ordinary exercises.** The old parallel `oneTimeLog` — its
own array, its own widget, no timer or target — was deleted on 2026-08-04. The
sync key went with it: `mergeOneTimeLogs` was a union by id, so clearing entries
locally would have let the next Drive sync hand them straight back. Dropping the
key from `SNAPSHOT_DATA_KEYS` is what actually bins them.

**EMOM is gone.** Removed on 2026-08-04 as faulty, along with everything only it
used: the count-in, the round band, the one-EMOM-at-a-time rule, and the whole cue
sound system (~400 lines). The normal workout clock is untouched. Old exercises keep
dead `timerMode`/`emomWorkSec` fields — nothing reads them, so there was no migration
and no risk to anyone's Drive backup.

**If sound ever comes back:** never use Web Audio. iOS silences it with the
ring/silent switch; `<audio>` elements play on the media channel. The removed version
generated WAV tones in code and primed them muted inside the first tap.

**Never rebuild a stored object from the fields one form edits.** `saveProfile` did
`{username, weight, height}` and destroyed the avatar; sync then propagated the
deletion. Same class of bug: arrays on the profile (`weightLog`) must
merge as a **union**, never be replaced by a spread.

**One entry per day, not per change.** `recordWeight` used to skip an unchanged weight,
so logging the same number as yesterday never marked today done and the card kept
asking.

## Feature map (what exists now)

| Area | Behaviour |
|---|---|
| Today | Only exercises scheduled for today (or already logged), one-offs included. Daily weigh-in card → "✓ Weighed in today · N kg" once done. |
| Plan | Grouped by shared schedule, collapsed by default, tap to open. Add → Scheduled or One-time. Category picks the icon. Equipment: bodyweight / dumbbell + kg/lb. |
| Progress | Same schedule groups + combo times (total/avg/best per group). Weekly-average weight chart. BMI. One-offs get their own group, sorted last. Per-exercise: top set, best day, lifetime, best/avg/total time, weight progression. |
| Health habit | Daily weigh-in, weekly-average line chart. Never touches any exercise streak. |
| Guide | Fourth nav tab. Every section collapsed on arrival; open one to read it. Content is data in `src/guide.js` — one table, one source of truth. Adding a feature means adding a row there, not re-writing an explanation somewhere else. |
| Categories | Eight, in `src/categories.js`. The exercise stores the category, never the picture, so artwork can be redrawn without touching saved data. Icons cut from `icon-source.png` by `tools/slice-icons.py`. |
| One-time | A real exercise carrying `oneTimeDate` — same clock, target and keypad as any other. `isScheduledOn` returns true only on that date, so every view and the streak maths follow for free. Hidden after its day, never deleted. |
| Sync | Per-Google-account namespaced data; Drive appdata backup; token-broker keeps it alive. Failures queue quietly — no red alarms. |

## How this user works

- **Verify by using, never by calling a handler.** Screenshot at 375px, check tap
  targets clear 44px, no horizontal overflow, exercise state changes *without*
  reloading between checks.
- **Byte-verify every deploy.** `__BUILD_ID__` is the git short SHA, so a build is
  deterministic per commit: build the same commit locally and `shasum` the live asset
  against `dist/`. Grepping minified output produces false alarms.
- **Deploy after each change**, then confirm live. The user then runs
  **Backup & data → Force update now** on the phone (the installed PWA keeps its own
  service worker and cache).
- **They want speed.** "Don't ask me lots of questions, make sensible calls and tell
  me." Build first, explain briefly, ship. But *do* ask when a decision is genuinely
  theirs or readings differ materially.
- **Their short corrections are usually right.** "I literally did 25 in one set",
  "no sense transferring", "just start fresh with top set" — each one cracked a problem
  the assistant was over-thinking. Take them seriously and immediately.
- They ask for `superpowers:brainstorming` + `ponytail` by name. Ponytail's first rung —
  *does this need to exist at all?* — has repeatedly been the right answer (it killed
  the Vercel and Supabase migrations).

## Lessons that cost time

- **Don't reason about data you cannot see.** Three wrong top-set fixes came from this.
- **`main.js` and `googleSync.js` have zero test coverage.** A revert once deleted 178
  lines of `googleSync.js` and every test still passed. Always load the app after
  touching them.
- **Check the whole config surface before blaming one setting.** Two hours went into
  tester lists and publishing status when the actual 403 cause was an empty Data Access
  page.
- **A "flash"/"glitch" report can be a real bug**, not a cosmetic one — it was a
  full-DOM rebuild firing on every sync.

## Things only the user can do

- Anything needing their Google account, including confirming sync survives an hour.
- Google Cloud Console changes; Cloudflare Worker changes.
- **Force update now** on the phone after each deploy.
