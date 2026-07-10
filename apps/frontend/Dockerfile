# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install dependencies at the root
RUN npm ci

# Next.js resolves next.config rewrites and NEXT_PUBLIC_* at BUILD time.
# Keep NEXT_PUBLIC_API_URL empty (same-origin proxy); point the proxy at the
# compose service name by default, override with --build-arg for other setups.
ARG NEXT_PUBLIC_API_URL=""
ARG BACKEND_INTERNAL_URL="http://backend:4000"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

# Build the shared packages and frontend (standalone mode)
RUN npm run build -w packages/shared-types
RUN npm run build -w apps/frontend

# Production stage
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy the standalone build from the builder stage
# Next.js standalone in a monorepo copies the output to .next/standalone, but maintains directory structure!
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

EXPOSE 3000

# Run unprivileged
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1

# Start the standalone server
CMD ["node", "apps/frontend/server.js"]
