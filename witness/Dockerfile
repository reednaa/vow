FROM oven/bun:1.3.5-alpine AS protocol-builder
WORKDIR /app/typescript

COPY typescript/package.json typescript/bun.lock ./
RUN bun install --frozen-lockfile

COPY typescript/tsconfig.json typescript/tsconfig.build.json ./
COPY typescript/src ./src
RUN bun run build

FROM oven/bun:1.3.5-alpine AS deps
WORKDIR /app

COPY --from=protocol-builder /app/typescript/package.json ./typescript/package.json
COPY --from=protocol-builder /app/typescript/dist ./typescript/dist
COPY witness/package.json witness/bun.lock ./witness/
WORKDIR /app/witness
RUN bun install --frozen-lockfile --production --backend=copyfile

FROM oven/bun:1.3.5-alpine AS admin-builder
WORKDIR /app/admin

COPY witness/admin/package.json witness/admin/bun.lock ./
RUN bun install --frozen-lockfile

COPY witness/admin ./
RUN bun run build

FROM oven/bun:1.3.5-alpine AS runtime
WORKDIR /app/witness

ENV NODE_ENV=production
ENV API_PORT=3000
ENV HEALTH_PORT=3001

COPY --from=deps /app/typescript /app/typescript
COPY --from=deps /app/witness/node_modules ./node_modules
RUN ln -s /app/witness/node_modules /app/node_modules

COPY witness/package.json witness/bun.lock witness/tsconfig.json ./
COPY witness/drizzle ./drizzle
COPY witness/src ./src
COPY --from=admin-builder /app/public/admin ./public/admin

EXPOSE 3000
EXPOSE 3001

CMD ["bun", "src/entrypoints/api.ts"]
