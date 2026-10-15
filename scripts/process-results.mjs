#!/usr/bin/env node
// Zedu Preflight: process a Playwright JSON report.
//
// What it does:
//   1. Reads Playwright's JSON report (reporter: [['json', { outputFile: 'results.json' }]]).
//   2. Turns every test into one simple row: name, feature, priority, status, error, screenshot.
//   3. Works out the verdict (PRD FR-17):
//        Not Ready            -> any P0 test failed, or the runner itself errored
//        Ready with warnings  -> only P1 tests failed, or some tests were flaky
//        Ready                -> everything passed
//   4. Writes results-payload.json, adds a summary to the GitHub Actions run page,
//      and POSTs the payload to the dashboard results API with the project API key (FR-15).
//
// No dependencies: Node 18+ only (built-in fetch, fs, path).
//
// Usage:
//   node scripts/process-results.mjs [--report results.json] [--out results-payload.json]
//                                    [--dry-run] [--fail-on-not-ready]
//
// Environment variables (set as GitHub secrets / vars, never in code):
//   PREFLIGHT_RESULTS_URL   dashboard endpoint, e.g. https://<app>.vercel.app/api/results
//   PREFLIGHT_API_KEY       project API key (sent as the x-api-key header)
//   PREFLIGHT_PROJECT       project name (default: "zedu")
//   PREFLIGHT_ENVIRONMENT   environment name (default: "staging")
//   GITHUB_*                filled in automatically inside GitHub Actions

import fs from "node:fs";
import path from "node:path";

// ---------- command-line options ----------
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

const REPORT_PATH = opt("--report", process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || "results.json");
const OUT_PATH = opt("--out", "results-payload.json");
const DRY_RUN = has("--dry-run");
const FAIL_ON_NOT_READY = has("--fail-on-not-ready");

const env = process.env;

// ---------- read the report ----------
function readReport(file) {
  if (!fs.existsSync(file)) {
    return { missing: true };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { unreadable: true, reason: err.message };
  }
}

// ---------- helpers ----------
const ANSI = /\u001b\[[0-9;]*m/g;
const clean = (text = "") => String(text).replace(ANSI, "").trim();
const firstLine = (text = "") => clean(text).split("\n")[0].slice(0, 300);

// Tags can live on the spec (Playwright 1.42+: spec.tags) or in the title ("@p1 @auth").
function tagsFor(spec) {
  const fromField = Array.isArray(spec.tags) ? spec.tags : [];
  const fromTitle = (spec.title.match(/@[\w-]+/g) || []);
  return [...new Set([...fromField, ...fromTitle].map((t) => t.replace(/^@/, "").toLowerCase()))];
}

// Priority: tests are P0 unless tagged @p1 or @p2 (PRD: P0 must pass for release).
function priorityFor(tags) {
  if (tags.includes("p2")) return "P2";
  if (tags.includes("p1")) return "P1";
  return "P0";
}

// Feature: first folder of the spec file (PRD FR-1: one folder per feature),
// e.g. "auth/login.spec.ts" -> "auth". Falls back to a feature tag, then "general".
const FEATURES = ["auth", "channels", "messaging", "threads", "files", "notifications", "calls", "search", "settings"];
function featureFor(file = "", tags = []) {
  const parts = file.split(/[\\/]/).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 2];
  return tags.find((t) => FEATURES.includes(t)) || "general";
}

// Map Playwright's per-test outcome to the dashboard's four statuses.
//   expected   -> passed (or skipped if it was skipped on purpose)
//   unexpected -> failed
//   flaky      -> flaky (failed, then passed on retry: FR-20)
//   skipped    -> skipped
function statusFor(test) {
  switch (test.status) {
    case "expected":
      return test.expectedStatus === "skipped" ? "skipped" : "passed";
    case "unexpected":
      return "failed";
    case "flaky":
      return "flaky";
    default:
      return "skipped";
  }
}

