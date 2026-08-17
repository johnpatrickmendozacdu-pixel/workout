# Video Proof of Workout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proof of workout accepts a video — recorded through Sets or uploaded — that shares and saves both raw and as the existing collage card, and disappears after 24 hours or when its exercise is deleted.

**Architecture:** The domain layer is untouched: `recordProof`/`retakesLeft`/`proofFor` store a timestamp and a counter and never look at the media. A video is stored as a Blob under its own IndexedDB key and read only on demand; a still frame grabbed at 0.5s goes into the existing `proofImages` store, which keeps every current surface (Done row, crew story, still collage) working unchanged. The video collage draws the card once to a transparent canvas, then composites video-frame + card per frame through `canvas.captureStream()` into a `MediaRecorder`, and validates the file it actually produced rather than asking the browser what it can do.

**Tech Stack:** Vanilla JS, Vite, Vitest. No new dependencies. No Worker or D1 change.

## Global Constraints

- **No new runtime dependency.** ffmpeg.wasm, WebCodecs muxers and `html2canvas` are all refused. If a step seems to need one, stop and ask.
- **No Worker deploy, no D1 schema change, no new endpoint.** Only Johnny can deploy the Worker. The crew receives a still image through the existing `proof:<exercise>` story pipe.
- **`proofVideos` must never enter `SNAPSHOT_DATA_KEYS`** in `src/domain/domain.js:1104`. Media is local and disposable; only `proofLog` syncs.
- **`proofLog` is never deleted by expiry.** Only by exercise deletion. If expiry reached it, every past day would un-finish and take the streak with it.
- **A rep total is never compared against a target that counts sets.** Every completion test routes through `progressValue(exercise, arr)`. This plan adds no new completion test, and must not.
- **Every scripted edit to `src/main.js` asserts the old string is present before replacing.** A silent no-match is how dead code ships here.
- `npm test` must pass at the end of every task. It is 420 tests before this plan starts.
- Exact values: `PROOF_VIDEO_MAX_SEC = 15`, `PROOF_VIDEO_MAX_BYTES = 60 * 1024 * 1024`, `PROOF_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000`, `COLLAGE_MAX_MS = 8000`, `SHARE_W = 1080`, `SHARE_H = 1920`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/domain/domain.js` | Pure proof rules. Gains the media-lifetime and purge helpers. | Modify |
| `src/db/db.js` | IndexedDB wrapper. Gains `removeItem`. | Modify |
| `src/main.js` | All rendering, events, canvas work, storage wiring. | Modify |
| `src/notices.js` | The bell's contents, as data. | Modify (Task 7) |
| `tests/domain.test.js` | Pure-layer tests. | Modify |
| `tests/db.test.js` | Storage-wrapper tests. | Modify |

No new files. `main.js` is already large and has no coverage, but splitting it is out of scope for this work and would collide with the "give an agent a region, not a file" rule.

---

### Task 1: Pure media-lifetime helpers

The 24-hour rule and the exercise purge, as pure functions, so they are testable without a browser. Nothing calls them yet.

**Files:**
- Modify: `src/domain/domain.js` (append after `recordProof`, which ends at line 270)
- Test: `tests/domain.test.js`

**Interfaces:**
- Consumes: `proofFor(proofLog, dateStr, exId)`, already exported.
- Produces:
  - `PROOF_MEDIA_MAX_AGE_MS: number`
  - `proofMediaLive(proofLog, dateStr, exId, nowMs) -> boolean`
  - `expiredProofMedia(byDay, proofLog, nowMs) -> Array<{date: string, exId: string}>`
  - `dropFromByDay(byDay, entries) -> object`
  - `purgeExerciseFromByDay(byDay, exId) -> object`

`byDay` is any `{ [dateStr]: { [exId]: value } }` map. The same four helpers serve `proofImages`, the video index and `proofLog`, which is why they are written once against that shape instead of three times against three stores.

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain.test.js`:

```js
describe('proof media lifetime', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const log = {
    '2026-08-17': { ex1: { at: 1000000, retakes: 0 }, ex2: { at: 1000000, retakes: 0 } },
    '2026-08-16': { ex1: { at: 1000000 - 2 * DAY, retakes: 0 } },
  };

  it('keeps media younger than 24 hours', () => {
    expect(proofMediaLive(log, '2026-08-17', 'ex1', 1000000 + 1000)).toBe(true);
  });

  it('expires media older than 24 hours', () => {
    expect(proofMediaLive(log, '2026-08-17', 'ex1', 1000000 + DAY + 1)).toBe(false);
  });

  it('treats media with no proof record as expired', () => {
    expect(proofMediaLive(log, '2026-08-17', 'nope', 1000000)).toBe(false);
  });

  it('lists every expired entry as date and exercise', () => {
    const byDay = { '2026-08-17': { ex1: 'a', ex2: 'b' }, '2026-08-16': { ex1: 'c' } };
    expect(expiredProofMedia(byDay, log, 1000000 + 1000)).toEqual([
      { date: '2026-08-16', exId: 'ex1' },
    ]);
  });

  it('drops listed entries and removes days left empty', () => {
    const byDay = { '2026-08-17': { ex1: 'a', ex2: 'b' }, '2026-08-16': { ex1: 'c' } };
    const next = dropFromByDay(byDay, [{ date: '2026-08-16', exId: 'ex1' }, { date: '2026-08-17', exId: 'ex1' }]);
    expect(next).toEqual({ '2026-08-17': { ex2: 'b' } });
    expect(byDay['2026-08-16']).toBeTruthy();
  });

  it('purges one exercise from every day and drops days left empty', () => {
    const byDay = { '2026-08-17': { ex1: 'a', ex2: 'b' }, '2026-08-16': { ex1: 'c' } };
    expect(purgeExerciseFromByDay(byDay, 'ex1')).toEqual({ '2026-08-17': { ex2: 'b' } });
  });

  it('returns the same object when a purge changes nothing', () => {
    const byDay = { '2026-08-17': { ex2: 'b' } };
    expect(purgeExerciseFromByDay(byDay, 'ex1')).toBe(byDay);
  });
});
```

