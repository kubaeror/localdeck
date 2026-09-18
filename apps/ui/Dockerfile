# syntax=docker/dockerfile:1

# Base images are pinned by digest for reproducible builds; the tags next to the
# digests (node:22-alpine, nginx:1.27-alpine) are what Dependabot proposes
# updates for.
# node:22-alpine index digest: sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85
# nginx:1.27-alpine index digest: sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# --- Build stage: compile the single-page app --------------------------------
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build

# Corepack ships with Node and activates the exact pnpm version pinned in the
# root package.json (`packageManager`).
RUN corepack enable

WORKDIR /repo

# VITE_* values are compiled into the bundle by Vite, so they are build-time
# arguments, not runtime environment variables. Leave VITE_API_BASE_URL empty
# (the default) for same-origin `/api`; runtime routing between the ui and api
# containers is handled by API_UPSTREAM in the nginx stage below.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/ui apps/ui
RUN pnpm --filter @localdeck/shared build && pnpm --filter @localdeck/ui build

# --- Runtime stage: nginx serves the bundle and proxies /api ------------------
FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime

ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="LocalDeck ui" \
      org.opencontainers.image.description="LocalDeck ui — the console served by nginx, proxying /api (not affiliated with Amazon Web Services)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/kubaeror/localdeck" \
      org.opencontainers.image.version="${APP_VERSION}"

# The nginx entrypoint renders /etc/nginx/templates/*.template with envsubst,
# so the api upstream stays configuration, never a hardcoded host.
ENV API_UPSTREAM=http://api:3001
COPY apps/ui/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/ui/dist /usr/share/nginx/html

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

EXPOSE 80
