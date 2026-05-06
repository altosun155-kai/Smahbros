---
paths:
  - "web/*.html"
  - "web/js/*.js"
  - "web/css/*.css"
---

# Frontend Rules (Vanilla HTML/CSS/JS)

- Every HTML page must have `<script src="js/auth.js"></script>` as the first script, followed immediately by `<script>requireAuth();</script>`.
- Nav bar is always injected by `nav-inject.js` — never write nav HTML directly in a page.
- All fetch calls use `API_BASE` from `api.js`. Never hardcode `smash-bracket-api.onrender.com`.
- No ES6 modules, no `import`/`export`, no TypeScript — plain ES5-compatible JS only.
- No build step — files are served as-is by Vercel static hosting.
- Supabase fighter image URLs encode spaces as `%20` (e.g. `Donkey%20Kong.png`).
- `localStorage.authToken` holds the JWT; `localStorage.username` holds the username.
