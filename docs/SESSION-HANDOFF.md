# Sets — session handoff

Paste this into a new session to continue.

---

## The app

**Sets**, a workout set tracker. Vanilla JS + Vite PWA, no framework, no runtime
dependencies. Repo: `/Users/johnmendoza/Downloads/workout`.
Live at **https://sets-workout.vercel.app** (Vercel, auto-deploys from `main`).

The old GitHub Pages address was retired on 2026-08-05. It is not dead — Pages now
publishes a one-page redirect (`pages-redirect/`) instead of the app, so an old
bookmark forwards to the new address rather than serving a frozen copy that can
never update. That page also unregisters the old service worker first, without
which an installed PWA would keep showing its cached app and never see the
redirect at all.

**The app is no longer pinned to one address.** The redirect URI is derived from
wherever it is running and sent to the broker, which checks it against a
comma-separated `ALLOWED_ORIGIN`. Adding a host is a Google Console entry plus
one Cloudflare variable — never a code change.

- `src/domain/domain.js` + `src/domain/stats.js` — pure, hold every rule
- `src/domain/habits.js` — pure, every health-habit rule (5 AM day, slots, the
  immutability guard, streaks, presets). The merge lives in `domain.js` instead,
  next to the others, so `habits.js` never imports back and makes a cycle.
- `src/main.js` — all rendering and events (large; no test coverage)
- `src/guide.js` — the Guide tab's content, as data. No logic.
- `src/categories.js` — the nine categories and their icon lookup. No logic.
- `tools/slice-icons.py` — cuts the icons out of the committed source art. Re-run
  after changing any source image; it is the only place crop boxes live.
- `pages-redirect/` — what the retired GitHub Pages address now serves.
- `src/db/db.js` — IndexedDB wrapper, namespaced per Google account
- `src/sync/googleSync.js` — self-contained Google auth + Drive (no test coverage)
- `worker/` — the Cloudflare token-broker (deployed separately, see below)

**385 tests, all passing** (`npm test`). They cover the pure domain layer and the
Worker's pure helpers only — **not `main.js`, not `googleSync.js`**.

## State right now

- `main` = **`387c5ee`**, health habits shipped. Working tree clean apart from
  `.DS_Store`. **Not yet byte-verified against Vercel** — do that before trusting
  the deploy.
- **385 tests pass.** Byte-verify every deploy against a build of the *pushed*
  commit — `__BUILD_ID__` is the commit SHA, so a build made before committing
  can never match. That mistake has cost a round of false-alarm polling twice.
- Migration finished and verified 2026-08-05: the old Pages address serves a
  redirect, the old app's assets 404, and a browser following the old link lands
  on Vercel.
- **Worker = build `2026-08-12.10`**, deployed and confirmed by
  `curl -X POST -H 'Origin: https://sets-workout.vercel.app' .../crew/version`.
  Every D1 migration has been run. If a crew feature misbehaves, check that
  version FIRST — it is the only pre-auth route, and it is there because every
  other one answers 401 before it looks at the path.
- **Nothing is outstanding in the code.** One optional chore is the user's: the
  Google Console warns about a second, unused OAuth client secret. Check which one
  the Worker holds before deleting the other, and never paste either into chat.

## Next up (raised, not built)

- UX ideas brainstormed and **not** built, in the user's order of interest: a
  "last time you did this" line inside the logger, a rest timer between sets
  (iOS has no vibration and the audio system was deleted, so it would be visual
  only), a session summary when the last card clears, and a year heatmap.
  Reminder notifications were explicitly ruled out: reliable ones need a server,
  which breaks "zero maintenance".
- Badminton (2026-08-10) took the picker to ten, so `.cat-grid` is four across.
  Add an eleventh and check that row again.
- **Crew personalisation, brainstormed 2026-08-12, three of five built.** Built:
  the crew motto, member-since, and rest days showing to the crew. Not built, in
  the user's order of interest: a **handle** (one self-set line under your own
  name), **earned ink** (small marks derived from your own numbers — 100 days,
  10k reps — needing no storage and impossible to grant), and a **composed crew
  emblem** (pick a shape, a symbol and a letter; the app draws it in the graffiti
  style like the share cards, stored as three numbers rather than an upload).
  Explicitly parked: a shared wall (storage + moderation), a crew streak (real
  pressure risk), anything bought or randomised.
- **The QR invite card was designed and never built.** It needs a vendored MIT
  QR encoder in `src/vendor/` — the one dependency the app would carry. The
  invite is link-and-code only until then.

## Architecture decisions that are settled — do not re-litigate

