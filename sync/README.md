# sync/ — Cloudflare Worker + D1 backend (DORMANT)

**Status: dormant. Not deployed, and the app no longer talks to it.**

The live auto-sync transport is Supabase: `js/engine/cloud.js` (REST client,
owner-only RLS on `formcoach_workouts`) orchestrated by `js/engine/autosync.js`.
See the repo-root `REPORT.md`.

This directory is kept so the Worker can be revived if needed:

- `worker.js` — Worker (signup / POST /workouts / GET /workouts?since=)
- `schema.sql` — D1 schema
- `wrangler.toml` — deploy config (no secrets)
- `worker.test.mjs` — runs the real schema on `node:sqlite` (Node 22+; skipped on older Node)

The matching client (`makeSyncClient`, `normalizeSyncUrl`, `pullAll`) still
lives in `js/engine/sync.js`, marked DORMANT, with its unit tests. The Settings
pairing UI and app wiring for the Worker were removed.
