# Security

## Reporting a problem

Please use GitHub's private "Report a vulnerability" option on the Security tab instead of opening a public issue.

## How secrets are handled

- The Gemini key is read from the `GEMINI_API_KEY` environment variable on the server only.
- `.env` is git-ignored, and `.env.example` contains placeholders only. GitHub push protection is enabled and blocks real keys.
- If a key is ever exposed, delete it in Google AI Studio and create a new one.

## Protections in the app

- Strict Content-Security-Policy, HSTS, `nosniff`, frame, referrer, permissions and cross-origin headers.
- Server-side validation of every input, sanitising of plans sent back by the browser, and a 32 KB request limit.
- Per-visitor rate limiting, a request timeout, a path-traversal guard and generic error messages.
- User text is fenced and stripped of angle brackets before it is sent to the model (prompt-injection defence).
- AI output is rendered as text, never as HTML.
- CodeQL scanning and Dependabot updates run on GitHub.