**Hosting moved to Vercel on 2026-08-05**, for one reason only: a free
`sets-workout.vercel.app` reads better than `<long-username>.github.io/workout`.
Everything else about the two is identical for a static PWA. The cost is the
per-origin one: IndexedDB does not follow, so everyone must sign in on the new
address to pull their data back from Drive — confirmed working for Johnny.
Supabase was evaluated and rejected (its free tier pauses after 7 days
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

## Crews — the social layer (new 2026-08-11)

A fifth tab, **Social**. Crews live in **Cloudflare D1 on the same Worker** as the
token broker, because Drive cannot do it: `appdata` is private per user, and
`drive.file` only reaches files the app itself created, so a shared folder is
invisible to everyone but its author. The scope that would fix that
(`drive.readonly`) is **sensitive** — verification, and possibly a paid annual
security assessment. D1's free tier does not pause when idle, which is the exact
reason Supabase was rejected.

- **Identity costs no new scope.** The app sends the Google access token it
  already holds; the Worker asks Google's userinfo whose it is — the same trick
  `exchange()` uses. No re-consent, no Console change. The user id is the `sub`,
  never the email.
- **What leaves the phone** is a card the phone builds (`buildCrewCard`): name,
  photo, streaks, lifetime totals, per-exercise streaks. Never the log, never
  weight. `sanitiseCard` in `worker/crew.js` re-derives every field rather than
  trusting the client, so a modified app cannot widen what a crew sees.
- `worker/deploy-this.js` is **generated** — `node tools/bundle-worker.mjs`.
  Editing it by hand is how it drifts from the tested source.
- Setup done 2026-08-11: D1 database `sets-crew`, bound as `DB`. Verified live by
  curl — `/crew/sync` answers 401 to a bad token (503 would mean the binding is
  missing), the broker is unaffected, a foreign origin still gets 403.
- Reactions dedupe on the primary key `(crew, from, to, kind, emoji, day)` — the
  schema is the rate limit, not application code.
- **Unwatched stories are counted on the member's photo**, and "seen" is kept in
  IndexedDB (`stories-seen`, pruned at 48h) rather than read back from the
  Worker: views are recorded per *day*, which is right for "who looked at your
  card" and wrong for a badge — a story watched at 23:55 came back unwatched at
  midnight. Your own stories never count; the Worker does not record you viewing
  them.

**Migrations already applied** (D1 `sets-crew`): the four base tables, then
`stories`, `views`, and `ALTER`s adding `members.rank`, `members.role`,
`members.class`, `crews.logo`, `crews.motto`. Anything new needs its own ALTER,
run **one statement per Execute**.

**Everything the crew now carries** (all shipped 2026-08-11/12): invite link with
an Accept sheet and `/crew/peek`; stories (several a day, 24h, viewer list, the
picture fetched on open, never in the roster); profile and story views, one row
per viewer per day by primary key; Nudge / Good job / emoji with named senders;
roles (leader, vice, member) and classes (fighter, artist, tank, tech, tycoon)
assigned by the leader, each with drawn art; a crew logo; a crew motto; member
since; and rest days shown as 🌙 with the nudge button withheld.

**Worker deploys are a dashboard paste, and that has cost time twice.** Paste
into the Worker's **entry file** — pasting as a new file leaves the entry point
untouched and Deploy stays greyed out. `/crew/version` is pre-auth precisely so
"did the paste land?" is answerable from outside: every other route answers 401
before it looks at the path. The D1 console runs **one statement per Execute**;
a multi-statement block silently does nothing, which is how the stories tables
went missing and took the whole tab down.

**Optional data must never be able to kill the roster.** Naming the `rank`
column in the query that builds every crew meant one missing ALTER broke
everything. Stories, views, roles and the logo are all fetched behind `maybe()`
now: absent is absent, not fatal.

**Identity is Drive, not userinfo.** The app holds only `drive.appdata`, and
`userinfo` is not covered by it — a token that syncs perfectly gets a 401 there.
`drive/v3/about` answers on the scope already granted and its `permissionId` is
the stable per-user id. Asking for the email scope would have meant a fresh
consent screen for every user.

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
- `ALLOWED_ORIGIN` is a **comma-separated list**. The response echoes the caller's
  own origin, never the list — a browser accepts exactly one value.
- Verified by curl on 2026-08-05: both origins → 204 + CORS; foreign origin → 403;
  a redirect pointing at another site, or a lookalike like
  `sets-workout.vercel.app.evil.com` → `bad-redirect`. The hour-long test is the user's.

## Hard-won facts — do not re-derive these

**A habit day runs 5 AM to 4:59 AM.** `habitDay(nowMs)` is the calendar date
five hours ago, so a 1 AM snack breaks the night you are still living rather
than the morning you have not started. Only habit code calls it — `todayISO()`
keeps its meaning everywhere else. Between midnight and 5 AM the two disagree
and the card says so, or it looks broken.

**A logged habit slot can never be changed.** Add anything, change nothing. The
guard lives once, in `logSlot`, and a refused write returns *the same object* so
callers can skip the save and the re-render. There is no catch-up prompt and no
edit path — a day you never logged stays unlogged forever, and counts as
neither clean nor broken. A rewritable log is one that argues with you at
exactly the moment you are most motivated to lie.

**Off plan is refused once anything is logged.** Without that guard you could
break at lunch, mark the day off plan, and keep the streak — which would make
every streak in the app meaningless. It is a decision taken before the day, not
an escape hatch during it. It is also the only habit state that can be undone.

**`mergeByDayKey` is one level too shallow for `habitLog`.** It merges day →
key, so the winning phone's habit entry would replace the loser's whole slot set
and bin meals logged on the other device. `mergeHabitLogs` goes day → habit →
slot, and because a slot can never change, the merge is conflict-free: where
both sides hold a value it is the same tap, so the **earlier timestamp wins**.

**Habits are archived, never deleted** (`active: false`), which is why they need
no tombstone key. Two new sync keys only: `habits`, `habitLog`.

**An empty plan must not hide a habit.** `viewToday` returns early when there
are no exercises; that branch now renders the habits section first. Progress
already had the equivalent rule for the weigh-in block.

**A logged day is immutable history.** Changing an exercise's schedule used to erase
its streak and strip: four separate places (`calcDayStats`, `streakInfo`,
`recentDayStates`, `dayHistory`) re-judged every past day against the *current*
schedule. Rule now: a day with logged reps always counts; only an **empty** unscheduled
day is a rest day. Schedule also records history (`scheduleHistory`), like targets do.

**A typed number on Today is a SET, not a day total.** A real 28 came back as
20 + 8 because the pad has no 28, so the only way in was the logger's editable
total — and `setDayTotal` splits a typed total into 20-chunks on purpose, so a
day's number can never pose as one heroic set. The total is now a readout and
**Exact set** (under it) logs one set of whatever is typed. `splitIntoSets`
survives only on the Progress day list, where correcting an old record lives.

**A time exercise banks minutes into the same log as everything else.**
`mode:'time'`, `unit:'min'`, target in minutes, and `bankTimeSession` writes ONE
entry (never split — a clock reading is not a typed number) on pause, give-up,
take-the-win and reset. That is why streaks, best day, lifetime, charts, the day
list and both share cards needed no special cases. What is *done* reads the
banked number; what is *shown* reads the live clock, or a running session would
claim 0.

**`render()` never restarted the clock.** `ensureGlobalTick` was only reached
through `renderModal`, so a reload during a live session left the clock frozen
until something opened a modal. Harmless-looking until timed exercises arrived —
their target check rides that tick. It is now called from `render()` and on
`visibilitychange`.

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

**The trajectory chart is a 30-day window, and it says so.** It scales to the data
rather than the window, so a short history fills the frame instead of hugging the
right edge. It labels the first and last plotted totals and the change between
them — and only claims "since you first started" when the first plotted day really
is the first ever logged, otherwise "in N days". The all-time anchor is the First
day tile, which never moves whatever the chart happens to reach.

**`exerciseStats(ex, setsLog, timersLog, todayOverride, overrides)`** — the
overrides are the *fifth* argument. Passing them fourth silently returns a zero
streak. Caught only by looking at a rendered share image.

**One entry per day, not per change.** `recordWeight` used to skip an unchanged weight,
so logging the same number as yesterday never marked today done and the card kept
asking.

## Feature map (what exists now)

| Area | Behaviour |
|---|---|
| Today | Only exercises scheduled for today (or already logged), one-offs included. Daily weigh-in card → "✓ Weighed in today · N kg" once done. |
| Plan | Grouped by shared schedule, collapsed by default, tap to open. Add → Scheduled or One-time. Category picks the icon. Equipment: bodyweight / dumbbell + kg/lb. |
| Progress | Same schedule groups + combo times. Weekly-average weight chart. BMI. One-offs get their own group, sorted last. Per-exercise card: 7-day strip, streak, then figures in **two groups** — reps (top set, first day, best day, lifetime) and time (best/average/total) — each with a 💡 that opens term-and-meaning rows. Empty figures are not rendered at all. Day list is unboxed: green total = target met, dashed underline = tap to edit. |
| Health habits | Plan → Add → Health habit. Recurring, no target, own streak. Two shapes: **meals** (six slots — breakfast, morning snack, lunch, afternoon snack, dinner, evening snack) and **plain** (one tap a day). Each slot is Kept / Skipped / Broke. A day is **clean** (nothing broke, ≥1 kept), **broken** (anything broke), **neutral** (nothing logged, or all skipped) or **off plan**. Neutral and off-plan days are gaps the streak steps over. Three presets — Keto, No alcohol, Sleep by 11 — which are **copied, never linked**. |
| Weigh-in | Daily weigh-in, weekly-average line chart. Never touches any exercise streak. Deliberately not a "health habit": it stores a number BMI and the chart read. |
| Guide | **Two of them, deliberately.** The Guide tab (book icon, 4th slot) is the full 12-step walkthrough, collapsed on arrival, content as data in `src/guide.js`. The topbar **?** opens a short sheet about the screen you are standing on (`modalGuide`). The Guide screen carries no ? of its own. They were merged once and it was worse — the user asked for both back. |
| Categories | Ten, in `src/categories.js`. The exercise stores the **category key, never the picture**, so artwork can be redrawn without touching a single saved exercise. Icons are cut from committed source art by `tools/slice-icons.py` — a grid (`icon-source.png`) plus per-category singles. Exercises saved before categories show no icon until edited; that blank is deliberate. |
| Timed exercises | Plan → How you measure it → **Time** (number + min/hr). No keypad on Today: a dormant clock with Start, then the usual Pause / Resume / Give up / Complete. Nothing auto-completes — reaching the target pauses and asks *Take the win / Keep going* the next tick you are looking at it. Progress swaps in Longest session, First day, Average session, Lifetime, all as durations. |
| Share image (foot) | Every card signs itself: the crew's name and motto, your role and class with their art, your profile name and photo. Drawn from the crew you are looking at; absent entirely when you are in none. |
| Share image | "Save image" on an opened exercise card draws a 1080² card on a canvas — name, category, streak, the climb, all seven figures, and a `Sets · sets-workout.vercel.app` watermark. A **finished exercise on Today** has its own button drawing the same frame with the day's figures instead: total / target, the clock, sets, streak — reachable from the Done row's share glyph without opening the exercise. A third card, **Share this day**, hangs off the All-done block: every exercise finished today as a list, then exercises / time / streak. All three go to `navigator.share`, which is the whole Instagram/Facebook story — the sheet is the integration. Direct posting needs a server, a Business account and Meta app review; ruled out, and the button says **Share**, not Save, because the sheet is what opens. Canvas → blob → `navigator.share` (the only route to the photo library) with a download fallback. Nothing is uploaded. No dependency: `html2canvas` was rejected on those grounds. |
| One-time | A real exercise carrying `oneTimeDate` — same clock, target and keypad as any other. `isScheduledOn` returns true only on that date, so every view and the streak maths follow for free. Hidden after its day, never deleted. |
| Timestamps | The moment a day's work finished, shown on Today's done row, on today's row in Progress (today only — older days predate the stamp), and on a crew member's day. `stampFinished` writes it on the target crossing and never overwrites; `finishTimer` already covered a session closed by hand. |
| Social | Crew roster ordered by who trained today, then streak. Tap a member for their streaks, totals and per-exercise list. Invite by link or code; owner can rename and remove, anyone can leave, the owner leaving hands it to whoever joined first. Renders from a cached roster before any request and says so when offline — the only screen in Sets that needs the network, and nothing else can be taken down by it. |
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
- **A green build and green tests prove very little here.** A dangling `oneTime`
  reference made Progress silently render Today's markup; both bugs in the share
  image were invisible in code. Open the thing and look at it.
- **Never grep minified output for a local variable name.** The minifier renames
  them; the answer is a hash comparison, not a `grep`.
- **Editing `.github/workflows/` needs `workflow` scope on the push token.** A
  paste into GitHub's web editor truncated silently mid-file, and an invalid
  workflow does not merely fail — it stops Pages deploying at all. Push workflow
  files, do not paste them.
- **Seeding demo data to check a view is fine, but clear it afterwards.** The dev
  server runs against real IndexedDB; a mis-tap once logged 15 reps into the
  user's actual Push Ups and bumped its target.

## Things only the user can do

- Anything needing their Google account, including confirming sync survives an hour.
- Google Cloud Console changes; Cloudflare Worker changes.
- **Force update now** on the phone after each deploy.
