# build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @orders/core --filter @orders/api
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @orders/core build && pnpm --filter @orders/api build
RUN pnpm --filter @orders/api --prod deploy --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
