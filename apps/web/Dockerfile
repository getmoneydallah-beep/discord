# Build from the repo root:  docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://... .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY packages/api-client/package.json packages/api-client/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @majlis/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
# Baked into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @majlis/web build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
