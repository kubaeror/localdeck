# syntax=docker/dockerfile:1

# --- Build stage: install the workspace, compile shared + api ----------------
FROM node:22-alpine AS build
RUN npm install --global pnpm@10.34.5
WORKDIR /repo

# Manifests first so dependency installation is cached independently of sources.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/ui/package.json apps/ui/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @localdeck/shared build && pnpm --filter @localdeck/api build

# --- Runtime stage: the compiled api with production dependencies only -------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
RUN npm install --global pnpm@10.34.5
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/ui/package.json apps/ui/
COPY e2e/package.json e2e/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @localdeck/api...
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
