# Bulkly

A local log of products you buy in bulk: quantity, price in PLN, and a running history.

## Run with Docker

```bash
docker compose up --build
```

The image includes Poppler so PDFs can be turned into page images for the vision model. For `go run` on a Mac, install the same with `brew install poppler`.

Published images from GitHub Releases go to the [GitHub Container Registry](https://ghcr.io) as `ghcr.io/<owner>/<repo>` (linux/amd64 and linux/arm64):

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

Open [http://localhost:8080](http://localhost:8080).

Data (SQLite + product photos) lives in the `bulkly-data` volume.

## Without Docker

Needs Go 1.24+:

```bash
go run ./cmd/bulkly
```

Optional environment:

| Variable          | Default                    | Meaning                                      |
| ----------------- | -------------------------- | -------------------------------------------- |
| `DATA_DIR`        | `./data`                   | SQLite file and `images/`                    |
| `ADDR`            | `:8080`                    | Listen address                               |
| `CURRENCY`        | `PLN`                      | Label only                                   |
| `CURRENCY_SYMBOL` | `zł`                       | Shown next to amounts                        |
| `OCR_API_KEY`     |                            | API key for the bill reader (`OPENAI_API_KEY` is also accepted) |
| `OCR_BASE_URL`    | `https://api.openai.com/v1` | OpenAI-compatible base URL (Ollama, etc.)   |

**Scan a bill:** open [http://localhost:8080/admin/receipts](http://localhost:8080/admin/receipts) and upload a photo or a PDF of a receipt. That stores the file, creates a `receipts` row, and reads the bill in the background. Open the receipt (or refresh it) to see whether it is still reading, failed, or ready to confirm. Confirm or edit the product list to migrate those lines into purchases; the receipt status then becomes `migrated`. For OpenAI, set `OCR_API_KEY`. Set the model on **Admin** (`/admin`); photos and PDFs both use that name as images (PDFs are rasterized with `pdftoppm`). Docker includes Poppler; locally you also need `brew install poppler`. For a local OpenAI-compatible server (for example Ollama), set `OCR_BASE_URL` to that server’s `/v1` endpoint and pick a model on **Admin**.