Add `proofMediaLive`, `expiredProofMedia`, `dropFromByDay` and `purgeExerciseFromByDay` to the existing import block at the top of `tests/domain.test.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/domain.test.js -t "proof media lifetime"`
Expected: FAIL — `proofMediaLive is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/domain.js` immediately after `recordProof`:

```js
/**
 * A proof picture or clip lives for 24 hours from the moment it was taken.
 *
 * The age is read from the proof RECORD, never from the file, because the
 * record is the only thing with a timestamp on it. Media whose record has
 * gone is expired by definition: there is nothing left that says it was ever
 * earned.
 *
 * This governs the MEDIA only. proofLog itself is never expired — if it were,
 * every past day would silently un-finish and take the streak with it.
 */
export const PROOF_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function proofMediaLive(proofLog, dateStr, exId, nowMs) {
  const rec = proofFor(proofLog, dateStr, exId);
  if (!rec || typeof rec.at !== 'number') return false;
  return nowMs - rec.at < PROOF_MEDIA_MAX_AGE_MS;
}

/** Every entry in a by-day media map that has outlived its record. */
export function expiredProofMedia(byDay, proofLog, nowMs) {
  const out = [];
  for (const date of Object.keys(byDay || {})) {
    for (const exId of Object.keys(byDay[date] || {})) {
      if (!proofMediaLive(proofLog, date, exId, nowMs)) out.push({ date, exId });
    }
  }
  return out;
}

/** Removes the listed entries, dropping any day left empty. Never mutates. */
export function dropFromByDay(byDay, entries) {
  if (!entries || !entries.length) return byDay || {};
  const next = { ...(byDay || {}) };
  for (const { date, exId } of entries) {
    if (!next[date]) continue;
    const day = { ...next[date] };
    delete day[exId];
    if (Object.keys(day).length) next[date] = day; else delete next[date];
  }
  return next;
}

/** The same, for every day at once — what deleting an exercise needs. */
export function purgeExerciseFromByDay(byDay, exId) {
  const entries = Object.keys(byDay || {})
    .filter((date) => byDay[date] && Object.prototype.hasOwnProperty.call(byDay[date], exId))
    .map((date) => ({ date, exId }));
  return entries.length ? dropFromByDay(byDay, entries) : (byDay || {});
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/domain.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — 427 tests.

- [ ] **Step 6: Commit**

```bash
git add src/domain/domain.js tests/domain.test.js
git commit -m "Give proof media a 24-hour life and a purge, as pure rules"
```

---

### Task 2: `removeItem` in the storage wrapper

A blob stored under its own key needs a way to delete that key. Four lines, mirroring `setItem`.

**Files:**
- Modify: `src/db/db.js` (after `setItem`, which ends at line 84)
- Test: `tests/db.test.js`

**Interfaces:**
- Produces: `removeItem(key) -> Promise<true>`. Namespaced through the existing `scoped()`, exactly as `getItem` and `setItem` are.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` in `tests/db.test.js`:

```js
it('removes a stored key', async () => {
  await db.setItem('gone-soon', { a: 1 });
  expect(await db.getItem('gone-soon')).toEqual({ a: 1 });
  await db.removeItem('gone-soon');
  expect(await db.getItem('gone-soon')).toBeUndefined();
});

it('resolves rather than throwing when the key was never there', async () => {
  await expect(db.removeItem('never-existed')).resolves.toBe(true);
});
```

