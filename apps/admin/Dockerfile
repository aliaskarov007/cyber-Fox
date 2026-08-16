# Кассовый экран и панель владельца.
#
# Собирается в статику и отдаётся Caddy — тот же контейнер проксирует /api и
# сокеты на сервер, поэтому админка ходит по относительным путям и не знает
# адреса API.
#   docker build -f apps/admin/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @cyberfox/admin...

COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN pnpm --filter @cyberfox/admin build

FROM caddy:2-alpine
COPY --from=build /repo/apps/admin/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
