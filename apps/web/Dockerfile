# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/.npmrc apps/api/
RUN pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN pnpm --filter web build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/apps/web/build ./build
COPY deploy/healthcheck.js /healthcheck.js
COPY deploy/web-entrypoint.sh /web-entrypoint.sh
ENV NODE_ENV=production WEB_HOST=0.0.0.0 WEB_PORT=3000 API_ORIGIN=http://api:8080 BODY_SIZE_LIMIT=15M
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node /healthcheck.js http://127.0.0.1:${WEB_PORT:-3000}/health
CMD ["sh", "/web-entrypoint.sh"]
