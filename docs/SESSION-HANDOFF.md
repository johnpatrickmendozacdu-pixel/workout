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

- `src/domain/domain.js` + `src/domain/stats.js` — pure, hold every rule.
  `progressValue`/`targetMet` (sets-vs-reps) and the proof record live in
  `domain.js`; `clusterByCategory`, `flameLevel` and `bestSessionTotal` in
  `stats.js`.
- `src/domain/habits.js` — pure, every health-habit rule (the 5 AM day, slots,
  the immutability guard, streaks, presets). The habit-log MERGE lives in
  `domain.js` instead, next to the other merges, so `habits.js` never imports
  back and makes a cycle.
- `src/notices.js` — the bell's contents, as data. Adding an entry IS what sends
  it to everyone.
- `src/fx.js` — the screen change, and nothing else. One function plus a gate.
- `src/main.js` — all rendering and events (large; no test coverage)
- `src/sound.js` — every clip, the audio session, the three settings. No network.
- `tools/hue.py` — the one hue rotation both art generators share.
- `tools/fire-sheets.py` — flame sheets, floor ring, profile frame, from the
  source GIFs, each with its black floor crushed to zero. `tools/greens.py` —
  the arena plate and the icons. It no longer makes a floor mark; there is none.
- `src/guide.js` — the Guide tab's content, as data. No logic.
- `src/categories.js` — the nine categories and their icon lookup. No logic.
- `tools/slice-icons.py` — cuts the icons out of the committed source art. Re-run
  after changing any source image; it is the only place crop boxes live.
- `pages-redirect/` — what the retired GitHub Pages address now serves.
- `src/db/db.js` — IndexedDB wrapper, namespaced per Google account
- `src/sync/googleSync.js` — self-contained Google auth + Drive (no test coverage)
- `worker/` — the Cloudflare token-broker (deployed separately, see below)

**430 tests, all passing** (`npm test`). They cover the pure domain layer and the
Worker's pure helpers only — **not `main.js`, not `googleSync.js`**.

## State right now — READ THIS FIRST

- `main` = **`fb828b0`**, pushed. **Not byte-verified live yet** — Johnny still
  needs Force update now.
- **430 tests pass** (`npm test`). Same coverage as ever: the pure domain layer
  and the Worker's pure helpers. Not `main.js`, not `sound.js`, not
  `googleSync.js`.
- **Worker = build `2026-08-17.12`**, untouched this session.
- **Branch `emblems` is pushed and NOT merged.** It gates Plan and Progress
  behind a tappable emblem (see "Ideas parked on a branch"). Production returns
  404 for `emblem-armour.webp` / `emblem-sword.webp` — confirmed by curl.

## Nothing is wired and silent any more

Every clip `src/sound.js` names now exists in `public/`, checked one by one.
`sfx-add-habit.mp3` — "forge what fate has foreseen, the mortal must become
more" — arrived as audio on 2026-08-18 and needed no code change; the wiring
had been there since the day it was written, swallowing the miss.

**One recording is not used by anything:**
`ElevenLabs_2026-08-18T14_48_15_Viraj…mp3` in `~/Downloads`, 90 KB, still under
its export name. It matches no shipped clip by size. Ask Johnny what it is
before wiring it anywhere.

## Next up

**Immediately, in order:**

1. **Johnny QAs the layout pass on his phone.** He called the 32vh version
   "super ugly"; the reserve is back to **12vh** and a full Today fits on one
   screen again. The sigil now sits behind the top card, showing through its
   0.80 fill. If he wants the sigil clear again, the remaining option is to
   move the PICTURE — but shifting the arena means rescaling `.arena-stage`
   (cover has zero slack at 375x812), and every flame/lava/ring % rides on it.
2. **Decide on `emblems`.** Pushed, not merged. If it lands, Social and Guide
   want their own emblems before it ships.
3. **Still never verified on a real iPhone:** whether Spotify keeps playing
   under the voice lines (ambient), whether the silent switch mutes everything,
   whether the 460ms click is too long on fast keypad taps, and whether any of
   the new arena motion costs frames.

**Raised and not built:**

