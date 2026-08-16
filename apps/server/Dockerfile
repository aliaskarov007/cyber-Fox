# Сервер Cyber-Fox.
#
# Сборка идёт из корня монорепозитория: сервер объявлен зависимым от
# packages/shared, и контекста одной папки apps/server не хватит.
#   docker build -f apps/server/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo

# OpenSSL нужен уже на сборке: без него prisma generate не определяет версию
# libssl и подбирает движок наугад.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Сборка идёт без терминала: без этого pnpm останавливается на вопросе о
# переустановке node_modules и ждёт ответа, которого некому дать.
ENV CI=true

# Сначала только манифесты: слой с зависимостями переживает правки кода.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @cyberfox/server...

# shared подключается как исходники (main указывает на .ts), поэтому его
# копируем целиком, а не собираем.
COPY packages/shared packages/shared
COPY apps/server apps/server

RUN pnpm --filter @cyberfox/server prisma:generate \
  && pnpm --filter @cyberfox/server build

# Пересобираем дерево зависимостей без devDependencies: в образ не должны
# попасть ни компилятор, ни тестовый раннер. prisma generate повторяем —
# клиент лежит внутри node_modules и переустановкой затирается.
RUN pnpm install --frozen-lockfile --prod --filter @cyberfox/server... \
  && pnpm --filter @cyberfox/server exec prisma generate

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production

# Prisma запускает миграции своим CLI, а он тянет OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json package.json
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/server/node_modules apps/server/node_modules
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/prisma apps/server/prisma
COPY --from=build /repo/apps/server/package.json apps/server/package.json

WORKDIR /repo/apps/server
USER node
EXPOSE 3000

# Миграции применяются при старте: разъехавшаяся схема — это не то, что
# должен чинить владелец клуба вручную ночью.
#
# Путь к CLI абсолютный: в репозитории плоская раскладка зависимостей
# (node-linker=hoisted в .npmrc), поэтому пакеты лежат в корне монорепозитория,
# а не в папке сервера.
CMD ["sh", "-c", "node /repo/node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