// Walk nested suites and collect every test.
function collectTests(report) {
  const rows = [];
  const walk = (suite, titlePath) => {
    for (const spec of suite.specs || []) {
      const tags = tagsFor(spec);
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1] || {};
        const failed = results.find((r) => r.status === "failed" || r.status === "timedOut" || r.error);
        const evidence = failed || last;
        const attachments = evidence.attachments || [];
        const screenshot = attachments.find((a) => a.name === "screenshot" || (a.contentType || "").startsWith("image/"));
        const trace = results.flatMap((r) => r.attachments || []).find((a) => a.name === "trace");
        const status = statusFor(test);
        const error = status === "failed" || status === "flaky"
          ? (evidence.error || (evidence.errors || [])[0] || null)
          : null;

        rows.push({
          name: [...titlePath, spec.title.replace(/\s*@[\w-]+/g, "")].filter(Boolean).join(" › "),
          file: spec.file || suite.file || "",
          line: spec.line ?? null,
          project: test.projectName || "",
          feature: featureFor(spec.file || suite.file, tags),
          priority: priorityFor(tags),
          tags,
          status,
          durationMs: results.reduce((sum, r) => sum + (r.duration || 0), 0),
          retries: Math.max(0, results.length - 1),
          error: error
            ? {
                reason: firstLine(error.message),            // plain-language one-liner for the dashboard
                message: clean(error.message).slice(0, 4000), // full message for the expandable log
                stack: clean(error.stack).slice(0, 4000),
                location: error.location || null,
              }
            : null,
          screenshotPath: screenshot?.path || null,
          tracePath: trace?.path || null,
        });
      }
    }
    for (const child of suite.suites || []) {
      // Top-level suites are files (their title is skipped below); nested ones are describe() blocks.
      walk(child, [...titlePath, child.title]);
    }
  };
  for (const suite of report.suites || []) walk(suite, []);
  return rows;
}

// ---------- verdict (PRD FR-17) ----------
function decideVerdict(tests, runnerErrors) {
  const count = (status, priority) =>
    tests.filter((t) => t.status === status && (!priority || t.priority === priority)).length;

  if (runnerErrors.length > 0) return { verdict: "Not Ready", reason: "The test runner itself failed" };
  if (tests.length === 0) return { verdict: "Not Ready", reason: "No tests ran" };

  const p0Failed = count("failed", "P0");
  if (p0Failed > 0) return { verdict: "Not Ready", reason: `${p0Failed} must-pass (P0) test(s) failed` };

  const otherFailed = count("failed");
  const flaky = count("flaky");
  if (otherFailed > 0 || flaky > 0) {
    const bits = [];
    if (otherFailed) bits.push(`${otherFailed} non-critical test(s) failed`);
    if (flaky) bits.push(`${flaky} test(s) were flaky`);
    return { verdict: "Ready with warnings", reason: bits.join(", ") };
  }
  return { verdict: "Ready", reason: "All tests passed" };
}

// ---------- run metadata from GitHub Actions ----------
function runMeta(report) {
  const server = env.GITHUB_SERVER_URL || "https://github.com";
  const repo = env.GITHUB_REPOSITORY || "";
  const runId = env.GITHUB_RUN_ID || `local-${Date.now()}`;
  let commitMessage = env.PREFLIGHT_COMMIT_MESSAGE || "";
  if (!commitMessage && env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
      commitMessage = event.head_commit?.message || event.pull_request?.title || "";
    } catch { /* ignore */ }
  }
  return {
    id: runId,
    attempt: Number(env.GITHUB_RUN_ATTEMPT || 1),
    project: env.PREFLIGHT_PROJECT || "zedu",
    environment: env.PREFLIGHT_ENVIRONMENT || "staging",
    repo,
    branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || "local",
    commit: env.GITHUB_SHA || "",
    commitMessage: firstLine(commitMessage),
    trigger: env.GITHUB_EVENT_NAME || "manual", // push | pull_request | workflow_dispatch | schedule
    url: repo ? `${server}/${repo}/actions/runs/${runId}` : null,
    startedAt: report.stats?.startTime || new Date().toISOString(),
    durationMs: Math.round(report.stats?.duration || 0),
  };
}

