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
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 API_ORIGIN=http://api:8080
EXPOSE 3000
CMD ["node", "build/index.js"]
