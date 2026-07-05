# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Enable corepack for modern package managers if needed (or just use npm)
# Copy dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the app
COPY . .

# Build the Next.js application (standalone mode)
# You may need to pass NEXT_PUBLIC variables here if they are build-time
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy the standalone build from the builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# Start the standalone server
CMD ["node", "server.js"]
