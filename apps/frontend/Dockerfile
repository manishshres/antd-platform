# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install dependencies at the root
RUN npm ci

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

# Start the standalone server
CMD ["node", "apps/frontend/server.js"]
