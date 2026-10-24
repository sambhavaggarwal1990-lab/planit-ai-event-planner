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

Google Gemini (Gemini API, free-tier Flash models) generates and revises every plan: budget split, timeline, vendor checklist, personalised ideas and savings tips. The server tries `gemini-3.5-flash` first, then Flash-Lite variants, skipping any model that is out of quota or retired and retrying when Google reports it is overloaded.

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

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
cp .env.example .env        # then put your free Gemini key in .env
npm run start:env
```

Open http://localhost:3000. Without a key the app still works in starter-template mode. Never put a real key in `.env.example`; `.env` is git-ignored.

## Deploy (free, Render)

1. Push this repo to GitHub, then create a Render **Web Service** from it (Language: Node, Instance Type: Free).
2. Build Command `npm install`, Start Command `npm start`.
3. Add the environment variable `GEMINI_API_KEY` (free key from Google AI Studio) and deploy.

## Tests

```bash
npm test                 # run the tests
npm run test:coverage    # run them with a coverage report
```

20 tests cover input validation, budget maths, prompt building and sanitising, AI-reply parsing and fallback plans, plus the HTTP server with a mocked Gemini API: static files and headers, path traversal, request validation, rate limiting, caching, model fallback and friendly error mapping. CI runs them with coverage on every push.

## Architecture

```
public/planner.js   pure logic (validation, prompt, parsing, sanitising, fallback), shared by browser, server and tests
public/app.js       UI: form, tabs, rendering, charts, effects, saved checklist progress
src/app.js          HTTP routes, security headers, static files, caching, error mapping
src/gemini.js       Gemini client: free-model rotation, retries, model discovery
src/rateLimit.js    bounded sliding-window rate limiter
server.js           starts the server
test/               node:test unit and integration tests
```

## Security

- The API key lives only on the server (`.env` is git-ignored); the browser never sees it.
- Inputs are validated on the client and again on the server (types, ranges, lengths, currency allow-list); plans sent back for tweaks are sanitised to known fields and capped sizes.
- AI output is rendered with text nodes, never `innerHTML`, so it cannot inject markup.
- Strict Content-Security-Policy plus HSTS, `nosniff`, frame, referrer, permissions and cross-origin headers.
- Per-visitor rate limiting (uses the real client IP behind Render's proxy) with bounded memory, a 32 KB request cap, a JSON content-type check, a request timeout, a path-traversal guard and generic error messages.
- Prompt-injection defence: user text is fenced and stripped of angle brackets before it reaches the model.

## Accessibility

Semantic landmarks and labelled controls, a skip link, native radios and checkboxes, ARIA tabs with arrow-key navigation, `aria-live` status messages, focus moved to results, visible focus rings, strong colour contrast, and full `prefers-reduced-motion` support (all animations and effects switch off).

## Efficiency

Zero runtime dependencies, tiny static assets, one AI request per plan, a 90-second upstream timeout, and a 30-minute cache for identical requests so the free Gemini quota lasts longer.

## Limitations

Budget figures and vendor advice are AI estimates, so verify prices locally. Checklist progress is stored per browser. The free Gemini tier has daily limits, so heavy use falls back to the starter plan.

## License

MIT
