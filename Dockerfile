# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY views ./views
COPY public ./public
RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:22-alpine
RUN apk add --no-cache ca-certificates tzdata poppler-utils
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/views ./views
COPY --from=build /src/public ./public
COPY --from=build /src/package.json ./
ENV DATA_DIR=/data ADDR=:8080 CURRENCY=PLN CURRENCY_SYMBOL=zł TZ=Europe/Warsaw NODE_ENV=production
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/main.js"]
