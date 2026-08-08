# build context is the repo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
# NEXT_PUBLIC_* is inlined into the client bundle at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @orders/core --filter @orders/web
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @orders/core build && pnpm --filter @orders/web build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