// ---------- GitHub Actions step summary ----------
function writeStepSummary(payload) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const { run, verdict, reason, counts, tests } = payload;
  const icon = { Ready: "✅", "Ready with warnings": "⚠️", "Not Ready": "❌" }[verdict] || "";
  const problems = tests.filter((t) => t.status === "failed" || t.status === "flaky");
  const lines = [
    `## ${icon} Preflight: ${verdict}`,
    "",
    `${reason}. **${counts.passed}** passed · **${counts.failed}** failed · **${counts.flaky}** flaky · **${counts.skipped}** skipped · ${(run.durationMs / 1000).toFixed(1)}s`,
    "",
  ];
  if (problems.length) {
    lines.push("| Test | Feature | Priority | Status | Reason |", "| --- | --- | --- | --- | --- |");
    for (const t of problems) {
      lines.push(`| ${t.name} | ${t.feature} | ${t.priority} | ${t.status} | ${(t.error?.reason || "").replace(/\|/g, "\\|")} |`);
    }
  }
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

// ---------- send to the dashboard ----------
async function postResults(payload) {
  const url = env.PREFLIGHT_RESULTS_URL;
  const key = env.PREFLIGHT_API_KEY;
  if (DRY_RUN) return console.log("Dry run: not sending results.");
  if (!url || !key) return console.log("PREFLIGHT_RESULTS_URL or PREFLIGHT_API_KEY not set: skipping upload.");
  if (!url.startsWith("https://") && !url.startsWith("http://localhost")) {
    throw new Error("PREFLIGHT_RESULTS_URL must use https://");
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return console.log(`Results sent to the dashboard (HTTP ${res.status}).`);
      const body = (await res.text()).slice(0, 300);
      // 4xx means our request is wrong (bad key, bad payload): retrying won't help.
      if (res.status < 500) throw Object.assign(new Error(`Dashboard rejected results: HTTP ${res.status} ${body}`), { fatal: true });
      console.warn(`Attempt ${attempt}: HTTP ${res.status}, retrying…`);
    } catch (err) {
      if (err.fatal || attempt === 3) throw err;
      console.warn(`Attempt ${attempt} failed (${err.message}), retrying…`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

// ---------- main ----------
async function main() {
  const report = readReport(REPORT_PATH);
  const runnerErrors = [];
  if (report.missing) runnerErrors.push({ message: `Report not found: ${REPORT_PATH}` });
  if (report.unreadable) runnerErrors.push({ message: `Report could not be read: ${report.reason}` });
  for (const e of report.errors || []) runnerErrors.push({ message: firstLine(e.message) });

  const tests = report.suites ? collectTests(report) : [];
  const counts = {
    total: tests.length,
    passed: tests.filter((t) => t.status === "passed").length,
    failed: tests.filter((t) => t.status === "failed").length,
    flaky: tests.filter((t) => t.status === "flaky").length,
    skipped: tests.filter((t) => t.status === "skipped").length,
  };
  const { verdict, reason } = decideVerdict(tests, runnerErrors);

  const payload = {
    schemaVersion: 1,
    run: runMeta(report),
    verdict,
    reason,
    counts,
    runnerErrors,
    tests,
  };

  fs.mkdirSync(path.dirname(path.resolve(OUT_PATH)), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Preflight verdict: ${verdict} (${reason})`);
  console.log(`passed ${counts.passed} · failed ${counts.failed} · flaky ${counts.flaky} · skipped ${counts.skipped}`);
  console.log(`Payload written to ${OUT_PATH}`);

  writeStepSummary(payload);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `verdict=${verdict}\n`);

  await postResults(payload);

  if (FAIL_ON_NOT_READY && verdict === "Not Ready") process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Preflight results step failed: ${err.message}`);
  process.exitCode = 1;
});
