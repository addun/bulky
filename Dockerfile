# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/bulkly ./cmd/bulkly

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata poppler-utils
COPY --from=build /out/bulkly /usr/local/bin/bulkly
ENV DATA_DIR=/data ADDR=:8080 CURRENCY=PLN CURRENCY_SYMBOL=zł TZ=Europe/Warsaw
VOLUME /data
EXPOSE 8080
CMD ["bulkly"]