- **The embers are untouched originals** — `linear` motion, one depth plane,
  uniform colour. Next to the lava and the gate plumes they are now clearly the
  weakest motion on screen. The fix discussed: easing, lateral drift, two depth
  layers.
- **Section labels could go when there is only one section** ("DONE", "HEALTH
  HABIT" above a single group each). Raised, not done — still the noisiest
  thing left on Today.
- **The hard offset shadow (`4px 4px 0`) reads as misregistration** now that
  cards are translucent and sit on a photograph. It is core to night
  brutalist, so it was left alone. Worth a look if the screen still reads
  cheap.
- **A bell notice for everything since the sound release** — the screen change
  went out, but the burning arena, the translucent cards, the retiring tips and
  the layout work have not. **Adding an entry to `src/notices.js` IS what sends
  it; ask Johnny every time.**
- **`sfx1.png` is unused** — a smoke-and-embers plate, sparks are orange so it
  would need the hue rotation. Held back deliberately: it would be a seventh
  layer on a screen already called cluttered. If it lands, it should REPLACE the
  CSS embers rather than join them.
- **`magic.css` (github.com/miniMAC/magic) was asked about and never examined.**
  Nothing was fetched or decided.
- The proof video collage is capped by real-time compositing: a minute-long clip
  costs a minute of building. WebCodecs plus a vendored MP4 muxer is the upgrade
  if it ever bites; there is a `ponytail:` comment naming it.
- Per-exercise folds inside a crew member's "Their progress", if one tap still
  reads as crowded.
- UX ideas brainstormed and not built, in Johnny's order of interest: a "last
  time you did this" line in the logger, a rest timer between sets, a session
  summary when the last card clears, and a year heatmap.
- Crew personalisation: a **handle**, **earned ink**, and a **composed crew
  emblem**. Explicitly parked: a shared wall, a crew streak, anything bought or
  randomised.
- **The QR invite card was designed and never built.** It needs a vendored MIT
  QR encoder in `src/vendor/` — the one dependency the app would carry.
- Badminton (2026-08-10) took the picker to ten, so `.cat-grid` is four across.
  Add an eleventh and check that row again.

## Sound (added 2026-08-17/18)

**Announced 2026-08-18** — `2026-08-18-sound-and-fire` covers the arena, the
fire frame and the whole sound system in one notice, approved by Johnny. The
backlog of unannounced work is now empty.


**Never Web Audio.** That was tried once for the EMOM cues; iOS silenced all
~400 lines of it with the ring switch and the whole system was deleted.
`<audio>` elements only. `src/sound.js` is the entire thing, ~120 lines, no
network at runtime: every clip is a file in the build, so there is no key to
leak, no service to fail and nothing to maintain. **A missing clip is silent,
never an error** — `play()` rejects and the rejection is swallowed.

**Everything is `navigator.audioSession.type = 'ambient'`, music included.**
Ambient MIXES: Spotify, a podcast, whatever is already playing keeps going
underneath and is never paused. `playback` would take the channel and stop it,
and the answer to not wanting our sound is the switch, not a stolen channel.
Two consequences accepted deliberately: **a silenced phone plays nothing**,
because ambient obeys the ring switch; and our music over someone else's plays
both at once. Safari 16.4+ implements this; elsewhere it is a no-op and the old
rude behaviour stands. **Never verified on a real iPhone** — that check is
Johnny's.

**Audio cannot start without a gesture.** The first tap of a session primes
every clip muted, which spends one gesture on all of them. The greeting tries
immediately on arrival and, if the browser refuses, is HELD for the next tap
rather than dropped. Whether a browser will allow autoplay cannot be read off
it; the only honest test is to play and catch the rejection.

**The topbar chip OPENS the sound sheet; it mutes nothing.** One tap could
only ever speak for one of three settings, and the other two sat behind a
scroll at the bottom of Profile — which now carries none of them. `modalSound()`
is the single home. **`Everything` stores nothing**: it reads the three settings
and writes them one at a time, so it is a shortcut for three taps and cannot
outlive them. The chip lights for *is anything on*, derived at render — married
to music alone it would lie the moment it stopped controlling music.

**Three settings, and NO master over them.** A master was tried and it was a
trap: it lived on one button in one build and moved in the next, so a phone was
left holding `sound:false` with nothing on screen saying so — and the music
switch, which read through it, could be tapped forever without lighting or
playing. Each setting now answers only for itself, which also means that stale
`sound:false` is simply ignored. Prefs are device-local (`db.prefs`), never
synced: **Voice lines** (`sfx-greeting`, default on), **Button taps**
(`sfx-click`, default on), **Background music** (`music`, default OFF).

**Voice lines follow two rules, and both were needed.** One voice at a time —
crossing three tabs quickly otherwise leaves three sentences talking over each
other. And no line twice in ten seconds — bouncing back to a tab you just left
otherwise repeats it immediately; measured, three Today/Plan round trips in 1.5s
now speak once. A line waits 190ms after the tap so the click lands first.

| Trigger | Clip |
|---|---|
| App arrives / returns to front | `sfx-greeting` — "The arena awaits, champion" |
| Any `[data-action]` tap | `sfx-click` (460ms of audible sound, longer than ideal) |
| Nav → Plan | `sfx-plan` |
| Plan → Add | `sfx-plan-add` |
| Add → Exercise | `sfx-add-exercise` |
| Add → Health habit | `sfx-add-habit` |
| Nav → Progress, or a Progress card | `sfx-progress` |
| Nav → Social, or a crew card | `sfx-social` |
| Nav → Guide, the ? chip, or the 💡 | `sfx-guide` |
| Music toggle (topbar) | `sfx-music`, 30s loop, mixes |
| Any share button, and the crew invite | `sfx-share` — "Before gods and ancestors prevail" |

**Every share entry point speaks from the one click listener**, matched by
`[data-action^="share"]` plus `open-invite`, not from the eight `case` arms.
Eight per-case calls would be eight copies and would still miss the ninth
someone adds. The ten-second voice cooldown is what stops share-choice →
share-session-only speaking twice; verified in the browser, both fire the clip
and a second tap inside the window does not.

**Music is deliberately NOT precached** (`globIgnores` in `vite.config.js`). It
is 704 KB for a feature that is off by default; it is fetched the first time
someone turns it on. Everything else is precached — 403 KB of speech and taps.

## The look, rebuilt over 2026-08-19

The whole day was one argument: **the arena and the cards were fighting, and
the cards were winning.** What follows is what actually moved the needle, in
the order it was found. Do not re-litigate these by eye — every number was
measured, and eye-tuning is what produced the four wrong versions in between.

### The screen change

`src/fx.js` is one exported function plus a gate. The tab change runs through
`document.startViewTransition()`.

1. **Name only `#view-container`** (`view-transition-name:screen`). Unnamed, the
   API captures the whole page and the topbar and nav animate on every tap —
   reported as "my screen is lagging", and it was not lag, it was the chrome
   moving. `::view-transition-old/new(root)` are pinned to `animation:none`.
2. **Never `skipTransition()`.** Letting a newer tap abort a running one
   rejects promises nobody awaits: 14 fast taps produced **ten unhandled
   `InvalidStateError`s**. A tap arriving mid-animation now gets no transition.
3. **No `scale()`** on a full-screen snapshot — it resamples a display-sized
   texture at 3x. Opacity and a 6px lift only.
4. **The stagger sits out** while a transition runs (`fx.running()` answers "is
   one running NOW", never "could one run", so first paint keeps its entrance).
5. **Reduced motion is refused in fx.js, not CSS** — a snapshot is not an
   element any rule can select.

### The arena burns

Three layers over `.arena-stage`, all transform/opacity, no JS, no network,
governed by `html.idle` and `prefers-reduced-motion` like everything else.

- **Lava** (`.arena-lava`): a seamless molten tile (`lava-tex.webp`) scrolled by
  three sheets at 9s/14s/24s under `lava-mask.webp`, plus a 6.5s surge.
- **Fire** (`.arena-flames`): the app's own 24-frame sheets. Four up the
  standing walls (**15.61%..33.22%**, **67.72%..85.68%**), three falling out of
  the gate arches (**26.88%, 56.81%, 75.23%**) — every number column-profiled
  off the artwork.
- **Sigil** (`.arena-sigil`): its glow cut out of `arena.webp` by channel,
  breathing at 5.5s while a charge runs the ring at 3.4s. Coprime on purpose.

**Five rules that were paid for:**

1. **One gate over every flame** (`flame-mask.webp`). A sprite over the weapon
   rack paints fire onto solid iron — the "ghost flames", reported three times.
2. **No two sprite bands may overlap.** Two screens on one pixel blows out into
   patches that read as cheap.
3. **The lava mask is levelled column by column** — the artwork's right pool is
   3x the left (37.6 vs 11.5), so an ungated flow blazes on one side only.
4. **Contrast, never brightness.** `brightness()` drags toward white, which IS
   the cheap look. Target: zero pixels driven to white.
5. **`tools/fire-sheets.py` crushes each sheet's black floor to zero.** Screen
   blending adds what it is given and `fire-body`'s black sat at RGB(3,2,17) —
   63% of the sheet a dim blue floor that painted a rectangle on dark stone.
   Fixed in the generator; never ship a second "cleaned" copy of a sheet.

**Chasing one number alone backfired once:** tuning the flame gate purely for
low ghosting strangled the effect into a dim wash. Measure ghosting AND
strength together.

### The floor: ring and mark

- **There is no mark on the floor.** It carried the app icon (read as a decal),
  then the wall's own sigil (better, still too busy), and now nothing. The ring
  alone is the quiet version, and the floor is the part of the screen the cards
  sit over.
- **The ring is 115% wide, centred, crest at 76%.** Width is set by CURVATURE at
  the screen edge, not by size: 108% drops 6.2 points from mid-screen to the
  edge and reads as a dome closing early; 190% drops 2.3 and reads as a straight
  band; **115% drops 4.6**, which is the only one that reads as a circle
  continuing past the frame. **Wider is not better. The window is narrow.**
- **The plate `top` is NOT where the ring appears, and the gap scales with the
  width.** Change the width and recompute the top and the ember origin — never
  carry them over. Four wrong placements came from moving one of the three.
- **The ring is screened at 0.5, not alpha at 0.8.** Painted with alpha it
  replaced the stone and lifted that patch of floor from 7.6 to 17.4 — more than
  doubling it — which is exactly why it read as a cheap addition.

### Decluttering, and what actually worked

- **Cards are translucent** (`--surface` and `--bg-card` at `rgba(20,25,23,0.80)`).
  The screen was never cluttered because it holds too much; it was cluttered
  because 44 surfaces painted a solid wall over the picture. **0.80 is a floor,
  not a taste**: at the brightest the scrimmed arena reaches behind a card,
  RGB(146,181,174), it holds body text at 10.3:1 and muted text at 5.1:1 —
  0.74 puts muted text under the 4.5:1 bar. Sheets stay solid (`--bg-elevated`).
- **The scrim came down ~18 points** at every stop. Those stops were tuned
  around loose text that now retires.
- **Tips retire after five app opens**, counted per SESSION (render() runs on
  every state change, so counting renders spends all five in the first minute).
  A phone with five logged days starts retired — asked outright, never as the
  stored value's default, because the first render happens before the log loads.
- **Guide folds by phase.** Every other view ended around 59% of the height;
  Guide ended at 100%. Three rows at rest now, 36.8%.
- **Content starts below the wall sigil** — tried at `padding-top:32vh`, and
  **reverted to 12vh on 2026-08-19** after Johnny called it ugly. The sigil
  occupies 18.6%..41.2%, so clearing it entirely costs 41% of the screen and
  pushes the health habit off the bottom of a Today that used to fit whole.
  **The overlap was never the problem the measurement said it was**: cards
  carry an 0.80 fill, so the sigil reads as showing THROUGH the top card.
  What WAS a problem is loose text — the done row and the tips both landed on
  the gate flames once the content moved up, and both now take the card fill.
- **`All done today` must not render while anything needs proof.** Two
  accent-framed boxes in a row, the second contradicting the first. The guard
  is `!awaiting.length` on that branch in `viewToday`.

### Judged on the wrong screen for hours

Placement was assessed on **Guide**, whose list fills the height and scrolls —
the one view where nothing behind it can ever look uncluttered. Judge layout on
Today and Plan.

## Ideas parked on a branch

**`emblems` (pushed, not merged).** Plan arrives as a flaming sword, Progress as
a suit of armour, both cut in the wall sigil's cracked stone and lit from
inside. Tap to open; leaving the tab closes it again. Today is deliberately
never gated — a door in front of the daily loop is the thing that killed the
tuck. The emblem stands in the ring at 62% of the height; placed high it landed
straight on the wall sigil.

**The tuck was built, shipped and reverted the same day.** A silhouette with an
ember at the heart pulled the whole screen into the fire. It worked — screen
level actions stayed, item-level actions went with the items — and Johnny still
cut it. What it was hiding was better fixed by removing weight.

## The arena (rebuilt 2026-08-17)## The arena (rebuilt 2026-08-17)

The background is a picture of a fire that was not lit, so it was lit. All of it
is CSS over sprite sheets, which means the existing `html.idle` pause and the
`prefers-reduced-motion` resting state govern it for free — **a GIF would have
obeyed neither**, and the three sources weigh 6.9 MB against 654 KB of sheets.

- **Ten flame clusters hang from the ceiling**, `scaleY(-1)` so each sprite's
  base sits behind the opaque topbar and the tips point down. The mask flips
  with the transform, because a mask applies in the element's own space before
  the transform maps it.
- **The floor flames were removed.** Fire at both ends made the screen all edges
  and no middle. What stands there is `floor-ring.webp` (from `sfx2.gif`) with
  the Sets mark inside it.
- **The mark is placed by measurement, not by eye.** The ring's ellipse spans
  x 5–231 and y 46–119 of a 238×120 frame, so its centre is **49.6% across but
  68.75% down** — the light rays take the top third, and centring on the box put
  the mark visibly high. Its squash is **73/226 = 0.323**, the exact factor a
  circle lying on that floor takes. The plate carries the ring's own **238:120**
  aspect, or every one of those numbers drifts when it resizes.
- **One green.** The app had five by accident (artwork 80°, sheets 97° and 129°,
  frame 137°, accent 144°, ring 158°). Everything is rotated onto **156°**, the
  ring's hue. `tools/hue.py` holds the single rotation; only saturated pixels
  move, so the stone stays stone; saturation and value are never touched.
  Measured after: 155.4–157.8 across every asset and the accent token.
- **Encode once.** The arena was a JPEG recoloured from a JPEG, and the recolour
  pass re-encoded every sheet BELOW the quality that made it. Rotation now
  happens during generation. `icon-sources/` keeps un-rotated originals so a
  re-run cannot rotate twice. `arena-source.jpg` is the pre-recolour arena.
- **Contrast belongs in the plate, not the scrim.** The scrim cannot lighten far
  without letting flames fight text, so the picture carries +16% contrast and
  +24% saturation and the scrim gave four points back. The unsharp mask is for
  the upscale: the art is 852 wide and a phone at 3x asks for more.
- **Loose text is the only thing at risk.** Every card has an opaque back. The
  Guide's list and the hint under the topbar both sit in flame bands, and the
  scrim's stops are tuned around exactly those two.

Rebuild art with `python3 tools/fire-sheets.py && python3 tools/greens.py`.
Crop boxes and frame counts live in those files and nowhere else.

## The profile fire frame

`border-image` was the elegant answer — one rectangle fitting any box — and it
**painted perfectly in the dev browser and not at all on the phone**. That is
what made it the wrong tool: a technique that cannot be tested on the device it
must run on. Both avatars are square, so the nine-slice is baked once in
`tools/fire-sheets.py` and what ships is an ordinary picture stretched over a
square box.

Two things are baked into the asset rather than argued with in CSS: the dead
black margin is cropped, or that padding lands inside the photo and the flame
frames nothing; and luminance becomes alpha, so black drops out with no blend
mode — both avatars have `overflow:hidden`, and `mix-blend-mode` inside a
clipped box is a fight with the stacking context nobody wins. Source is
`fireframebackup.jpg`, not `fireframe.png`: the latter's fire is thick relative
to its opening and squared off it ate a third of the box from every edge.

It sits OUTSIDE the picture via a negative inset, which needs `overflow:visible`
— fine here, since `overflow:hidden` was only ever clipping to a rounded corner
and there are none. **Crew faces deliberately do not get it**: their ring
already carries story state and their border carries trained-today, and a third
meaning on one shape is one too many.

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

## The token-broker (added 2026-08-05)

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

**The dev browser pane is permanently `document.hidden`.** Three consequences,
each of which looked like a bug in the app: `html.idle` is always on, so every
arena animation sits paused; `requestAnimationFrame` never runs, so frame timing
and smoothness cannot be measured here at all; and view transitions abort with
`InvalidStateError`. Remove the `idle` class by hand to see motion, and leave
real smoothness to Johnny's phone.

**Trusted clicks time out in that pane.** `computer` clicks by coordinate or ref
hang for 30s; `javascript_tool` with `el.click()` goes through the same listener
and works. What a scripted click cannot prove: it is not a user gesture, so
audio autoplay and `navigator.share` still need a real device.

**The log's db key is `sets-log`, not `setsLog`.** Seeding the wrong one wastes a
round: the write succeeds, the app ignores it, and Today renders as if nothing
was logged. Exercises are `exercises`, timers `timers-log`, proof `proof-log`.

**A percentage `background-position` resolves against (container − image), not
as a plain offset.** With a 14-frame strip at `background-size:1400%`, "-500%"
lands nowhere near frame 5 and the layer goes blank. Step sprite sheets with
`translateX` on an inner element — the shape `.fire-band i` has always used.

**A CSS mask reads the ALPHA channel by default.** A greyscale mask image is
opaque everywhere and masks nothing — it floods the whole element. Put the mask
in the alpha channel rather than relying on `mask-mode:luminance`.

**Removing a glow and compositing it back must be additive.** Multiplying the
base by (1 − alpha) and then painting the glow over it multiplies by (1 − alpha)
twice and leaves the whole band dimmer than the picture ships.

**`main.js` imports from `domain.js` selectively.** `targetMet` was not among
them; calling it threw inside a view-transition callback, where the rejection is
swallowed by design — so state changed, the DOM did not, and it looked like a
dead button. If a render function goes quiet, wrap the transition callback and
surface the throw.

**A story lives in ONE D1 value, capped at 1,000,000 bytes.** That is why a
phone video cannot go to the crew as-is, and why proof reaches them as a
composited copy at 480x854 whose bitrate is computed from the clip's own
length to land inside 640 KB — then MEASURED, because MediaRecorder treats a
bitrate as a hint. Below about 120 kbps the still frame goes instead.
`MAX_STORY_BYTES` is 900 KB and `storyImageOk` accepts `data:video/` too.

**iOS returns a BLACK frame from a video that was seeked but never played.**
That is what made proof arrive in the crew's story as a black rectangle. The
canvas is checked with `isBlankCanvas` and only when it comes back blank is the
clip played for a moment to force a real decode.

**`navigator.share` needs a LIVE user gesture.** An eight-second render outlives
one, so `share()` refuses and the download fallback drops iOS on a file page.
The video card is built first and shared by a second, fresh tap.

**`requestAnimationFrame` stops dead when the page is hidden** — and the share
sheet opening over the app does exactly that. A canvas recording driven by rAF
then holds ONE frame: a valid MP4, right dimensions, 0.03 seconds. Driven by a
timer it keeps going. `playableVideoBlob` takes a minimum duration for the same
reason: `duration > 0` is true of a one-frame file.

**The proof tag is plumbing, not a caption.** `proof:<exercise>` must never
reach the screen; `storyCaptionText` turns it into "Proof · <exercise>".


**A rep total must never be compared against a target that counts sets.** This
one bug class bit FOUR times in one session, in four different files, and each
time it looked like a different bug: `bumpTargetIfPR` silently rewrote a 3-set
target into 6 mid-workout; `sealedToday` sealed the session the moment reps
passed the set count and locked the keypad; the day list read "16 / 3 reps"; and
the share card headline read "14 / 3". Everything that judges completion now
routes through `progressValue(exercise, arr)` in `domain.js` — reps in reps
mode, `arr.length` in sets mode. **If you add another completion test, route it
through that function.** Eleven call sites used to compare `calcTotal()` against
the target directly, and eleven copies of a rule is eleven chances for the
streak, the day list and the share card to disagree about whether you finished.

**Duplicate `case` labels are legal JavaScript and the first one wins.**
`main.js` had a 37-line run of ten cases duplicated inside the same switch, so
the second copy was unreachable. An edit landing there looks perfectly correct
in a diff and does nothing at runtime — it is what made "Save to phone" a dead
button for a whole round. Removed in `a75b60a`; `grep -o "case '[a-z-]*':" |
sort | uniq -d` now returns nothing. Keep it that way.

**A string replace with no assertion is how dead code ships.** Several edits in
this session silently matched nothing and were reported as done. Every scripted
edit to `main.js` must `assert old in s` before replacing. Related: when the
same text appears twice (the `archive`/`restore` run does), anchor on a region
large enough to be unique, or the replace will hit the LIVE copy.

**The dev browser serves a stale bundle constantly.** Four times in one session
a verification reported old behaviour because the service worker had cached the
previous build — twice nearly causing a working feature to be called broken.
Before trusting any in-browser check, unregister the worker and clear caches.

**Proof of workout is two stores, deliberately.** `proofLog` (timestamp + retake
count) SYNCS and is what decides whether a day counted; `proofImages` is local
only, pruned at 48h, and never enters a Drive snapshot. If completion checked
for the *picture*, signing in on a new phone would retroactively un-finish every
day ever done and take the streak with it. There is a test named for exactly
that. Photos in the snapshot would also turn a small backup into an enormous one.

**Proof reaches the crew through the story pipe, not a new endpoint.** It is
captioned `proof:<exercise>` and that tag is never displayed: proof is filtered
OUT of the stories row, the story rings and the unread badge, and surfaced as a
camera button on that member's exercise row. This is why the feature shipped at
all — a new endpoint would have needed a Worker deploy, which only Johnny can do.

**Two 9:16 images cannot be stacked in a 9:16 frame.** The proof collage tried
it: the card could only render at a fraction of the width, and a portrait phone
photo sat pillarboxed in a wide band. The photo is now drawn as the card's
GROUND (full-bleed, cover, under a gradient scrim) by passing `photo` to
`buildSessionImage`. One pass, full size, nothing shrunk.

**An installed app that is never closed keeps running the JS it started with**,
however new the service worker under it is — which is why "Force update now"
existed. `checkVersion()` already ran on every `visibilitychange` back to
visible; `maybeAutoUpdate()` now acts on it and calls `forceUpdate()`. It
refuses while a clock is running or a sheet is open (a reload would throw away
what someone is mid-way through) and fires **once per run**, so a deploy that
reports a build it cannot serve costs one reload rather than a loop. Those cases
fall through to the existing banner.

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
| Proof of workout | An exercise is not finished until it is photographed. Card on Today says "Done — one photo to finish it" with **Keep going** beside **Add proof**. Take a photo or upload one, 3 retakes, explained once. Only applies from `meta.proofSince` (first run of that build) — nothing already done was affected. A camera button on the Done row re-opens it. |
| Target mode | Plan → target → **Reps** or **Sets**. Sets counts sets ("2 sets · 6 reps", "1 SET LEFT"), never a fraction. Both targets are remembered per exercise (`targetByMode`); switching restores the other, and an unset reps target prefills from `bestSessionTotal`. `targetMode` has NO dated history on purpose — the mode is what the number means, and past days were always counted the way they were counted. |
| Category clusters | Three or more exercises sharing a category fold into one row on Today (`clusterByCategory`, threshold 3). Below three, nothing changes — two cards were never the problem. |
| Arena | `public/arena.webp`, plus three live layers over it: flowing lava, seven flame sprites and the breathing wall sigil (see "The arena burns"). The scrim is four stops, lifted ~18 points on 2026-08-19. Content starts below the sigil at 32vh. |
| Effects | Streak flame lights at day one and climbs (`flameLevel`, 0-4). 22 embers. All transform/opacity, no per-frame JS, paused when the app is not visible, with a resting state under `prefers-reduced-motion` (the global 0.001ms rule DELETES a looping animation whose first and last frames are both opacity 0). |
| Tips | Eight inline hints, each keyed. They retire after five app opens (counted per session) and never appear at all on a phone with five logged days. Everything they say is also in the ? sheet and the Guide. |
| What's new | A bell in the topbar, **in the version chip's old slot** — once updates apply themselves, "which build am I on" belongs in Backup & data, not on every screen. Notices are a data file (`src/notices.js`) shipped **inside the build**: the release is the delivery mechanism, so there is no endpoint, no table and no network dependency in the topbar. Read state is per-device (`notices-seen`), never synced, and a fresh install starts with everything read. **Adding an entry is what sends it — never add one without asking Johnny, every time.** |
| Health habits | Plan → Add → Health habit. Listed on Plan; tap to rename, re-schedule or delete. Delete **archives** (`active:false`) — habits carry no tombstone key, so a hard delete would come back from Drive. Today collapses a meals habit to one row; a one-tap habit never collapses, because its row is the action. | Recurring, no target, own streak. Two shapes: **meals** (six slots — breakfast, morning snack, lunch, afternoon snack, dinner, evening snack) and **plain** (one tap a day). Each slot is Kept / Skipped / Broke. A day is **clean** (nothing broke, ≥1 kept), **broken** (anything broke), **neutral** (nothing logged, or all skipped) or **off plan**. Neutral and off-plan days are gaps the streak steps over. Three presets — Keto, No alcohol, Sleep by 11 — which are **copied, never linked**. |
| Weigh-in | Daily weigh-in, weekly-average line chart. Never touches any exercise streak. Deliberately not a "health habit": it stores a number BMI and the chart read. |
| Guide | Folded by phase — three rows at rest, open one for its steps, open a step for its notes. **Two guides, deliberately.** The Guide tab (book icon, 4th slot) is the full 12-step walkthrough, collapsed on arrival, content as data in `src/guide.js`. The topbar **?** opens a short sheet about the screen you are standing on (`modalGuide`). The Guide screen carries no ? of its own. They were merged once and it was worse — the user asked for both back. |
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

- **A control that gates another control is a trap.** The sound master lived on
  one button in one build and moved in the next; a phone kept `sound:false` with
  nothing on screen saying so, and the music switch read through a dead control
  forever. It looked like a broken button and was a design fault. Prefer
  independent settings.
- **`getComputedStyle` lies in a hidden browser pane.** It reported on and off
  states as identical, and reported identity transforms for a running animation,
  because a hidden page defers style recalc. Even an inline `!important` read
  back unchanged. **Screenshots force a paint and tell the truth.** Two separate
  sessions of debugging were spent before this was understood.
- **Grep can invent a bug.** A regex starting mid-selector cut `html.idle ` off
  the front of a rule and produced a confident, wrong claim that the minifier
  had mangled it. Match whole rules, or read the file.
- **Later rule, same specificity, wins.** A narrow-screen `font-size` override
  was placed BEFORE the rule it needed to beat and silently never applied
  through two attempts at the same fix.
- **Measure the gap before closing it.** "A bit too high" cost two overshoots in
  opposite directions on the flame height. Probing `elementFromPoint` across all
  five views found the only empty strip for a floating control in one pass.
- **Verify the format before trusting it.** The proof video's collage was capped
  at 8s by a constant, and `MediaRecorder` driven by `requestAnimationFrame`
  produced a valid one-frame MP4 when the page was hidden. Validate the artifact
  you produced, not the capability you asked about.

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

## Working with agents

Johnny asked for parallel agents once and it worked, with one rule that matters:
**two agents editing `main.js` at the same time will conflict.** The declutter
agent was given an explicit list of functions NOT to touch, told to
`git pull --rebase` before committing, and it landed cleanly. Give any agent a
region, not a file.

## Things only the user can do

- Anything needing their Google account, including confirming sync survives an hour.
- Google Cloud Console changes; Cloudflare Worker changes.
- **Force update now** on the phone after each deploy.
