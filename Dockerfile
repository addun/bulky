FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -o /out/bulkly ./cmd/bulkly

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/bulkly /usr/local/bin/bulkly
ENV DATA_DIR=/data ADDR=:8080 CURRENCY=PLN CURRENCY_SYMBOL=zł TZ=Europe/Warsaw
VOLUME /data
EXPOSE 8080
CMD ["bulkly"]
