# Crew — the social layer

2026-08-11. Approved before implementation. Built in three deploys; this spec
covers all three, the plan covers ① first.

---

## Why there has to be a server at all

`drive.appdata` is a private per-user folder — no other user can ever read it, by
design. A shared Drive folder does not rescue it either: `drive.file` only grants
access to files *this user's own app instance created*, so a folder Alice made is
invisible to Bob without a Google file-picker dance, and the scope that would fix
it (`drive.readonly`) is **sensitive** — Google verification, possibly a paid
annual security assessment.

So the crew lives on the Cloudflare Worker that already exists for token broking,
in a free D1 database. Cloudflare's free tier does not pause when idle, which is
the exact reason Supabase was rejected in an earlier session.

## Identity, without a new scope

The Worker already proves who a token belongs to: `exchange()` calls Google's
`userinfo` with the access token. Crew requests reuse that path — the app sends
its Google access token, the Worker asks Google who it is, and answers only for
crews that user belongs to. No new OAuth scope, no re-consent, no Console change.

The user id is the `sub` from userinfo, never the email, so changing a Gmail
display name or address cannot orphan a membership.

## What leaves the phone

Only a **card**, computed on the device and pushed by it:

    { name, photo, streak, best, trainedToday, lifetime: { reps, timeMs },
      exercises: [ { name, category, streak, total, unit } ] }

Never the set-by-set log, never weight or BMI. The Worker computes nothing about
training; it stores what the phone hands it and hands it to that phone's crew.
The card is capped (8 KB, photo included) and rejected above it.

## Schema (already created)

    crews      id · name · owner · invite_code · created_at
    members    crew_id · user_id · email · name · photo · card · joined_at · updated_at
    reactions  crew_id · from_id · to_id · kind · emoji · day · created_at · seen

`reactions` is keyed by (crew, from, to, kind, emoji, day) so the same person
cannot spam the same reaction twice in a day — the dedupe is the primary key
rather than application code.

## Endpoints

All POST, all carrying `token`. All return `{ crews: [...] }` shaped the same
way, so the app has one code path for applying a response.

| Path | Body | Rule |
|---|---|---|
| `/crew/sync` | card | Upserts my card into every crew I am in, returns them all |
| `/crew/create` | name, card | Max 10 crews per user |
| `/crew/join` | code, card | Max 30 members per crew |
| `/crew/leave` | crewId | Owner leaving hands the crew to the oldest member; last one out deletes it |
| `/crew/rename` | crewId, name | Owner only |
| `/crew/remove` | crewId, userId | Owner only, cannot remove self |
| `/crew/react` | crewId, toId, kind, emoji | ③ |
| `/crew/seen` | crewId | Marks my reactions read | ③ |

Limits exist to bound abuse from a leaked invite link, which is the one real
exposure: anyone holding a link can join and see the crew's cards. Owners can
remove members, and a removed member's card is deleted with them.

## The app

- A fifth tab, **Social**, before Guide.
- No crew → *Create a crew* / *Join with a link*.
- A crew → roster ordered by who has trained today, then by streak. Each row:
  photo, name, streak, tick. Tap a member for their full card.
- **Invite** → link, and (②) a QR card that shares like any other Sets image.
  `https://sets-workout.vercel.app/#/join/<code>` — the app reads the hash at
  boot, signs the user in if needed, and joins.
- (③) **Nudge** (offered only for someone who has not trained today),
  **Respect** (only for someone who has), and a free emoji. Counts are visible
  to the whole crew, with a badge on the tab and a line on Today when they are
  aimed at you.

**Notifications are in-app.** Reaching a phone that is not running the app needs
Web Push, which the Worker could do later and free, but iOS delivers it only to
an installed PWA. Out of scope here.

**Offline and failure:** the last roster is cached in IndexedDB and rendered with
a stale note. Every crew call fails soft — the app keeps working exactly as it
does today, because nothing outside the Social tab depends on it.

## Phases

1. **Crews and roster.** Create, join by link, leave, rename, remove, the Social
   tab, the member card, the sync call. Invite is a copyable link.
2. **QR.** A vendored MIT encoder in `src/vendor/`, drawn to canvas, shared as an
   image on the existing share sheet path.
3. **Reactions.** Nudge, Respect, emoji, badges, the Today line.

## Testing

The Worker's pure helpers get unit tests as its existing ones do: invite-code
shape, name validation, card size and sanitisation, roster assembly, the limit
rules, and owner-only permission checks. Endpoint wiring and every part of the
app UI are checked by using them.
