// POST /api/results (FR-15): receives one run from scripts/process-results.mjs and saves it to Supabase.
//
// Runs as a Vercel serverless function. No dependencies: Node 18+ built-ins only.
//
// Environment variables (Vercel → Settings → Environment Variables, never in code):
//   PREFLIGHT_API_KEY     shared key the CI sends in the x-api-key header
//   SUPABASE_URL          https://<project>.supabase.co
//   SUPABASE_SECRET_KEY   Supabase secret key (sb_secret_…) or legacy service_role key. Server only.

const crypto = require("node:crypto");

const VERDICTS = ["Ready", "Ready with warnings", "Not Ready"];
const STATUSES = ["passed", "failed", "flaky", "skipped"];
const MAX_TESTS = 5000;

// Compare keys in constant time so the key can't be guessed from response timing.
function keyMatches(given, expected) {
  const hash = (value) => crypto.createHash("sha256").update(String(value)).digest();
  return crypto.timingSafeEqual(hash(given), hash(expected));
}

// Returns a plain-language problem with the payload, or null if it looks right.
function validate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Body must be a JSON object";
  if (payload.schemaVersion !== 1) return "Unsupported schemaVersion (expected 1)";
  const run = payload.run;
  if (!run || typeof run !== "object") return "run is required";
  for (const field of ["id", "project", "environment"]) {
    if (typeof run[field] !== "string" || !run[field].trim()) return `run.${field} is required`;
  }
  if (!VERDICTS.includes(payload.verdict)) return `verdict must be one of: ${VERDICTS.join(", ")}`;
  if (!Array.isArray(payload.tests)) return "tests must be an array";
  if (payload.tests.length > MAX_TESTS) return `Too many tests (max ${MAX_TESTS})`;
  const bad = payload.tests.findIndex((t) => !t || typeof t.name !== "string" || !STATUSES.includes(t.status));
  if (bad !== -1) return `tests[${bad}] needs a name and a status (${STATUSES.join(", ")})`;
  return null;
}

async function saveRun(payload, env) {
  const headers = { "content-type": "application/json", apikey: env.SUPABASE_SECRET_KEY };
  // New-style secret keys (sb_secret_…) go in the apikey header only; legacy JWT keys also need Authorization.
  if (!env.SUPABASE_SECRET_KEY.startsWith("sb_")) headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;

  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/ingest_run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ payload }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json(); // the saved run's id
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  const env = process.env;
  if (!env.PREFLIGHT_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.error("Results API is missing PREFLIGHT_API_KEY, SUPABASE_URL or SUPABASE_SECRET_KEY");
    return res.status(500).json({ error: "Results API is not configured" });
  }

  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || !keyMatches(key, env.PREFLIGHT_API_KEY)) {
    return res.status(401).json({ error: "Missing or wrong x-api-key" });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return res.status(400).json({ error: "Body is not valid JSON" }); }
  }
  const problem = validate(payload);
  if (problem) return res.status(400).json({ error: problem });

  try {
    const runId = await saveRun(payload, env);
    return res.status(201).json({ ok: true, runId });
  } catch (err) {
    console.error(`Saving run ${payload.run.id} failed: ${err.message}`);
    // 5xx so the uploader retries (scripts/process-results.mjs retries 5xx, not 4xx).
    return res.status(502).json({ error: "Could not save results" });
  }
}

module.exports = handler;
module.exports.validate = validate;
