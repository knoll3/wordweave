# Railway deployment

Deploy the root `Dockerfile` as a single app service. It builds the Vite client
and Express API, then serves both from the API's HTTP server. Socket.IO uses
that same server. `.railway/railway.ts` configures the services, single replicas,
database volume, and readiness checks using Railway's Infrastructure as Code.
Use `railway config plan` and `railway config apply` to review and apply infrastructure
changes. Runtime secrets stay in Railway; the configuration leaves variables unmanaged.

Use one app replica: SQLite and the in-memory live-board coordination currently
assume a single server. Mount a persistent volume at `/app/apps/api/data` so
`craft.db` and its WAL files survive deployments. Alternatively set
`DATABASE_PATH` to a file on another persistent mount. Database schema setup runs
on API startup. A fresh database starts with the four base elements.

Connect `knoll3/wordweave`, branch `main`, and enable automatic deployments.
The app accepts Railway's `PORT`; `NODE_ENV=production` is set in the image.
Store `OPENAI_API_KEY` securely in the app service's Railway variables, never
in the repository or client configuration. `OPENAI_MODEL` is optional.

Run SearXNG as a separate private service. Use the repository's
`ops/searxng/settings.yml` as its configuration, enable JSON results, and set the
app's `SEARXNG_BASE_URL` to its internal HTTP URL and port. The API also makes
outbound OpenAI and Wikipedia requests. Do not expose SearXNG publicly.

Generate a public HTTPS domain for the app. Check `/api/health`, `/`, refreshing
`/play/<session UUID>`, creating a session, seeded elements, live Socket.IO room
updates, recipe generation, and Web Search crafting. Check that a session
survives an app restart. Opening the same session URL on another device shares
the board; the browser's recent-session list itself stays local to that browser.

This application has no account authentication. A public domain is accessible
to anyone who obtains it; private repository visibility does not restrict it.
If restricted access is needed, configure an access gate before sharing it.

Code rollback does not roll back SQLite contents. Preserve volume data during
redeploys. For backups use the SQLite backup API (see the existing
`apps/api/scripts/backupLocalDb.js`), rather than copying only the live DB file
while WAL writes are in progress. The final image contains compiled API files,
so running that helper there requires supplying the helper separately.