If `tests/db.test.js` imports named exports rather than a `db` namespace, follow whatever that file already does — do not change its import style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db.test.js`
Expected: FAIL — `removeItem is not a function`.

- [ ] **Step 3: Write the implementation**

Insert into `src/db/db.js` directly after the closing brace of `setItem`:

```js
export async function removeItem(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(scoped(key));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/db.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/db.js tests/db.test.js
git commit -m "Let the store delete a key, which per-clip video needs"
```

---

### Task 3: The video store — index, per-key blobs, prune, purge

Storage and lifecycle, wired in and observable, before any UI can reach it. Photos move onto the same 24-hour rule in this task, because one cutoff for both stores is the point.

**Files:**
- Modify: `src/main.js` — the import block (lines 26-36 region), `state` (line ~103), the load block (lines 208-248), `persistProof` (line 364), `deleteExerciseHandler` (line 1017)

**Interfaces:**
- Consumes: `proofMediaLive`, `expiredProofMedia`, `dropFromByDay`, `purgeExerciseFromByDay` (Task 1); `db.removeItem` (Task 2).
- Produces:
  - `state.proofVideos` — the index only: `{ [dateStr]: { [exId]: true } }`
  - `videoKey(dateStr, exId) -> string`
  - `saveProofVideo(dateStr, exId, blob) -> Promise<void>`
  - `loadProofVideo(dateStr, exId) -> Promise<Blob|null>`
  - `hasProofVideo(dateStr, exId) -> boolean`

- [ ] **Step 1: Add the imports**

In `src/main.js`, the domain import block already pulls `PROOF_MAX_RETAKES` (line 26). Add to that same block:

```js
  proofMediaLive,
  expiredProofMedia,
  dropFromByDay,
  purgeExerciseFromByDay,
```

- [ ] **Step 2: Add the index to state**

`state` declares `proofImages: {}` at line 105. Add directly beneath it:

```js
  // The INDEX only — { date: { exId: true } }. The clips live under one key
  // each (see videoKey) so a save writes one blob instead of rewriting every
  // blob, and so startup reads none of them.
  proofVideos: {},
```

- [ ] **Step 3: Load the index and prune both stores on 24 hours**

Replace this block (currently lines 241-248):

```js
  // Pictures are the artifact, not the record: two days is long enough to look
  // back at one, and keeping them longer would fill the phone for nothing.
  const proofCutoff = addDays(todayISO(), -2);
  let prunedProof = false;
  for (const d in state.proofImages) {
    if (d < proofCutoff) { delete state.proofImages[d]; prunedProof = true; }
  }
  if (prunedProof) db.setItem('proof-images', state.proofImages).catch(() => {});
```

with:

```js
  // Pictures and clips are the artifact, not the record: 24 hours from the
  // moment it was taken, then it is gone unless it was saved to the phone —
  // where no prune of ours can reach it. The RECORD survives; only the file
  // goes. Read the note on PROOF_MEDIA_MAX_AGE_MS in domain.js.
  await pruneProofMedia();
```

Then add, next to `persistProof` (line 364):

```js
function videoKey(dateStr, exId) { return `proof-video:${dateStr}:${exId}`; }

function hasProofVideo(dateStr, exId) {
  return !!((state.proofVideos[dateStr] || {})[exId]);
}

async function saveProofVideo(dateStr, exId, blob) {
  await db.setItem(videoKey(dateStr, exId), blob);
  state.proofVideos = { ...state.proofVideos,
    [dateStr]: { ...(state.proofVideos[dateStr] || {}), [exId]: true } };
  await db.setItem('proof-videos', state.proofVideos);
}

/** On demand, never at startup: a clip is tens of megabytes and the app opens
 *  on Today, which shows the still frame. */
async function loadProofVideo(dateStr, exId) {
  if (!hasProofVideo(dateStr, exId)) return null;
  if (!proofMediaLive(state.proofLog, dateStr, exId, Date.now())) return null;
  try {
    const blob = await db.getItem(videoKey(dateStr, exId));
    return blob || null;
  } catch (e) { return null; }
}

/**
 * Both stores, one cutoff. The video half deletes each blob KEY before it
 * shrinks the index — an index entry dropped while its key survives is a leak
 * no later startup can ever find again.
 */
async function pruneProofMedia() {
  const now = Date.now();
  const goneImages = expiredProofMedia(state.proofImages, state.proofLog, now);
  if (goneImages.length) {
    state.proofImages = dropFromByDay(state.proofImages, goneImages);
    db.setItem('proof-images', state.proofImages).catch(() => {});
  }
  const goneVideos = expiredProofMedia(state.proofVideos, state.proofLog, now);
  if (goneVideos.length) {
    for (const { date, exId } of goneVideos) {
      await db.removeItem(videoKey(date, exId)).catch(() => {});
    }
    state.proofVideos = dropFromByDay(state.proofVideos, goneVideos);
    db.setItem('proof-videos', state.proofVideos).catch(() => {});
  }
}
```

- [ ] **Step 4: Read the index at load**

The load block destructures twelve stores from one `Promise.all` at line 208, ending `proofLog, proofImages`. Add `proof-videos` to the `Promise.all` list in the same position it appears in the destructure, then beside `state.proofImages = proofImages || {};` (line 234) add:

```js
  state.proofVideos = proofVideos || {};
```

Match the existing style exactly: the array of `db.getItem('...')` calls and the destructured names are positional, so an entry added to one must be added to the other at the same index. Getting this wrong assigns the wrong store to the wrong name and is not caught by any test.

- [ ] **Step 5: Purge media when an exercise is deleted**

Replace the body of `deleteExerciseHandler` (line 1017). Assert the old text is present before replacing:

```js
async function deleteExerciseHandler(id) {
  state.exercises = removeExercisePure(state.exercises, id);
  state.setsLog = purgeExerciseSetsPure(state.setsLog, id);
  // The plan going takes its proof with it — record, picture and clip. Blob
  // keys go first, for the same reason the prune does them first.
  for (const date of Object.keys(state.proofVideos)) {
    if ((state.proofVideos[date] || {})[id]) {
      await db.removeItem(videoKey(date, id)).catch(() => {});
    }
  }
  state.proofVideos = purgeExerciseFromByDay(state.proofVideos, id);
  state.proofImages = purgeExerciseFromByDay(state.proofImages, id);
  state.proofLog = purgeExerciseFromByDay(state.proofLog, id);
  // Tombstone the id so sync cannot resurrect it from the copy still in Drive.
  state.deletedExercises = { ...state.deletedExercises, [id]: Date.now() };
  await Promise.all([
    persistExercises(),
    persistSets(),
    persistProof(),
    db.setItem('proof-videos', state.proofVideos),
    db.setItem('deleted-exercises', state.deletedExercises),
  ]);
  closeModal();
  rerender();
}
```

`persistProof` already writes `proof-log` and `proof-images` and calls `markDirty()`, so the purged `proofLog` reaches Drive on the next sync. That is correct: the exercise is tombstoned, so its proof record has nothing left to prove.

- [ ] **Step 6: Verify nothing regressed**

Run: `npm test`
Expected: PASS — 427 tests.

Run: `npm run build`
Expected: build succeeds with no warnings about unresolved imports.

Then open the app (`npm run dev`), and **before trusting anything you see, unregister the service worker and clear caches** — a stale bundle has made four verifications lie in this repo. Take a photo proof, confirm it still appears on the Done row, delete that exercise from Plan, and confirm the proof sheet no longer offers it.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "Store clips one key each, expire media at 24h, purge on delete"
```

---

### Task 4: Capture a video as proof

The two inputs, the gate, the poster frame, and the proof sheet playing it back.

**Files:**
- Modify: `src/main.js` — `modalProof` (line 4407), the input wiring (`onProofPicked`, line 5571), the `save-proof` case (line 5687)

**Interfaces:**
- Consumes: `saveProofVideo`, `hasProofVideo`, `loadProofVideo` (Task 3); `fileToStoryDataUrl` (line 5503, existing); `recordProof`, `retakesLeft` (domain, existing).
- Produces:
  - `PROOF_VIDEO_MAX_SEC = 15`, `PROOF_VIDEO_MAX_BYTES = 62914560`
  - `readVideoFile(file) -> Promise<{blob: Blob, poster: string}>` — rejects with `Error('too-long')`, `Error('too-big')` or `Error('decode-failed')`
  - `state.modal.video` — a `{blob, poster}` awaiting confirmation, the video twin of the existing `state.modal.image`

- [ ] **Step 1: Add the constants and the reader**

Insert directly after `fileToStoryDataUrl` (which ends at line 5521):

```js
const PROOF_VIDEO_MAX_SEC = 15;
const PROOF_VIDEO_MAX_BYTES = 60 * 1024 * 1024;

/**
 * A clip, checked and given a still frame, or a refusal saying which rule it
 * broke.
 *
 * The size cap is not tidiness. The clip is stored as it arrived — trimming or
 * shrinking it would mean re-encoding, which means a multi-megabyte encoder
 * this app does not carry — so the cap is the only thing between a phone
 * shooting 4K and an IndexedDB store nobody can clear.
 *
 * The poster frame at 0.5s is what makes everything else work untouched: the
 * Done row, the crew story and the still collage all read proofImages and
 * neither know nor care that the proof moves.
 */
function readVideoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('video/')) { reject(new Error('not-a-video')); return; }
    if (file.size > PROOF_VIDEO_MAX_BYTES) { reject(new Error('too-big')); return; }
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'metadata';
    const fail = (why) => { URL.revokeObjectURL(url); reject(new Error(why)); };
    v.onerror = () => fail('decode-failed');
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) { fail('decode-failed'); return; }
      if (v.duration > PROOF_VIDEO_MAX_SEC + 0.5) { fail('too-long'); return; }
      // Half a second in: frame zero of a phone clip is very often the lens
      // still opening up.
      v.onseeked = () => {
        try {
          const side = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(v.videoWidth * side);
          c.height = Math.round(v.videoHeight * side);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          const poster = c.toDataURL('image/jpeg', 0.68);
          URL.revokeObjectURL(url);
          resolve({ blob: file, poster });
        } catch (e) { fail('decode-failed'); }
      };
      v.currentTime = Math.min(0.5, v.duration / 2);
    };
    v.src = url;
  });
}
```

- [ ] **Step 2: Add the two inputs and the two buttons to the proof sheet**

In `modalProof`, assert and replace this exact run (lines 4439-4443):

```js
      <input type="file" id="proof-file" accept="image/*" capture="environment" style="display:none">
      <input type="file" id="proof-file-lib" accept="image/*" style="display:none">
      ${(!rec || left > 0) ? `
        <button class="primary-btn wide" data-action="pick-proof">${rec ? 'Retake' : 'Take the photo'}</button>
        <button class="secondary-btn wide" data-action="pick-proof-lib">Upload a photo</button>` : ''}
```

with:

```js
      <input type="file" id="proof-file" accept="image/*" capture="environment" style="display:none">
      <input type="file" id="proof-file-lib" accept="image/*" style="display:none">
      <input type="file" id="proof-video" accept="video/*" capture="environment" style="display:none">
      <input type="file" id="proof-video-lib" accept="video/*" style="display:none">
      ${(!rec || left > 0) ? `
        <button class="primary-btn wide" data-action="pick-proof">${rec ? 'Retake' : 'Take the photo'}</button>
        <button class="secondary-btn wide" data-action="pick-proof-lib">Upload a photo</button>
        <button class="secondary-btn wide" data-action="pick-video">${rec ? 'Record again' : 'Record a video'}</button>
        <button class="secondary-btn wide" data-action="pick-video-lib">Upload a video</button>
        <div class="hint">A clip can be up to ${PROOF_VIDEO_MAX_SEC} seconds.</div>` : ''}
```

`capture="environment"` on `accept="video/*"` opens the phone's own camera in video mode on both iOS and Android. There is no in-app recorder to build and none should be added.

- [ ] **Step 3: Show the clip instead of the still when the proof is a video**

In `modalProof`, the sheet currently renders `shot` as an `<img>` (lines 4429-4431). Assert and replace:

```js
      ${shot ? `<div class="proof-shot"><img src="${shot}" alt="Proof of ${escapeHtml(ex.name)}">
        <p class="story-caption">${escapeHtml(ex.name)}</p>
      </div>` : ''}
```

with:

```js
      ${shot ? `<div class="proof-shot">
        ${clip
          ? `<video src="${clip}" poster="${shot}" controls playsinline muted loop preload="metadata"></video>`
          : `<img src="${shot}" alt="Proof of ${escapeHtml(ex.name)}">`}
        <p class="story-caption">${escapeHtml(ex.name)}</p>
      </div>` : ''}
```

and add, above the `return` in `modalProof` beside the existing `const shot = m.image || img;`:

```js
  // An object URL for the sheet only. Revoked when the sheet closes, in
  // closeModal — a URL held past its element is the classic leak here.
  const clip = m.videoUrl || null;
```

- [ ] **Step 4: Wire the inputs**

Beside the existing `onProofPicked` (line 5571), add:

```js
  const onVideoPicked = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    showToast('Reading the clip…');
    try {
      const got = await readVideoFile(file);
      if (state.modal.videoUrl) URL.revokeObjectURL(state.modal.videoUrl);
      state.modal.video = got;
      state.modal.videoUrl = URL.createObjectURL(got.blob);
      state.modal.image = got.poster;
      renderModal();
    } catch (err) {
      const why = err && err.message;
      showToast(
        why === 'too-long' ? `That clip is over ${PROOF_VIDEO_MAX_SEC} seconds — try a shorter one.`
        : why === 'too-big' ? 'That clip is too large — try a shorter one, or a lower camera quality.'
        : "That video couldn't be read."
      );
    }
  };
  const proofVideo = document.getElementById('proof-video');
  if (proofVideo) proofVideo.onchange = onVideoPicked;
  const proofVideoLib = document.getElementById('proof-video-lib');
  if (proofVideoLib) proofVideoLib.onchange = onVideoPicked;
```

Add the two cases beside `pick-proof` (line 5677):

```js
    case 'pick-video': {
      const el = document.getElementById('proof-video');
      if (el) el.click();
      break;
    }
    case 'pick-video-lib': {
      const el = document.getElementById('proof-video-lib');
      if (el) el.click();
      break;
    }
```

**Before adding them, run `grep -o "case '[a-z-]*':" src/main.js | sort | uniq -d` and confirm it prints nothing.** Duplicate `case` labels are legal JavaScript, the first one wins, and a duplicate here has already made one button dead for a whole round in this repo. Run it again after adding.

- [ ] **Step 5: Save the clip alongside the record**

In the `save-proof` case (line 5687), the handler stores `state.modal.image` and posts to the crew. Assert and replace these two lines:

```js
      state.proofImages = { ...state.proofImages, [today]: { ...(state.proofImages[today] || {}), [exId]: img } };
      // Explained once, on the first one ever taken.
```

with:

```js
      state.proofImages = { ...state.proofImages, [today]: { ...(state.proofImages[today] || {}), [exId]: img } };
      // A clip is stored beside its poster, never instead of it. Everything
      // else in the app reads the poster and needs no knowledge of video.
      const clip = state.modal && state.modal.video;
      if (clip) await saveProofVideo(today, exId, clip.blob);
      else if (hasProofVideo(today, exId)) {
        // A retake with a photo replaces a clip: leaving the old one would
        // mean the sheet plays a video the record no longer describes.
        await db.removeItem(videoKey(today, exId)).catch(() => {});
        state.proofVideos = purgeExerciseFromByDay(state.proofVideos, exId);
        await db.setItem('proof-videos', state.proofVideos);
      }
      // Explained once, on the first one ever taken.
```

The crew still receives `img` — the poster — through the unchanged `postProofToCrew` call further down the same case. Do not change it. Video to the crew would need a Worker deploy and D1 growth, both ruled out.

- [ ] **Step 6: Revoke the object URL when the sheet closes**

In `closeModal`, add before the modal state is cleared:

```js
  if (state.modal && state.modal.videoUrl) URL.revokeObjectURL(state.modal.videoUrl);
```

- [ ] **Step 7: Load the clip when an existing video proof is reopened**

In the `open-proof` case (line 5657), replace:

```js
    case 'open-proof':
      state.modal = { type: 'proof', exId: btn.dataset.id, image: null };
      renderModal();
      break;
```

with:

```js
    case 'open-proof': {
      state.modal = { type: 'proof', exId: btn.dataset.id, image: null };
      renderModal();
      const d = todayISO();
      const existing = await loadProofVideo(d, btn.dataset.id);
      if (existing && state.modal && state.modal.type === 'proof') {
        state.modal.videoUrl = URL.createObjectURL(existing);
        renderModal();
      }
      break;
    }
```

The sheet renders first and the clip arrives after, so opening it is never blocked on reading tens of megabytes.

- [ ] **Step 8: Style the video like the still**

In `src/style.css`, find the `.proof-shot img` rule and extend its selector to `.proof-shot img, .proof-shot video`. If the rule sets `object-fit`, keep it. Do not add a new block — one rule for both is the point.

- [ ] **Step 9: Verify by using it**

Run `npm test` (expect 427 passing) and `npm run build`.

Then, in the browser with the service worker unregistered and caches cleared, at 375px width:
1. Open a finished exercise's proof sheet. Confirm four buttons and the 15-second hint, all clearing 44px, with no horizontal overflow.
2. Upload a video under 15s. Confirm the poster appears, then the clip plays with controls.
3. Save it. Confirm the toast, and that the Done row's camera button still shows.
4. Reopen the proof sheet. Confirm the clip plays back from storage.
5. Upload a clip over 15 seconds. Confirm the refusal names the rule and nothing is stored.
6. Confirm Today, Progress and Plan all render normally afterwards **without reloading between checks**.

- [ ] **Step 10: Commit**

```bash
git add src/main.js src/style.css
git commit -m "Take or upload a video as proof, with a still frame beside it"
```

---

### Task 5: Share and save the raw clip

The instant path: the original file, untouched, out through the share sheet.

**Files:**
- Modify: `src/main.js` — `offerImage` (line 2368), `modalProof` (line 4445 region), the action switch

**Interfaces:**
- Consumes: `loadProofVideo`, `hasProofVideo` (Task 3).
- Produces: `offerImage(blob, ex, suffix, mime)` — a fourth optional parameter, defaulting to `'image/png'`, so one function still answers "where does the file go".

- [ ] **Step 1: Generalise `offerImage` to any file type**

Assert and replace, in `offerImage`:

```js
async function offerImage(blob, ex, suffix) {
  if (!blob) { showToast("Couldn't build the image."); return; }
```

with:

```js
async function offerImage(blob, ex, suffix, mime = 'image/png') {
  if (!blob) { showToast("Couldn't build the image."); return; }
```

and:

```js
  const file = new File([blob], `${parts.join('-')}${suffix}.png`, { type: 'image/png' });
```

with:

```js
  // The extension comes off the type rather than a second argument: a name and
  // a type that disagree is how a share sheet ends up refusing a valid file.
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'png';
  const file = new File([blob], `${parts.join('-')}${suffix}.${ext}`, { type: mime });
```

and:

```js
  showToast('Image saved');
```

with:

```js
  showToast(ext === 'png' ? 'Image saved' : 'Video saved');
```

- [ ] **Step 2: Add the buttons**

In `modalProof`, assert and replace:

```js
      ${rec && img ? `<button class="secondary-btn wide" data-action="save-proof-image" data-id="${ex.id}">Save to my photos</button>` : ''}
```

with:

```js
      ${rec && img ? `<button class="secondary-btn wide" data-action="save-proof-image" data-id="${ex.id}">Save to my photos</button>` : ''}
      ${rec && hasVideo ? `<button class="secondary-btn wide" data-action="share-proof-video" data-id="${ex.id}">Share the video</button>` : ''}
```

and add beside the `clip` line added in Task 4:

```js
  const hasVideo = hasProofVideo(today, ex.id);
```

- [ ] **Step 3: Add the handler**

Add beside `save-proof-image` (line 5673):

```js
    case 'share-proof-video': {
      const ex2 = state.exercises.find((e) => e.id === btn.dataset.id);
      const raw = await loadProofVideo(todayISO(), btn.dataset.id);
      if (!ex2 || !raw) { showToast("That clip is gone."); break; }
      // Straight through, untouched: no processing, no wait, no quality lost,
      // and a file every gallery and story sheet already accepts.
      await offerImage(raw, ex2, '-proof', raw.type || 'video/mp4');
      break;
    }
```

Run `grep -o "case '[a-z-]*':" src/main.js | sort | uniq -d` afterwards and confirm it prints nothing.

- [ ] **Step 4: Verify by using it**

Run `npm test` (expect 427 passing) and `npm run build`. Then, with caches cleared: save a video proof, tap **Share the video**, and confirm the share sheet opens with a playable clip (or, on a desktop browser with no share target, that the file downloads and plays).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "Share the raw clip straight out, no processing in the way"
```

---

### Task 6: The video collage

The card over the moving footage, validated on the file it actually produced.

**Files:**
- Modify: `src/main.js` — `buildSessionImage` (line 2039), `buildProofCollage` (line 2414), `shareProofCollage` (line 2466), `saveProofCollage` (line 2452), `modalShareChoice` (line 4386)

**Interfaces:**
- Consumes: `buildSessionImage(ex, session)`, `loadProofVideo`, `hasProofVideo`, `offerImage(blob, ex, suffix, mime)`.
- Produces:
  - `buildSessionImage` accepts `session.overlayOnly: boolean` and returns the `HTMLCanvasElement` rather than a Blob when it is set.
  - `buildProofVideoCollage(exId) -> Promise<{blob: Blob, mime: string}|null>`
  - `playableVideoBlob(blob) -> Promise<boolean>`

- [ ] **Step 1: Let the card render onto a transparent ground**

In `buildSessionImage`, assert and replace the backdrop and photo block (lines 2046-2067). The scrim gradient is lifted into a local function so the photo path and the video path share one definition rather than drifting apart:

```js
  const INK = '#0A0C0B', TEXT = '#EEF2EF', DIM = '#9AA5A0', FAINT = '#6E7975', ACCENT = '#3EE07F';
  // Light over the picture, heavy under the text: the scrim has to let you see
  // the proof at the top and still let you read the number below it.
  const paintScrim = () => {
    const scrim = g.createLinearGradient(0, 0, 0, SHARE_H);
    scrim.addColorStop(0, 'rgba(10,12,11,0.55)');
    scrim.addColorStop(0.30, 'rgba(10,12,11,0.38)');
    scrim.addColorStop(0.46, 'rgba(10,12,11,0.86)');
    scrim.addColorStop(1, 'rgba(10,12,11,0.95)');
    g.fillStyle = scrim;
    g.fillRect(0, 0, S, SHARE_H);
  };

  // overlayOnly draws the card and nothing under it, so a caller can composite
  // it over something that moves. Every other caller gets the opaque card it
  // always got.
  if (session.overlayOnly) {
    paintScrim();
  } else {
    paintShareBackdrop(g, INK, ACCENT);
    // With proof, the photo IS the card's ground rather than a panel above it.
    // Stacking the two shrank the card — both are 9:16, so every bit of height
    // the card gave up cost it width twice over — and pillarboxed a portrait
    // phone photo inside a wide band. Full-bleed wastes nothing.
    if (session.photo) {
      const ph = session.photo;
      const sc = Math.max(S / ph.width, SHARE_H / ph.height);
      const pw = ph.width * sc, phh = ph.height * sc;
      g.drawImage(ph, (S - pw) / 2, (SHARE_H - phh) / 2, pw, phh);
      paintScrim();
    }
  }
```

Then find the function's final line, `return new Promise((resolve) => c.toBlob(resolve, 'image/png'));` (line 2151), and replace it with:

```js
  return session.overlayOnly ? c : new Promise((resolve) => c.toBlob(resolve, 'image/png'));
```

- [ ] **Step 2: Add the validator**

Insert before `buildProofCollage` (line 2414):

```js
/**
 * Is the file in my hand playable?
 *
 * NOT "can this browser record MP4". isTypeSupported() is a claim — Safari has
 * answered true for types it then muxes badly — and a button branched off a
 * claim is a feature that is missing on one phone and broken on another, with
 * no way to tell which from here. Asking the artifact catches what the claim
 * cannot: a recorder yielding zero bytes, a stream that never started, and a
 * duration coming back Infinity, which is a real and common Chromium bug and
 * which Instagram rejects anyway.
 */
function playableVideoBlob(blob) {
  return new Promise((resolve) => {
    if (!blob || blob.size < 1024) { resolve(false); return; }
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0);
    v.onerror = () => done(false);
    setTimeout(() => done(false), 5000);
    v.src = url;
  });
}
```

- [ ] **Step 3: Build the video collage**

Insert directly after `buildProofCollage` (which ends at line 2450):

```js
const COLLAGE_MAX_MS = 8000;
// MP4 first, because it is the only container every story sheet accepts. This
// picks a preference order; it never gates the button. The verdict is
// playableVideoBlob, on the file that comes out.
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

