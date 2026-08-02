# LoopholeMap Analysis Worker

The Cloudflare Worker that proxies analysis requests from the frontend to the
Anthropic API, keeping the API key server-side. `js/api.js` points at this
worker via `PROXY_URL`.

## Deploy (Cloudflare dashboard, no tooling needed)

1. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Create Worker**. Name it `loopholemap-proxy` and deploy the starter.
2. Click **Edit code**, delete the starter code, paste the full contents of
   `worker.js`, then **Deploy**.
3. Back on the worker's page: **Settings** → **Variables and Secrets** →
   **Add** → type **Secret**, name `ANTHROPIC_API_KEY`, value = your Anthropic
   API key (create one at <https://platform.claude.com> → API keys). Save.
4. Copy the worker URL (`https://loopholemap-proxy.<your-subdomain>.workers.dev`)
   and update `PROXY_URL` at the top of `js/api.js`, then push to `main` so
   GitHub Pages redeploys.

## Configuration

- **Allowed origins** — edit `ALLOWED_ORIGINS` at the top of `worker.js` when
  the site moves to a custom domain.
- **Model** — `MODEL` is `claude-sonnet-5` (matches the frontend's ~92s scan
  timeout and progress estimates). `claude-opus-5` gives deeper analysis but
  slower/costlier scans; if you switch, also raise `REQUEST_TIMEOUT_MS`
  expectations in `js/api.js`.
- **Output budget** — `LIMITS.analyze.maxTokens` (8000) bounds how many issues
  one scan can return. The frontend parser tolerates truncated JSON, so raising
  it is safe if scans feel shallow on big bills.

## Contract with the frontend

`POST /` with JSON `{action: "analyze"|"detail"|"ask", ...}` returns
`{result: "<model JSON text>"}`; errors return `{error: "..."}` with a non-200
status. The result strings are parsed by `js/parser.js` — keep the schemas in
the system prompts in sync with it.
