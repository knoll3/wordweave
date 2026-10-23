FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p apps/api/node_modules

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist
RUN mkdir -p /app/apps/api/data
RUN node -e "require.resolve('openai', {paths: ['/app/apps/api']}); const Database = require('better-sqlite3'); new Database(':memory:').close();"
CMD ["node", "apps/api/dist/index.js"]
