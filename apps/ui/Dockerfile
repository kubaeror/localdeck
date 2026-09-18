# syntax=docker/dockerfile:1

# --- Build stage: compile the single-page app --------------------------------
FROM node:22-alpine AS build
RUN npm install --global pnpm@10.34.5
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
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
FROM nginx:1.27-alpine AS runtime
ENV API_UPSTREAM=http://api:3001
# The nginx entrypoint renders /etc/nginx/templates/*.template with envsubst,
# so the api upstream stays configuration, never a hardcoded host.
COPY apps/ui/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/ui/dist /usr/share/nginx/html
EXPOSE 80
