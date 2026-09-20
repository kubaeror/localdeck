# syntax=docker/dockerfile:1

# The LocalDeck console sidecar: the api and the built ui in one container, so
# an emulator that launches a single console container (Floci Console Contract
# v1) can run LocalDeck with nothing but PORT and AWS_ENDPOINT_URL. The normal
# deployment stays apps/api + apps/ui via docker-compose.yml.
#
# node:22-alpine index digest: sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85

# --- Build stage: compile shared + api + ui + console ------------------------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build

RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/ui/package.json apps/ui/
COPY apps/console/package.json apps/console/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/ui apps/ui
COPY apps/console apps/console
RUN pnpm --filter @localdeck/shared build \
 && pnpm --filter @localdeck/api build \
 && pnpm --filter @localdeck/ui build \
 && pnpm --filter @localdeck/console build

# --- Production-dependency stage: pruned console + api + shared ---------------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/ui/package.json apps/ui/
COPY apps/console/package.json apps/console/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @localdeck/console...

# --- Runtime stage -----------------------------------------------------------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS runtime

ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="LocalDeck console" \
      org.opencontainers.image.description="LocalDeck console sidecar — api + ui in one container for local AWS emulators (not affiliated with Amazon Web Services)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/kubaeror/localdeck" \
      org.opencontainers.image.version="${APP_VERSION}" \
      io.floci.console.contract="1" \
      io.floci.console.name="LocalDeck" \
      io.floci.console.port="4500" \
      io.floci.console.health-path="/api/health" \
      io.floci.console.health-ready-field="status" \
      io.floci.console.health-ready-value="ok" \
      io.floci.console.health-unavailable-value="unavailable" \
      io.floci.console.clouds="aws" \
      io.floci.console.url="https://github.com/kubaeror/localdeck"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4500 \
    LOCALDECK_CONSOLE_CONTRACT=1 \
    APP_VERSION=${APP_VERSION}

WORKDIR /repo
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/console/package.json apps/console/
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/apps/console/node_modules ./apps/console/node_modules
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/console/dist apps/console/dist
COPY --from=build /repo/apps/ui/dist apps/ui/dist

# Liveness: /api/health answers 200 with status "unavailable" while the
# emulator is down (contract mode), so the container stays healthy and the
# supervisor can show the error instead of restarting it.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1:4500/api/health/live || exit 1

USER node
EXPOSE 4500
CMD ["node", "apps/console/dist/index.js"]
