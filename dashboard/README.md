# Dashboard and results API (FR-15, FR-16, FR-18)

The Preflight dashboard: sign in, see each project's latest verdict, the run history, and every failed test with its reason and error log. It is plain HTML, CSS and JavaScript with Supabase (Auth + Postgres), plus one Vercel serverless function that receives results from CI. There is no install or build step and there are no npm dependencies. It can be ported to Next.js later without changing the database or the API contract.

## How a run gets here

```
GitHub Actions (.github/workflows/preflight.yml)
  → npx playwright test              writes results.json
  → scripts/process-results.mjs      works out the verdict, POSTs it with x-api-key
  → api/results.js (Vercel)          checks the key and payload, calls ingest_run()
  → Supabase runs + test_results     one transaction; re-sending a run replaces it
  → projects.html / run.html         signed-in users read it (RLS: read-only)
```

## Files

| File | Purpose |
| --- | --- |
| `login.html` | Sign-in page |
| `projects.html` | Latest verdict per project + run history (newest first) |
| `run.html` | One run: verdict, counts, failed/flaky tests first with reason and error log, link to evidence on GitHub |
| `index.html` | Redirects to `projects.html` |
| `auth.js` | Supabase client, page protection, sign-out |
| `ui.js` | Escaping and display helpers (badges, dates, durations) |
| `config.js` | Supabase project URL and **publishable** key (public by design; never put the secret key here) |
| `style.css` | Styles and verdict colours (FRD 2.3) |
| `api/results.js` | `POST /api/results`, the endpoint CI sends results to |
| `supabase/schema.sql` | Tables, read-only policies and the `ingest_run()` function |

## One-time setup

1. **Supabase.** Open SQL Editor, paste `supabase/schema.sql` and run it. Create dashboard accounts under Authentication → Users.
2. **Vercel.** Add New → Project → import `zedu-yodaa/zedu-preflight` → set **Root Directory** to `dashboard` → Framework preset **Other**. Add these environment variables, then Deploy:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Same URL as in `config.js` |
   | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **secret** key (or the legacy `service_role` key). Server only. |
   | `PREFLIGHT_API_KEY` | A long random string, e.g. `openssl rand -hex 32` |

   Turn off Settings → Deployment Protection so others can open the link (the API is protected by its own key).
3. **GitHub.** Settings → Environments → create **staging** and add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `ZEDU_BASE_URL` | Zedu **staging** URL |
   | Variable | `PREFLIGHT_RESULTS_URL` | `https://<your-app>.vercel.app/api/results` |
   | Secret | `PREFLIGHT_API_KEY` | Same value as in Vercel |
   | Secret | `ZEDU_TEST_EMAIL`, `ZEDU_TEST_PASSWORD` | A staging **test** account |

4. Actions → **Preflight** → Run workflow. The run appears on the dashboard when it finishes.

## API contract

`POST /api/results` with header `x-api-key: <PREFLIGHT_API_KEY>` and the JSON written by `scripts/process-results.mjs` (`schemaVersion: 1`).

| Response | Meaning |
| --- | --- |
| `201 { ok, runId }` | Saved |
| `400` | Payload is invalid (the reason is in `error`) |
| `401` | Missing or wrong API key |
| `405` | Not a POST |
| `500` | API env vars not set on Vercel |
| `502` | Supabase didn't accept it (the uploader retries) |

Screenshots and traces stay on the GitHub run as the `preflight-evidence` artifact. The dashboard links to it.
