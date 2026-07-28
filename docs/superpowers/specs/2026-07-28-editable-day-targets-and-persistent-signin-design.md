# Editable past-day targets + persistent Google sign-in

Date: 2026-07-28

## Problem

Two independent gaps, both reported from the Progress screen.

1. **Past targets are frozen.** A day's expanded detail shows `105 / 200 reps` as static text.
   If the target for that day was wrong, there is no way to correct it, so the day is stuck at
   `0/1` and the streak stays broken. The only target editor is on the Plan screen, and it only
   writes today's target.
2. **Sign-in does not survive a refresh.** Reloading the app or the URL shows the signed-out
   avatar even though the person never signed out.

## Constraints

- 100% free: no backend, no paid service, no new runtime dependencies.
- 100% functional: the app must keep working fully offline and when Google is unreachable.
- Existing data shapes must keep round-tripping through Drive sync and JSON backup/restore.

---

## Feature 1 — Inline target editing on past days

### Data model

No new shape. Targets already live in `exercise.targetHistory` as
`[{ effectiveDate, target }]`, and `getEffectiveTarget(exercise, dateStr)` resolves the latest
entry on-or-before a date (`domain/domain.js`). An entry written at a past date therefore
carries forward to every later day by default.

The decision: **an edit applies to that day only.** Later days keep whatever they resolved to
before the edit.

### `setTargetForDay(exercise, dateStr, newTarget)`

New pure function in `domain/domain.js`. Returns a new exercise, or the same reference when
nothing changes (mirroring `bumpTargetIfPR`, so callers can cheaply detect a no-op).

Algorithm:

1. `nextDay = addDays(dateStr, 1)`; record `carriedTarget = getEffectiveTarget(exercise, nextDay)`
   — what the following day resolves to *before* the edit.
2. Upsert `{ effectiveDate: dateStr, target: newTarget }` into a copy of `targetHistory`
   (replace an existing entry at that exact date, otherwise append).
3. If, against the updated history, `getEffectiveTarget(updated, nextDay) !== carriedTarget`,
   upsert `{ effectiveDate: nextDay, target: carriedTarget }` to restore the original forward
   value.

`newTarget` is normalized: a value `<= 0`, `null`, `NaN`, or empty becomes `null` (untargeted).
An untargeted day contributes nothing to `targetedCount`, so it becomes streak-neutral rather
than a failure — consistent with how untargeted exercises already behave.

Because today's row is read-only (below), `dateStr < today` always holds, so `nextDay <= today`
and the restore entry is never written into the future.

### Interaction with existing behaviour

- `calcDayStats`, `calcStreakInfo`, and `calcWeeklyCompletion` read targets exclusively through
  `getEffectiveTarget`, so they pick up the edit with no changes.
- `bumpTargetIfPR` only ever writes at today's date, so it cannot collide with a past-day edit.
- History entries stay sorted-on-read by `getEffectiveTarget`, so append order does not matter.

### UI

In the expanded day detail of `viewProgress` (`main.js`), the target portion of
`105 / 200 reps` becomes a button (`data-action="edit-day-target"`, carrying `data-id` and
`data-date`). An exercise with no target that day renders a dim `—` with the same affordance,
so a target can be added.

When `state.editingDayTarget === "<date>|<exId>"`, that row renders a numeric input plus
save/cancel mini-buttons, reusing the inline-edit pattern already established by
`save-target-inline` (Plan) and `save-today-total-inline` (Today). Enter saves, Escape cancels,
handled by extending the existing global `keydown` block.

New state field: `state.editingDayTarget = null`.

### Handler and recount

`setDayTargetHandler(exId, dateStr, rawValue)` parses the input, applies `setTargetForDay`,
writes the exercise list via the existing `persistExercises()` (which marks dirty and schedules
the Drive push), clears the editing state, and re-renders.

No explicit recount step is needed: `viewProgress` recomputes current streak, longest streak,
weekly percentage, the day dot class, and the `n/m` fraction from state on every render. Saving
a target of 100 against a logged 105 turns that row into `1/1` with a green dot and extends the
streak as a direct consequence of re-rendering.

A toast confirms the change and notes when the day has newly started counting.

### Out of scope

Today's row stays read-only on Progress; today's target is edited on the Plan screen as it is
now. This avoids two competing editors for the same value and keeps the day-scoped restore
entry from ever targeting a future date.

---

## Feature 2 — Persistent Google sign-in

### Root cause

`index.html` loads Google Identity Services with `async defer`. `init()` in `main.js` calls
`tryResumeSync()` immediately, which calls `trySilentSignIn()`, which checks `gisReady()` —
and `window.google` does not exist yet. The function resolves `false` and is never retried, so
every page load presents as signed out. Separately, the access token expires after roughly one
hour with no renewal path, so sync also stops working part-way through a long session.

The remembered account (`sync-account`) is already persisted in IndexedDB and survives refresh;
only the token handshake is broken.

### Changes in `sync/googleSync.js`

- **`whenGisReady()`** — a promise that resolves once `window.google.accounts.oauth2` exists,
  bounded by a ~10s timeout, resolving `false` if the script is blocked or the device is
  offline. `trySilentSignIn` awaits it instead of failing instantly.
- **`ensureFreshToken()`** — re-runs silent auth when there is no token or the current one
  expires within 5 minutes. Called before every Drive read and write.
- **401 retry** — `driveFetch` retries a request once after `ensureFreshToken()` succeeds,
  instead of surfacing a hard `token-expired` error.

The access token is deliberately **not** persisted. It is a bearer credential; silent re-auth
is cheap and leaves nothing sensitive at rest.

A real OAuth refresh token would require a server-side client secret, which the zero-cost
constraint rules out. Silent re-auth via `prompt: 'none'` is the free equivalent and holds for
as long as the person is signed into Google in that browser.

### Changes in `main.js`

- `state.sync.status` gains a `'reconnect'` value.
- `tryResumeSync` sets a signed-in status on success. On failure *with* a remembered account it
  sets `status: 'reconnect'` and keeps `email` populated.
- The topbar avatar derives its signed-in look from `state.sync.email` rather than a live token
  check, so the account renders immediately on load rather than flickering to signed-out while
  the handshake runs.
- The profile sheet shows a "Reconnect to sync" action in the `reconnect` state, which calls
  the existing interactive `googleSignInHandler`.
- Sign-out continues to clear `sync-account`, so it does not auto-resume.

### Failure behaviour

Silent re-auth depends on the browser's Google session and can legitimately fail — signed out
of Google everywhere, or third-party cookies blocked (Safari, Firefox strict mode). In every
such case the app stays fully usable on local data, keeps displaying the account, and offers a
one-tap reconnect. It never presents as having forgotten the person.

---

## Testing

`vitest` covers the domain layer only (`tests/domain.test.js`), which is where the risk in
Feature 1 lives. New tests for `setTargetForDay`:

- edits the named day and leaves later days untouched;
- writes the restore entry only when the forward value would otherwise change;
- replaces rather than duplicates an entry when the same day is edited twice;
- clearing a target makes the day untargeted and streak-neutral;
- adding a target to a day that previously had none;
- returns the same reference when the value is unchanged;
- `calcDayStats` flips a day to complete, and `calcStreakInfo` extends, after a lowering edit.

Feature 2 is browser- and network-bound (async script load, popup, token expiry) and is not
unit-testable without a Google session; it is verified by running the app and reloading.
