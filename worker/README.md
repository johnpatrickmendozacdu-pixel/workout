# Sets token-broker Worker

Stateless. Keeps Google sync alive past the 1-hour token expiry. Stores nothing —
it only holds the Google client secret (as an env var) and swaps tokens on demand.

## One-time deploy (Cloudflare, free)

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
