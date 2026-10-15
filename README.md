# Zedu Preflight

**Pre-release automated tester for Zedu**, built by Team Yoda (HNG 15).

Preflight runs automated browser checks against Zedu's staging site and tells the team in one word whether a build is **Ready** or **Not Ready** to release, with a screenshot and error log for every failure.

```
Push / PR / Run now / Nightly
        → GitHub Actions runs Playwright tests (headless Chromium, staging only)
        → scripts/process-results.mjs works out the verdict
        → results sent to the dashboard (Next.js on Vercel + Supabase)
        → Zedu channel alert when a run fails
```

## Repository layout

Each squad works **only in its own folder** (PRD working rules).

| Folder | What lives here | Owner |
| --- | --- | --- |
| `tests/<feature>/` | Playwright tests, one folder per feature: `auth`, `channels`, `messaging`, `threads`, `files`, `notifications`, `calls`, `search`, `settings` | Test squads |
| `dashboard/` | Next.js dashboard and results API | Dashboard and API squad |
| `scripts/` | Results processing: verdict and upload ([details](scripts/README.md)) | Results processing |
| `.github/workflows/` | GitHub Actions workflow | Platform and CI squad |
| `docs/` | Guides, demo script, workflow snippets | Docs squad |
| `sample/` | Sample Playwright report for testing scripts | Shared |

## Verdicts

| Verdict | Meaning |
| --- | --- |
| ✅ **Ready** | Every test passed |
| ⚠️ **Ready with warnings** | Only non-critical (P1) tests failed, or some tests were flaky |
| ❌ **Not Ready** | A must-pass (P0) test failed, or the test run itself failed |

Tests are P0 by default. Tag a test `@p1` to make it non-blocking.

## Rules for contributors

- **Install safely:** use `npm ci --ignore-scripts`. `.npmrc` already sets `ignore-scripts=true`. This blocks the install-script route used by the recent malware.
- **No new dependencies** without the tech lead's approval. Commit the lockfile and pin versions.
- **No secrets in code.** Credentials and keys go in GitHub environment secrets or local `.env` files, which are git-ignored.
- **Staging only, test accounts only.** Never run against production or use real user accounts.
- **Small PRs**, one passing local run each, no fixed sleeps (use Playwright's auto-waiting).
- **Run the malware checks** (snare) before your first push.

## Quick start

Try the results processing on the sample report (needs Node 18+, nothing to install):

```bash
node scripts/process-results.mjs --report sample/results.json
```

## Status

Day 1 of 4 (due Sunday 18 October 2026). See the team PRD for the full plan.
