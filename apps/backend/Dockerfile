# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install dependencies at the root
RUN npm ci

# Build the shared packages and backend
RUN npm run build -w packages/shared-types
RUN npm run build -w apps/backend

# Production stage
FROM node:22-alpine AS production
WORKDIR /app

# Copy the root package.json and workspace configuration
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared-types/package.json ./packages/shared-types/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built outputs
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/shared-types ./packages/shared-types

# Drizzle migrations
COPY --from=builder /app/apps/backend/drizzle ./apps/backend/drizzle

# Set production environment
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Run unprivileged — the app only needs read access to its own files
USER node

# Container-level liveness: the version endpoint is dependency-free and cheap
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health/version || exit 1

# Start the server from the root context
CMD ["node", "apps/backend/dist/main"]
