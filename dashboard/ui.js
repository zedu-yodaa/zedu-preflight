// Shared display helpers for the dashboard pages. Data comes from CI, so always escape it before rendering.

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// Verdict → badge style and colour (FRD 2.3).
const VERDICT_STYLE = {
  "Ready": { cls: "ready", colour: "var(--v-ready)" },
  "Ready with warnings": { cls: "warn", colour: "var(--v-warn)" },
  "Not Ready": { cls: "notready", colour: "var(--v-notready)" },
  "Running": { cls: "running", colour: "var(--v-running)" },
};

function verdictBadge(verdict) {
  const style = VERDICT_STYLE[verdict] || VERDICT_STYLE.Running;
  return `<span class="badge ${style.cls}"><i class="dot" style="background:${style.colour}"></i>${esc(verdict)}</span>`;
}

const STATUS_STYLE = { failed: "notready", flaky: "warn", passed: "ready", skipped: "running" };
function statusBadge(status) {
  return `<span class="badge ${STATUS_STYLE[status] || "running"}">${esc(status)}</span>`;
}

function formatDuration(ms) {
  if (ms == null) return "–";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function formatDate(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const shortSha = (sha) => (sha ? sha.slice(0, 7) : "–");

// Only link to GitHub, never to arbitrary URLs from the payload.
const safeRunUrl = (url) => (/^https:\/\/github\.com\//.test(url || "") ? url : null);

function showError(target, text) {
  target.innerHTML = `<p class="notice error">${esc(text)}</p>`;
}
