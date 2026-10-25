# Plan·it – GenAI Event Planning Assistant

Plan weddings, birthdays and community events. Enter your guest count, budget, city and style, and Plan·it generates:

- a **budget** split by category with a donut chart and money-saving tips
- a **timeline** of tasks, from planning to event day
- a **vendor checklist** with saved progress
- **personalised ideas**, plus plain-language tweaks ("cut the budget 15%", "add a mehendi night")

Live demo: https://planit-ai-event-planner.onrender.com (the first load may take a moment on the free tier).

## Chosen vertical

Challenge 5: Celebration & Event Planner.

## Approach and logic

1. Validate the inputs (event type, guests, budget, currency, text lengths) in the browser and again on the server.
2. Build one structured prompt from the event type, guest count, budget, city, style and constraints. User text is fenced inside `<user_input>` tags with angle brackets stripped, and the model is told to treat it as data (prompt-injection defence).
3. Gemini replies with strict JSON, which the server parses and checks for budget, timeline and vendor sections.
4. Budget percentages are normalised to the user's real total, so the amounts always add up.
5. Tweaks send the current plan (sanitised, known fields only) plus the requested change, so the plan is revised rather than regenerated.
6. If AI is unavailable, a deterministic starter plan for the event type is shown instead.

## How the solution works

The browser form posts to `POST /api/plan`. The server holds the API key, rate-limits each visitor, calls the Gemini API and returns validated JSON. The UI renders it as Budget, Timeline, Vendors (a checklist with saved progress) and Ideas tabs. The badge above the plan shows which model produced it.

## Gen AI services used

Google Gemini (Gemini API, free-tier Flash models) generates and revises every plan: budget split, timeline, vendor checklist, personalised ideas and savings tips. On the first request the server asks Google which Flash models the key can use and tries the newest first, so it keeps working as Google retires and releases models. It skips a model that is out of quota or retired, and retries when Google reports it is overloaded.

## Assumptions

- The default currency is ₹ (₹, $, € and £ are supported); prices and vendor advice are AI estimates to verify locally.
- Guests are limited to 2–5000 and budgets to 1,000,000,000 to keep requests sensible.
- There are no accounts; checklist progress is saved in the browser only.
- The event date is optional; without one, the timeline is relative to the event date.
- Reviewers may run the app without an API key, which switches it to starter-template mode.

## Try it

1. Pick an event type and fill in guests, budget and city.
2. Click "Create my plan".
3. Use "Tweak the plan" for changes like "cut the budget 15%".

Sample input: Wedding, 150 guests, ₹15,00,000, Delhi, "garden, pastel, live music".

## Quick start

Needs Node.js 22.18 or newer (24 recommended, see `.node-version`). The whole project is **TypeScript that runs without a build step**: Node strips the types itself, and the server does the same for the browser files. There are no runtime dependencies.

```bash
cp .env.example .env     # then put your free Gemini key in .env
npm start                # reads .env automatically
```

Open http://localhost:3000. Without a key the app still works in starter-template mode. Never put a real key in `.env.example`; `.env` is git-ignored.

## Scripts

```bash
npm start                # run the app
npm test                 # run the tests (no install needed)
npm run test:coverage    # tests with a coverage report
npm install && npm run typecheck   # strict TypeScript check (installs typescript and @types/node)
```

## Deploy (free, Render)

1. Push this repo to GitHub, then create a Render **Web Service** from it (Language: Node, Instance Type: Free).
2. Build Command `npm install`, Start Command `npm start`. Render reads `.node-version` (24) for the Node version.
3. Add the environment variable `GEMINI_API_KEY` (free key from Google AI Studio) and deploy.

## Tests

35 tests cover input validation, budget maths, prompt building and sanitising, AI-reply parsing, fallback plans, the UI helpers (formatting, chart maths, saved checklist, API client) and the HTTP server with a mocked Gemini API: static files and headers, TypeScript served as JavaScript, path traversal, request validation, rate limiting, caching, model discovery and fallback, retries and friendly error mapping. Line coverage is about 99%. CI runs the type check and the tests with coverage on Node 22 and 24 for every push.

## Architecture

```
server.ts           starts the server (loads .env)
src/app.ts          HTTP routes, security headers, static files, caching, error mapping
src/gemini.ts       Gemini client: model discovery, free-model rotation, retries
src/rateLimit.ts    bounded sliding-window rate limiter
public/planner.ts   pure logic and shared types (validation, prompt, parsing, sanitising, fallback)
public/app.ts       UI entry point: reads the form, asks for a plan, shows it
public/js/          small UI modules: api, dom, format (pure helpers), store, render, tabs, effects, motion
test/               node:test unit and integration tests (TypeScript)
```

## Security

- The API key lives only on the server (`.env` is git-ignored); the browser never sees it.
- Inputs are validated on the client and again on the server (types, ranges, lengths, currency allow-list); plans sent back for tweaks are sanitised to known fields and capped sizes.
- AI output is rendered with text nodes, never `innerHTML`, so it cannot inject markup.
- Strict Content-Security-Policy plus HSTS, `nosniff`, frame, referrer, permissions and cross-origin headers.
- Per-visitor rate limiting (uses the real client IP behind Render's proxy) with bounded memory, a 32 KB request cap, a JSON content-type check, a request timeout, a path-traversal guard and generic error messages.
- Prompt-injection defence: user text is fenced and stripped of angle brackets before it reaches the model.
- CodeQL scanning and Dependabot updates run on GitHub; see `SECURITY.md` for how to report an issue.

## Accessibility

Semantic landmarks and labelled controls, a skip link, native radios and checkboxes, ARIA tabs with arrow-key, Home and End navigation, `aria-live` status messages, focus moved to results, visible focus rings, strong colour contrast, and a visible "Pause animations" switch (WCAG 2.2.2) plus `prefers-reduced-motion` support, so every decorative animation and effect can be turned off.

## Efficiency

Zero runtime dependencies, no build step, tiny static assets, one AI request per plan, a 90-second upstream timeout, and a 30-minute cache for identical requests so the free Gemini quota lasts longer.

## Limitations

Budget figures and vendor advice are AI estimates, so verify prices locally. Checklist progress is stored per browser. The free Gemini tier has daily limits, so heavy use falls back to the starter plan.

## License

MIT
