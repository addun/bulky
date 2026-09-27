# Bulkly

A local log of products you buy in bulk: quantity, price in PLN, and a running history.

The repo is a pnpm workspace:

- `apps/api` — NestJS. Still serves the Handlebars UI, plus JSON, SQLite, OCR, and MCP
- `apps/web` — SvelteKit UI with Tailwind CSS. Pages move here one at a time

## Develop

Needs Node 22+ and pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm dev
```

The current UI listens on [http://127.0.0.1:8080](http://127.0.0.1:8080). The Svelte app listens on [http://localhost:5173](http://localhost:5173) and proxies `/api`, `/images`, and `/mcp` to the API.

`pnpm build` builds both packages. `pnpm start` runs the built API. Seed fake catalog data with `pnpm seed` (see `apps/api/src/seed/cli.ts` for flags such as `--clamp-prices`). Generate Drizzle migrations with `pnpm db:generate`.

Optional environment (read by the API):

| Variable          | Default                    | Meaning                                      |
| ----------------- | -------------------------- | -------------------------------------------- |
| `DATA_DIR`        | `./data`                   | SQLite file and `images/`, relative to the API process |
| `ADDR`            | `:8080`                    | Listen address                               |
| `CURRENCY`        | `PLN`                      | Label only                                   |
| `CURRENCY_SYMBOL` | `zł`                       | Shown next to amounts                        |
| `OCR_API_KEY`     |                            | API key for the bill reader (`OPENAI_API_KEY` is also accepted) |
| `OCR_BASE_URL`    | `https://api.openai.com/v1` | OpenAI-compatible base URL (Ollama, etc.)   |

Handlebars screens stay on port 8080 until each one is ported. The Svelte home page uses the same layout and calls `GET /api/lookup.json`. Receipt and product files are served from `/images/`.

**Scan a bill:** open [http://localhost:8080/admin/receipts](http://localhost:8080/admin/receipts). **Moja Biedronka:** open [http://localhost:8080/imports/biedronka](http://localhost:8080/imports/biedronka). Docker includes Poppler so PDFs can be rasterized; locally, install the same with `brew install poppler`. The Chrome helper remains at `extensions/biedronka`.

## Run with Docker

```bash
docker compose up --build
```

Compose publishes the Svelte app on [http://localhost:3000](http://localhost:3000) and the API plus the Handlebars UI on [http://localhost:8080](http://localhost:8080). The Svelte container forwards `/api`, images, static files, and pages that are not ported yet to the API. Data (SQLite + product photos) lives in the `bulkly-data` volume.

Published images from GitHub Releases go to the [GitHub Container Registry](https://ghcr.io) as `ghcr.io/<owner>/<repo>` (linux/amd64):

```bash
docker pull ghcr.io/addun/bulky:v1.0.0
```

Create a GitHub Release whose tag is a semantic version starting with `v` (`v1.0.0`, `v1.2.3`, `v2.0.0-rc.1`). That publishes:

| Image tag     | When                                    |
| ------------- | --------------------------------------- |
| `v1.2.3`      | every matching release                  |
| `v1.2` / `v1` | stable releases only (not pre-releases) |
| `latest`      | stable releases only                    |

No extra secrets: the workflow authenticates with `GITHUB_TOKEN`. After the first push, the package appears on the repo’s **Packages** tab. For a public repo the image is public; for a private repo, `docker login ghcr.io` with a PAT that has `read:packages`.

## MCP

The API serves Streamable HTTP MCP at `/mcp` on port 8080. It is open: no token. The Vite dev server proxies that path.

Catalog names are Polish. The `best_price` tool searches product names and aliases; if an English query misses, ask again with a Polish translation.

```json
{
  "mcpServers": {
    "bulkly": {
      "url": "https://YOUR_HOST/mcp"
    }
  }
}
```
