# Video as proof of workout — design

Date: 2026-08-17. Status: approved in brainstorming, not yet planned.

## The ask

Proof of workout accepts a video as well as a photo, recorded through Sets or
picked from the phone. It connects to the existing collage — saved and shared —
and to the crew. Free, functional, no bugs, no lag, on iPhone and Android
alike.

## What does NOT change

The domain layer. `recordProof`, `retakesLeft` and `proofFor` in `domain.js`
store a timestamp and a retake count and never look at the media. Video is
additive: no domain change, no test change, and the two-store rule
(`proofLog` syncs and decides the day; media is local and disposable) is
untouched.

The crew pipe. Proof still reaches the crew as a `proof:<exercise>` story
carrying a still image. No Worker deploy, no D1 growth, no new endpoint — the
one part of this app that cannot ship without Johnny at a Cloudflare dashboard.

## 1. Storage

`proofImages` — unchanged. Base64 stills, one object, loaded at startup.

`proofVideos` — new, local only, **never in `SNAPSHOT_DATA_KEYS`**, so a clip
can never enter a Drive snapshot. Two parts:

- An index under the existing single-key shape: `{ [date]: { [exId]: true } }`.
  Tiny, loaded at startup, rewritten freely.
- The blobs themselves, **one IndexedDB key each**: `proof-video:<date>:<exId>`.

The split is not tidiness, it is the difference between working and unusable.
A 30 MB blob inside the one-object shape means every new proof rewrites every
other clip, and startup reads all of them. Per-key means a save writes exactly
one blob and **startup reads none** — a clip is fetched on demand, when the
proof sheet opens or a share is requested.

Requires `removeItem(key)` in `src/db/db.js`, four lines mirroring `setItem`.

## 2. Capture

Two hidden inputs, exactly mirroring the photo pair already in `modalProof`:

```html
<input type="file" accept="video/*" capture="environment">  <!-- record -->
<input type="file" accept="video/*">                        <!-- upload -->
```

`capture="environment"` opens the native camera recorder on both iOS and
Android. There is no `getUserMedia`, no in-app camera UI, no recording
controls to build — the same reason the photo path never needed them.

**Caps, enforced before anything is stored:** 15 seconds, 60 MB. Duration is
read from a `<video>` element's metadata. Over either limit the clip is
refused with a plain sentence ("That clip is over 15 seconds — try a shorter
one"), and nothing is written. There is no trimming: trimming means
re-encoding, which means ffmpeg.wasm, which is a multi-megabyte dependency
this app does not carry. Phones shooting 4K will meet the size cap; that is
deliberate and stated, not a silent failure.

## 3. The poster frame

On save, one frame at 0.5s is drawn to a canvas and stored in `proofImages`
as the poster, alongside the video.

This single step is why nothing else has to change. The Done row's camera
button, the still collage, the crew story and the day list all read
`proofImages` and keep working untouched, whether the proof was a photo or a
video.

## 4. The two outputs

| Button | Produces |
|---|---|
| Share the video / Save the video | The original clip, untouched, through `navigator.share` with a download fallback. No processing, no quality loss, no wait. Accepted by Instagram, Photos and Gallery on both platforms. |
| Share it / Save to my photos | The collage. Photo proof gives today's still card exactly as now. Video proof gives the same card with the video as its moving ground. |

The video collage reuses `buildSessionImage` unchanged. Each frame: video to
canvas, card overlay on top, `canvas.captureStream(30)` into a
`MediaRecorder`.

**Silent.** No audio track. A gym clip's audio is noise, and muxing it doubles
the failure surface for nothing anyone asked for.

**First 8 seconds only.** Compositing runs in real time — there is no
fast-forward without WebCodecs — so the clip's length is the user's wait. Eight
seconds with a progress toast is a wait; fifteen is a hang. The raw-video
button is instant and carries the whole clip, so nothing is lost.

The compositing `<video>` element must be `muted` and `playsinline`, or iOS
refuses to play it and the recording comes back empty.

## 5. Codec handling — validate the artifact, not the capability

There is no capability check and no probe.

`MediaRecorder.isTypeSupported()` is a claim, not a result; Safari has returned
true for types it then muxes badly. Branching a button off a claim produces a
feature that is missing on one phone and broken on another, with no way to tell
which from here.

One code path:

1. Record with the first type the browser accepts, MP4 first
   (`video/mp4;codecs=avc1`, `video/mp4`, `video/webm;codecs=vp9`,
   `video/webm`).
2. **Verify the blob actually produced**: non-zero size, loads in a `<video>`,
   finite duration greater than zero.
3. On failure, return `null`.

`null` is already handled — `buildProofCollage` returns it today and every
caller reports the failure. The fallback is not new code; it is the path that
already exists, with one line changed to hand back the still card instead.

Validation beats a probe because it answers the question that matters. A probe
asks "can this browser mux MP4?"; validation asks "is the file in my hand
playable?" — and catches what a probe cannot: a recorder yielding zero bytes, a
stream that never started, a duration returning `Infinity` (a real and common
Chromium bug).

**The buttons never disappear.** Every phone shows the same controls; only the
file behind one of them may quietly become the still card. A feature that
exists on your phone and not your crewmate's is exactly the disharmony this
design exists to avoid.

Residual, marked in code rather than solved: old Android without MP4 recording
produces `.webm`, which saves to the gallery but Instagram rejects. It carries
a `ponytail:` comment naming WebCodecs plus a vendored MP4 muxer as the upgrade
path if it ever actually bites. Not worth a second encoder today.

## 6. Expiry and deletion

- **Proof media prunes at 24 hours**, photos and videos alike, down from the
  current 48. One cutoff, both stores.
- **Deleting an exercise purges its proof media and its `proofLog` entries**
  across every day. This is a real gap today: `deleteExerciseHandler` leaves
  both behind.
- **`proofLog` is never touched by expiry** — only by exercise deletion. If the
  24-hour prune reached it, every past day would silently un-finish and take
  the streak with it. That is the precise bug the two-store split exists to
  prevent, and there is already a test named for it.
- **Stories already expire at 24 hours server-side.** Nothing to build.
- **Collages are never stored.** Built on demand, handed to the share sheet,
  discarded. Nothing to expire.
- **"Unless you save it to your phone" needs no code.** Once a file is in
  Photos it is outside the app, and no prune can reach it.

## 7. Android

Nothing here is iPhone-specific. `capture="environment"` opens the camera on
both. `navigator.share` with files works on Android Chrome, with the existing
download fallback behind it. The codec path in section 5 is the same code on
both platforms precisely because it tests the output rather than the platform.

## Cost

Zero. No new service, no new dependency, no Worker deploy, no D1 growth. Video
never leaves the phone except through the user's own share sheet.

## Testing

The domain layer is unchanged, so the existing 420 tests stand. New pure
helpers (the duration/size gate, the prune cutoff, the exercise-delete purge)
get unit tests in the existing files. Everything else is `main.js`, which has
no coverage by design and must be verified by using the app: record a clip,
upload a clip, share both outputs, delete the exercise, and confirm the clip
is gone.

## Open, deliberately

Whether the video collage produces a shareable MP4 on Johnny's actual iPhone
and an actual Android cannot be settled from here. Section 5 makes the failure
safe rather than absent. It is a device check, not a code claim.
