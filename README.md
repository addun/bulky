# Bulkly

A local log of products you buy in bulk: quantity, price in PLN, and a running history.

## Run with Docker

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080).

Data (SQLite + product photos) lives in the `bulkly-data` volume.

## Without Docker

Needs Go 1.23+:

```bash
go run ./cmd/bulkly
```

Optional environment:

| Variable          | Default  | Meaning                   |
| ----------------- | -------- | ------------------------- |
| `DATA_DIR`        | `./data` | SQLite file and `images/` |
| `ADDR`            | `:8080`  | Listen address            |
| `CURRENCY`        | `PLN`    | Label only                |
| `CURRENCY_SYMBOL` | `zł`     | Shown next to amounts     |
