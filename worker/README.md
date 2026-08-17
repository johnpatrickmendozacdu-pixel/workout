# Sets Worker — token broker + crews

Two jobs, one Worker, because they share the same reason to exist: holding what a
browser must not. The **broker** keeps Google sync alive past the 1-hour token
expiry and stores nothing. The **crew** routes store the social layer in D1 —
names, streaks and totals that people have chosen to share with each other, never
anyone's workout log.

`deploy-this.js` is **generated**. Change `broker.js`, `crew.js`, `crew-routes.js`
or `index.js`, then run `node tools/bundle-worker.mjs` and paste the result.

## One-time deploy (Cloudflare, free)

## Where the entry file is

Straight to the editor (Cloudflare fills in the account from your login):

    https://dash.cloudflare.com/?to=/:account/workers/services/edit/sets-broker/production

Manual route: dash.cloudflare.com -> Compute (Workers) -> **sets-broker** ->
**Edit code**.

The entry file is the one already open when the editor loads — the one carrying
the entry-point marker, not a file you add. Select all, paste
`worker/deploy-this.js` over it, Deploy. Pasting as a NEW file leaves the entry
point untouched and Deploy stays greyed out; that has cost time twice.

Confirm the paste landed — `/crew/version` is pre-auth precisely so this is
answerable from outside:

    curl -s -X POST -H 'Origin: https://sets-workout.vercel.app' \
      -H 'Content-Type: application/json' \
      https://sets-broker.johnpatrickmendoza-cdu.workers.dev/crew/version -d '{}'

1. Create a free account at **cloudflare.com** → **Workers & Pages** → **Create** →
   **Create Worker**. Give it a name (e.g. `sets-broker`) and deploy the starter.
2. **Edit code**: paste the contents of `broker.js` and then `index.js` into the editor
   as one file (paste `broker.js` first, then `index.js` — but drop the
   `import { ... } from './broker.js';` line from `index.js`, since it's now one file).
   Or, if you use the `wrangler` CLI, deploy both files as-is.
3. **Settings → Variables and Secrets** — add three:
   - `CLIENT_ID` = `515660891133-63v7l803od2cee981sineagm6snl3kfb.apps.googleusercontent.com`
   - `CLIENT_SECRET` = *(Google Cloud Console → APIs & Services → Credentials → the "Sets"
     OAuth client → **client secret**)* — add this one as an **encrypted** secret
   - `ALLOWED_ORIGIN` = `https://johnpatrickmendozacdu-pixel.github.io`  *(origin only, no path)*
4. **Deploy**. Copy the Worker URL — e.g. `https://sets-broker.<you>.workers.dev`.
5. In **Google Cloud Console** → the OAuth client → **Authorized redirect URIs**, confirm
   `https://johnpatrickmendozacdu-pixel.github.io/workout/` is listed (it already is from
   earlier setup).
6. Send the Worker URL back — it gets filled into the app as `BROKER_URL`, and that's it.

Never touched again after this. The Worker patches and scales itself.

## Crews (added 2026-08-11)

Needs a D1 database bound as `DB`. Without it the crew routes answer 503 and the
token broker carries on untouched — sync can never depend on the crew.

1. **Storage & Databases → D1 → Create** a database named `sets-crew`.
2. Its **Console** tab, run the schema in `docs/superpowers/specs/2026-08-11-crew-social-design.md`.
3. **sets-broker → Settings → Bindings → Add → D1 database**, variable name `DB`.
4. Paste the regenerated `deploy-this.js` and deploy.

Free tier: 5 GB, 5M row reads/day, 100k writes/day, and it does not pause when
idle — which is why this is here rather than on Supabase.
