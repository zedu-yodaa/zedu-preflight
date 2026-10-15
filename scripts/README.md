# Zedu Preflight: results processing

Part of **Zedu Preflight** (Team Yoda, HNG 15), the pre-release tester that tells the team whether a Zedu build is **Ready** or **Not Ready** to release.

This script runs after the Playwright tests. It reads Playwright's JSON report, decides the release verdict, and sends the results to the Preflight dashboard.


## What it does

1. Reads the Playwright JSON report and turns each test into one row: name, feature, priority (P0/P1), status, error reason, screenshot and trace paths.
2. Decides the verdict (PRD FR-17):

   | Verdict | When |
   | --- | --- |
   | ❌ **Not Ready** | Any P0 (must-pass) test failed, or the test runner itself failed |
   | ⚠️ **Ready with warnings** | Only P1 tests failed, or some tests were flaky (failed, then passed on retry) |
   | ✅ **Ready** | Every test passed |

3. Writes `results-payload.json`, adds a summary table to the GitHub Actions run page, and POSTs the results to the dashboard API with the project API key (PRD FR-15).

Tests are **P0 by default**; tag a test `@p1` to make it non-blocking. The **feature** comes from the test's folder (`auth/`, `messaging/`, ...), one folder per feature as in the PRD.

## Try it

Needs Node 18 or newer. No packages to install.

```bash
node scripts/process-results.mjs --report sample/results.json
```

Output:

```
Preflight verdict: Not Ready (1 must-pass (P0) test(s) failed)
passed 1 · failed 1 · flaky 1 · skipped 1
Payload written to results-payload.json
```

## Options

| Option | Meaning |
| --- | --- |
| `--report <file>` | Playwright JSON report (default `results.json`) |
| `--out <file>` | Where to write the payload (default `results-payload.json`) |
| `--dry-run` | Process only; don't send to the dashboard |
| `--fail-on-not-ready` | Exit with code 1 when the verdict is Not Ready, so the CI job fails |

## Configuration

Set these as GitHub variables and secrets. Never put them in code.

| Variable | Purpose |
| --- | --- |
| `PREFLIGHT_RESULTS_URL` | Dashboard results endpoint (must be `https://`) |
| `PREFLIGHT_API_KEY` | Project API key, sent as the `x-api-key` header |
| `PREFLIGHT_PROJECT` | Project name (default `zedu`) |
| `PREFLIGHT_ENVIRONMENT` | Environment name (default `staging`) |

If the URL or key is missing, the script still writes the payload and skips the upload.

## Using it in GitHub Actions

See [`docs/results-workflow-steps.yml`](../docs/results-workflow-steps.yml) for the steps to add after the Playwright test step. The Playwright config must include the JSON reporter:

```ts
reporter: [['list'], ['json', { outputFile: 'results.json' }]],
```

## Tested cases

- A P0 test fails → **Not Ready**, exit code 1 with `--fail-on-not-ready`
- Only a P1 test is flaky → **Ready with warnings**
- Report missing → **Not Ready** ("The test runner itself failed")
- Upload to the dashboard → sent with the `x-api-key` header
- Wrong API key → rejected cleanly, without retrying
