# syntax=docker/dockerfile:1

# Base images are pinned by digest for reproducible builds; the tag next to the
# digest (node:22-alpine) is what Dependabot proposes updates for.
# node:22-alpine index digest: sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85

# --- Build stage: install the workspace, compile shared + api ----------------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build

# Corepack ships with Node and activates the exact pnpm version pinned in the
# root package.json (`packageManager`), so the build never installs pnpm from a
# floating registry command.
RUN corepack enable

WORKDIR /repo

# Manifests first so dependency installation is cached independently of
# sources. Only the api's own workspace (root, shared, api) is copied: ui and
# e2e are separate deployables and must not leak into the api image.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @localdeck/shared build && pnpm --filter @localdeck/api build

# --- Production-dependency stage: pruned api + shared node_modules -----------
# Kept separate so the runtime image needs neither pnpm nor the build toolchain.
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @localdeck/api...

# --- Runtime stage: dist + production node_modules, no package manager -------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS runtime

# Release builds pass the git tag; local/compose builds default to `dev`.
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="LocalDeck api" \
      org.opencontainers.image.description="LocalDeck api — proxies the user-managed LocalStack instance (not affiliated with Amazon Web Services)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/kubaeror/localdeck" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    APP_VERSION=${APP_VERSION}

WORKDIR /repo
# Runtime manifests only: the api package and the workspace link it relies on.
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist

# Liveness only: a stopped LocalStack must not make the container unhealthy.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1:3001/api/health/live || exit 1

USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
