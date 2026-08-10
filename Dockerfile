# syntax=docker/dockerfile:1

# ---- build stage: install deps + compile Tailwind CSS ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tailwind.config.js postcss.config.js ./
COPY client/assets/css/input.css ./client/assets/css/input.css
RUN npm run build:css

# ---- runtime stage ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client ./client
COPY package.json server.js ./
COPY src ./src
COPY prisma ./prisma

# If DATABASE_URL is set at build time, generate the Prisma client for postgres.
RUN npx prisma generate || true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