/**
 * The same card, with the clip as its moving ground.
 *
 * Eight seconds, because compositing runs in real time — there is no
 * fast-forward without an encoder this app refuses to carry — so the clip's
 * length is the user's wait. Eight seconds with a toast is a wait; fifteen is
 * a hang. The raw-video button is instant and carries the whole clip, so
 * nothing is lost by capping this one.
 *
 * Silent by design. A gym clip's audio is noise, and muxing a second track
 * doubles the failure surface for something nobody asked for.
 *
 * ponytail: MediaRecorder's container is the browser's choice, so an old
 * Android with no MP4 support yields .webm — which saves to the gallery but
 * Instagram rejects. The upgrade, if it ever actually bites, is WebCodecs
 * VideoEncoder with a vendored MP4 muxer. Not worth a second encoder today.
 */
async function buildProofVideoCollage(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  const d = todayISO();
  const raw = ex && await loadProofVideo(d, exId);
  if (!ex || !raw || !window.MediaRecorder) return null;

  const arr = getSetsFor(exId, d);
  const target = getEffectiveTarget(ex, d);
  const timer = getTimerPure(state.timersLog, d, exId);
  const st = exerciseStats(ex, state.setsLog, state.timersLog, null, state.streakOverrides);

  const url = URL.createObjectURL(raw);
  const vid = document.createElement('video');
  vid.muted = true;
  vid.playsInline = true;
  // iOS refuses to play an unmuted, non-inline video without a fresh gesture,
  // and a refused play records a blank canvas rather than throwing.
  vid.setAttribute('playsinline', '');
  vid.setAttribute('muted', '');
  vid.loop = false;

  let stopEarly = null;
  try {
    const card = await buildSessionImage(ex, {
      total: progressValue(ex, arr), target,
      timeMode: isTimeMode(ex),
      sets: arr.length,
      streak: st.currentStreak,
      elapsed: formatDuration(timerElapsedMs(timer, Date.now())),
      pct: target > 0 ? Math.min(1, progressValue(ex, arr) / target) : 1,
      short: false,
      dateLabel: formatDisplayDate(d, { weekday: 'short', day: 'numeric', month: 'short' }),
      headline: target > 0 ? 'Target met' : 'Session complete',
      overlayOnly: true,
    });

    await new Promise((res, rej) => {
      vid.onloadeddata = res;
      vid.onerror = () => rej(new Error('decode-failed'));
      vid.src = url;
    });

    const c = document.createElement('canvas');
    c.width = SHARE_W; c.height = SHARE_H;
    const g = c.getContext('2d');
    const stream = c.captureStream(30);
    const mime = RECORDER_TYPES.find((t) => {
      try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; }
    });
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4000000 } : {});
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const finished = new Promise((res) => { rec.onstop = res; });

    const sc = Math.max(SHARE_W / vid.videoWidth, SHARE_H / vid.videoHeight);
    const vw = vid.videoWidth * sc, vh = vid.videoHeight * sc;
    const vx = (SHARE_W - vw) / 2, vy = (SHARE_H - vh) / 2;

    let raf = 0;
    const draw = () => {
      g.drawImage(vid, vx, vy, vw, vh);
      g.drawImage(card, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    rec.start();
    await vid.play();
    draw();
    stopEarly = () => { cancelAnimationFrame(raf); try { rec.stop(); } catch (e) { /* already stopped */ } };
    await new Promise((res) => {
      const t = setTimeout(res, Math.min(COLLAGE_MAX_MS, vid.duration * 1000));
      vid.onended = () => { clearTimeout(t); res(); };
    });
    stopEarly();
    stopEarly = null;
    await finished;

    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/mp4' });
    if (!await playableVideoBlob(blob)) return null;
    return { blob, mime: blob.type };
  } catch (e) {
    return null;
  } finally {
    if (stopEarly) stopEarly();
    vid.pause();
    vid.src = '';
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Send the collage buttons down the video path when there is a clip**

Assert and replace `shareProofCollage` (line 2466):

```js
async function shareProofCollage(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return;
  showToast('Building image…');
  const blob = await buildProofCollage(exId);
  await offerImage(blob, ex, '-proof');
}
```

with:

```js
async function shareProofCollage(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return;
  const made = await buildCollageFor(exId);
  await offerImage(made.blob, ex, '-proof', made.mime);
}

/**
 * One answer for both collage buttons: the moving card when there is a clip
 * and the phone could make one, the still card otherwise.
 *
 * The still is not a consolation prize, it is the same card. Nothing is hidden
 * on any phone, and no phone is ever handed a file it cannot play — a feature
 * that exists on your phone and not your crewmate's is the disharmony this
 * whole design exists to avoid.
 */
async function buildCollageFor(exId) {
  const d = todayISO();
  if (hasProofVideo(d, exId)) {
    showToast('Building your video… about 8 seconds.');
    const made = await buildProofVideoCollage(exId);
    if (made) return made;
    showToast("Your phone couldn't make the video card — here is the photo one.");
  } else {
    showToast('Building image…');
  }
  return { blob: await buildProofCollage(exId), mime: 'image/png' };
}
```

Then assert and replace, in `saveProofCollage` (line 2452):

```js
  showToast('Building…');
  const blob = await buildProofCollage(exId);
  if (!blob) { showToast("Couldn't build the image."); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.href = url; a.download = `sets-proof-${slug(ex.name)}-${todayISO()}.png`;
```

with:

```js
  const made = await buildCollageFor(exId);
  const blob = made.blob;
  if (!blob) { showToast("Couldn't build the image."); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ext = made.mime.includes('mp4') ? 'mp4' : made.mime.includes('webm') ? 'webm' : 'png';
  a.href = url; a.download = `sets-proof-${slug(ex.name)}-${todayISO()}.${ext}`;
```

and its final `showToast('Saved to your photos');` needs no change — it is true of both.

- [ ] **Step 5: Say what the button gives you**

In `modalShareChoice`, assert and replace:

```js
      <button class="add-kind" data-action="share-proof-collage" data-id="${ex.id}">
        <b>With your proof</b><span>Your photo above the card, story-sized.</span>
      </button>
```

with:

```js
      <button class="add-kind" data-action="share-proof-collage" data-id="${ex.id}">
        <b>With your proof</b><span>${hasProofVideo(todayISO(), ex.id)
          ? 'Your clip as the card, story-sized.'
          : 'Your photo as the card, story-sized.'}</span>
      </button>
```

- [ ] **Step 6: Verify by using it**

Run `npm test` (expect 427 passing) and `npm run build`.

Then, caches cleared, at 375px:
1. Save a **photo** proof and tap **Share it**. Confirm the still card is unchanged from before this plan — the photo path must be byte-for-byte the same feature it was.
2. Save a **video** proof and tap **Share it**. Confirm the toast names the wait, the wait is about eight seconds and the app does not freeze, and the resulting file plays with the card burned over the footage.
3. Tap **Save to my photos** on the same video proof. Confirm the file downloads with an `.mp4` or `.webm` extension matching its content, and plays.
4. Confirm Today still renders and the exercise state still changes **without reloading between checks**.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "Draw the card over the clip, and trust the file rather than the browser"
```

---

### Task 7: Tell everyone

**Files:**
- Modify: `src/notices.js`

- [ ] **Step 1: Ask Johnny first**

**Adding an entry to `src/notices.js` is what sends it to every user.** Never add one without asking Johnny, every time — even though this feature was requested. Ask, and wait for the answer, before Step 2.

- [ ] **Step 2: Add the notice**

Only after approval, following the existing shape of the file exactly:

```js
  {
    id: 'video-proof',
    date: '2026-08-17',
    title: 'Proof can be a video now',
    body: [
      'Finish an exercise with a clip instead of a photo — record it in Sets or pick one you already took. Up to 15 seconds.',
      'Share the clip as it is, or share the card with your clip playing behind the numbers. Both save to your phone.',
      'Photos and clips now clear themselves after 24 hours, and go straight away if you delete the exercise. Anything you saved to your phone is yours and stays.',
    ],
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/notices.js
git commit -m "Notice: proof can be a video"
```

---

### Task 8: Deploy and byte-verify

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Build the pushed commit and compare bytes**

`__BUILD_ID__` is the git short SHA, so a build made before committing can **never** match what is live. That mistake has cost two rounds of false-alarm polling in this repo. Build the commit that is actually on `main`, then `shasum` the live asset against `dist/`. Never grep minified output — the minifier renames local variables and the answer is a hash comparison, not a `grep`.

- [ ] **Step 3: Hand the device check to Johnny**

This is the one thing that cannot be settled from here. Ask him to run **Backup & data → Force update now** on his phone, then, on both an iPhone and an Android if he has both to hand:

1. Record a clip through Sets as proof.
2. Tap **Share the video** and post it to an Instagram story.
3. Tap **Share it** and post the video card to a story.
4. Report which of the two, if either, Instagram refused.

Step 3 refusing on Android while step 2 works is the `.webm` residual named in the `ponytail:` comment on `buildProofVideoCollage`, not a bug in this plan — and it is the signal that the WebCodecs upgrade has become worth its weight.
