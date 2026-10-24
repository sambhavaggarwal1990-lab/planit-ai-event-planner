# Plan·it – GenAI Event Planning Assistant

Plan weddings, birthdays and community events. Enter your guest count, budget, city and style, and Plan·it generates:

- a **budget** split by category with money-saving tips
- a **timeline** of tasks, from planning to event day
- a **vendor checklist** with saved progress
- **personalised ideas**, plus plain-language tweaks ("cut the budget 15%", "add a mehendi night")

## Chosen vertical

Challenge 5: Celebration & Event Planner.

## Approach and logic

1. Validate the inputs (event type, guests, budget, currency, text lengths) in the browser and again on the server.
2. Build one structured prompt from the event type, guest count, budget, city, style and constraints.
3. The AI model replies with strict JSON, which the server parses and checks for budget, timeline and vendor sections.
4. Budget percentages are normalised to the user's real total, so the amounts always add up.
5. Tweaks send the current plan plus the requested change, so the plan is revised rather than regenerated from scratch.
6. If AI is unavailable, a deterministic starter plan for the event type is shown instead.

## How the solution works

The browser form posts to `POST /api/plan`. The server holds the API key, rate-limits requests, calls the Gemini API (or the Anthropic Messages API) and returns validated JSON. The UI renders it as Budget, Timeline, Vendors (a checklist with saved progress) and Ideas tabs.

## Gen AI services used

Google Gemini (Gemini API, free-tier Flash models tried in order, with automatic fallback when one is out of quota or retired) generates and revises every plan when `GEMINI_API_KEY` is set. Anthropic Claude is supported as an alternative with `ANTHROPIC_API_KEY`. It produces: budget split, timeline, vendor checklist, ideas and savings tips.

## Assumptions

- The default currency is ₹ (₹, $, € and £ are supported); prices and vendor advice are AI estimates to verify locally.
- Guests are limited to 2–5000 and budgets to 1,000,000,000 to keep requests sensible.
- There are no accounts; checklist progress is saved in the browser only.
- The event date is optional; without one, the timeline is relative to the event date.
- Reviewers may run the app without an API key, which switches it to starter-template mode.

## Problem statement alignment

Event planning means juggling money, deadlines and vendors. Plan·it turns a few inputs into a complete, editable plan tailored to the event type, city and constraints, and falls back to a built-in starter plan if AI is unavailable.

## Quick start

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
cp .env.example .env        # add GEMINI_API_KEY (Google) or ANTHROPIC_API_KEY (Claude)
npm run start:env           # or: GEMINI_API_KEY=... npm start
```

Open http://localhost:3000. Without an API key the app still works in starter-template mode.

## Deploy (free, Render)

1. Push this repo to GitHub, then create a Render **Web Service** from it (Language: Node, Instance Type: Free).
2. Build Command `npm install`, Start Command `npm start`.
3. Add the environment variable `GEMINI_API_KEY` (free key from Google AI Studio) and deploy.

## Tests

```bash
npm test
```

Unit tests cover input validation, budget maths, AI-reply parsing, prompt building and the fallback plans. CI runs them on every push.

## Architecture

```
public/planner.js   pure logic (validation, prompt, parsing, fallback), shared by browser, server and tests
public/app.js       UI: form, tabs, rendering, saved checklist progress
server.js           static files + POST /api/plan (calls Gemini or Anthropic)
test/               node:test unit tests
```

## Security

- The API key lives only on the server (`.env` is git-ignored); the browser never sees it.
- All inputs are validated on the client and again on the server (types, ranges, lengths, currency allow-list).
- AI output is rendered with `textContent`/text nodes, never `innerHTML`, so it cannot inject markup.
- Strict Content-Security-Policy, `nosniff`, request-size cap, per-IP rate limit, path-traversal guard, and generic error messages.

## Accessibility

Semantic landmarks and labelled controls, a skip link, native radios and checkboxes, ARIA tabs with arrow-key navigation, `aria-live` status messages, focus moved to results, visible focus rings, light/dark colour schemes with strong contrast, and reduced-motion support.

## Efficiency

Zero runtime dependencies, tiny static assets, one AI request per plan, a 90-second upstream timeout, and a 30-minute cache for identical requests so the free Gemini quota lasts longer.

## Limitations

Budget figures and vendor advice are AI estimates, so verify prices locally. Checklist progress is stored per browser.

## License

MIT
