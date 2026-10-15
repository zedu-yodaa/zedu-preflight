# Dashboard: login demo (FR-16)

A small, working demo of the Preflight dashboard sign-in, built for the 15 October demo. It uses plain HTML, CSS and JavaScript with Supabase Auth (email and password), so it runs anywhere with no install or build step. The final dashboard is planned in Next.js; this can be ported into it.

## What it shows

1. Opening `projects.html` while signed out redirects to the Login page.
2. A wrong email or password shows "Incorrect email or password."
3. Signing in opens the Projects page: a project card with a verdict badge and a run history table (**sample data** until the results API exists).
4. Sign out returns to Login.

## Files

| File | Purpose |
| --- | --- |
| `login.html` | Sign-in page |
| `projects.html` | Protected Projects page (sample runs, FR-18 layout) |
| `index.html` | Redirects to `projects.html` |
| `auth.js` | Supabase client, page protection, sign-out |
| `config.js` | Supabase project URL and **publishable** key (public by design; never put the secret key here) |
| `style.css` | Styles and verdict colours (FRD 2.3) |

## Deploy on Vercel

Add New → Project → import `zedu-yodaa/zedu-preflight` → set **Root Directory** to `dashboard/login-demo` → Framework preset **Other** → Deploy. Then turn off Settings → Deployment Protection so others can open the link.

Sign-in accounts are managed in the Supabase project (Authentication → Users). Ask Barakat (Barakat_O) for a demo account.
