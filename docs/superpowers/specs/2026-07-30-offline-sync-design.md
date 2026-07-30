# Batch D — offline-first sync that cannot lose a workout

Date: 2026-07-30

Pulled ahead of Batches B and C at the user's request, because it is the only
item in the seven that can destroy data you actually recorded.

## The bug

Sync is whole-file last-write-wins. `pullAndMerge` compares one number —
`meta.updatedAt` — and then keeps one side **entirely**, discarding the other:

```
if (remote.updatedAt > local.updatedAt)  applyRemoteSnapshot(remote)   // local work gone
else if (remote.updatedAt < local.updatedAt) pushToDrive()             // remote work gone
```

`applyRemoteSnapshot` then overwrites `exercises`, `setsLog`, `timersLog`,
`profile` and `streakOverrides` outright. So: train offline on your phone, and
if any other copy of the app writes anything afterwards, your session is
replaced by that copy's view of the world the next time the phone syncs. Nothing
warns you and nothing can recover it.

Second gap: a push that fails because you were offline is never retried.
`scheduleSyncPush` fires once on a 2.5s debounce, and there is no `online`
listener anywhere in the app. The work sits on the device until some later
unrelated edit happens to trigger another push.

Third, smaller: returning to the app while offline runs `pullAndMerge`
unconditionally, so being offline is reported as *"Could not reach Google
Drive"* — an error, when it is a perfectly normal state for an offline-first app.

## What "cannot lose a workout" means here

The merge is a **union**, not a choice. Anything present on only one side is
kept. That single property is what fixes the real bug, because the damaging case
is always "these reps exist in exactly one place".

For genuine conflicts — both sides hold sets for the *same* day and the *same*
exercise, with different contents — one side has to win, and the winner is the
snapshot with the newer `updatedAt`.

### Why not per-day timestamps

The precise alternative is to stamp every `(date, exercise)` on write and let
the newer stamp win per cell. Rejected, deliberately:

- It needs a new stored field and a `touch(date, exId)` call at every mutation
  site. Miss one and that cell silently resolves the wrong way — a data bug that
  is invisible until it costs someone a session.
- It is unverifiable here. The Drive round-trip cannot be exercised without the
  user's Google account, so the parts I cannot test should be as small and as
  obvious as possible.
- The conflict it improves on is rare in this app's real use: one phone, plus a
  browser that is almost always only a reader. The common loss is offline work
  on distinct days, which plain union already fixes completely.

Snapshot-level recency for conflicts is one number that already exists,
maintained at one choke point (`markDirty`), and it honours corrections: if you
fix a total on your phone, your phone is the most recently written copy, so its
version of that day wins.

**Accepted limitation, stated rather than hidden:** if two devices both edit the
same exercise on the same day while offline, the device that wrote later
anywhere wins that day's sets. The other device's version of *that day* is
replaced — but every other day from both devices survives, which is the whole
difference from today's behaviour.

**Second accepted limitation:** union has no tombstones, so an exercise deleted
on one device is restored by a sync with a device that still has it. Deleting
again is cheap; losing an exercise's history is not.

## Design

### 1. A pure merge

```js
mergeSyncSnapshots(local, remote) -> merged
```

in `domain.js`, pure, with no knowledge of Drive or state. Rules:

- `updatedAt` — `max` of both, so the merged snapshot is never older than what
  produced it.
- **Conflict winner** — the side with the greater `updatedAt`; local wins ties,
  since preferring the device in your hand is the less surprising default.
- `setsLog`, `timersLog`, `streakOverrides` — union of every `(date, key)`; the
  winner supplies any key both sides hold.
- `exercises` — union by `id`, keeping the winner's ordering and appending ids it
  does not have.
- `profile` — the winner's, unless the winner's is empty and the other's is not,
  so a device that never set a username cannot blank one that did.

Required properties, each a test: **idempotent** (merging a merged snapshot with
either input changes nothing) and **key-complete under commutation** (merging in
either order yields the same set of days and exercises). Together those are what
make repeated syncs across devices converge instead of oscillating.

### 2. Sync always merges, then pushes

`pullAndMerge` becomes: download → merge → apply locally → push the merged
result. Both sides therefore converge on the union, and the push is no longer
conditional on who was newer. Pushing what we just merged is what stops the
other device from re-introducing the same conflict on its next pull.

### 3. Offline is a state, not a failure

- Every network path checks `navigator.onLine` first, and when offline records
  the intent instead of attempting it.
- A `sync-pending` flag is persisted in IndexedDB, so work queued while offline
  survives closing the app.
- An `online` listener flushes the queue: if pending and there is an account,
  run the merge-and-push cycle.
- `visibilitychange` no longer syncs while offline.
- New status `pending`, shown as *waiting for connection*, distinct from
  `error` (Drive genuinely unreachable) and `reconnect` (Google needs consent
  again). Only one of the three is the user's problem to act on.

## Testing

Unit tests in `tests/domain.test.js` covering: the exact data-loss scenario
(local-only day survives a newer remote); union across distinct days and
distinct exercises within a shared day; conflict resolution both directions;
exercise union and ordering; profile not blanked by an empty newer side; missing
or empty remote; idempotence; key-completeness under commutation.

Browser verification at 375px, without reloading between checks: log while
offline and confirm the status reads as waiting rather than error, then restore
connectivity and confirm the queue flushes. `navigator.onLine` and the
`online` event are both drivable from the page, so the queue and status
transitions are genuinely exercisable.

**Not verifiable here, and must be reported as such:** the Drive round-trip
itself, and therefore true two-device convergence. That needs the user's Google
login. The merge is pure precisely so that the untestable part is reduced to
"does upload/download work", which has always been the outstanding unknown in
this project.
