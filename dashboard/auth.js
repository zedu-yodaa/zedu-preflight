// Shared sign-in helpers (FR-16): Supabase client, page protection and sign-out.
const cfg = window.PREFLIGHT_CONFIG || {};
const configured = /^https:\/\//.test(cfg.supabaseUrl || "") && !/PASTE-/.test(cfg.supabaseKey || "");
const db = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;

async function getSession() {
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session;
}

// Protected pages call this first. Signed-out visitors go to Login and come back afterwards.
async function requireSignIn() {
  const session = await getSession();
  if (!session) {
    const back = encodeURIComponent((location.pathname.split("/").pop() || "projects.html") + location.search);
    location.replace(`login.html?next=${back}`);
    return null;
  }
  document.documentElement.classList.remove("checking");
  return session;
}

async function signOut() {
  if (db) await db.auth.signOut();
  location.replace("login.html?signedout=1");
}

function showNotConfigured(target) {
  const el = document.createElement("p");
  el.className = "notice warn";
  el.textContent = "Not connected yet: add the Supabase URL and key to config.js.";
  target.prepend(el);
}
