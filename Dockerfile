# syntax=docker/dockerfile:1

# ---- build stage: install deps + compile Tailwind CSS ----
# Debian slim (glibc + OpenSSL 3) — matches Prisma's debian-openssl-3.0.x engine.
FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tailwind.config.js postcss.config.js ./
COPY client/assets/css/input.css ./client/assets/css/input.css
RUN npm run build:css

# ---- runtime stage ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client ./client
COPY package.json server.js ./
COPY src ./src
COPY prisma ./prisma

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply Prisma migrations on boot (skipped while DATABASE_URL is not configured).
CMD ["sh", "-c", "if [ -z \"$DATABASE_URL\" ] || printf %s \"$DATABASE_URL\" | grep -q YOUR_DB_PASSWORD; then echo 'DATABASE_URL not configured - skipping migrations'; else npx prisma migrate deploy; fi; exec node server.js"]
