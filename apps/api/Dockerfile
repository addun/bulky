# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/.npmrc apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build \
 && pnpm --filter api deploy --prod --legacy /out \
 && cp -a apps/api/dist /out/dist

FROM node:22-alpine
RUN apk add --no-cache ca-certificates tzdata poppler-utils
WORKDIR /app
COPY --from=build /out ./
ENV DATA_DIR=/data ADDR=:8080 CURRENCY=PLN CURRENCY_SYMBOL=zł TZ=Europe/Warsaw NODE_ENV=production
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/main.js"]
